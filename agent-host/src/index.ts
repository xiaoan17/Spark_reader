import { createOpencode } from "@opencode-ai/sdk";
import type { Config } from "@opencode-ai/sdk";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hostDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(hostDir, "..");
const opencodeWorktree = resolve(packageDir, "opencode");
const stateDir = resolve(packageDir, ".state");
const promptPath = resolve(opencodeWorktree, "prompts", "deep-reader.md");
const translatorPromptPath = resolve(opencodeWorktree, "prompts", "translator.md");

type HostConfig = {
  bookToolBaseUrl: string;
  bookToolToken: string;
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  port: number;
  hostname: string;
  configPort: number;
};

type ProviderKind = "deepseek" | "openai" | "anthropic";

const providerEnv: Record<ProviderKind, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const defaultBaseUrl: Record<ProviderKind, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

const defaultModel: Record<ProviderKind, string> = {
  deepseek: "deepseek-v4-flash",
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-5",
};

function readHostConfig(): HostConfig {
  const provider = readProviderKind();
  return {
    bookToolBaseUrl:
      process.env.FOCUSED_READING_BOOK_TOOL_BASE_URL ?? "http://127.0.0.1:48173",
    bookToolToken: process.env.FOCUSED_READING_BOOK_TOOL_TOKEN ?? "",
    provider,
    apiKey: readProviderValue(provider, "API_KEY") ?? "",
    baseUrl:
      readProviderValue(provider, "BASE_URL") ??
      process.env.FOCUSED_READING_LLM_BASE_URL ??
      defaultBaseUrl[provider],
    model:
      process.env.FOCUSED_READING_OPENCODE_MODEL ??
      readProviderValue(provider, "MODEL") ??
      defaultModel[provider],
    port: Number(process.env.FOCUSED_READING_OPENCODE_PORT ?? "48172"),
    hostname: process.env.FOCUSED_READING_OPENCODE_HOST ?? "127.0.0.1",
    configPort: Number(process.env.FOCUSED_READING_AGENT_CONFIG_PORT ?? "48174"),
  };
}

function readProviderKind(): ProviderKind {
  const raw = (
    process.env.FOCUSED_READING_LLM_PROVIDER ??
    process.env.LLM_PROVIDER ??
    "deepseek"
  )
    .toLowerCase()
    .replaceAll("_", "");
  if (raw === "deepseek") return "deepseek";
  if (raw === "openai") return "openai";
  if (raw === "anthropic") return "anthropic";
  throw new Error(`Unsupported FOCUSED_READING_LLM_PROVIDER/LLM_PROVIDER: ${raw}`);
}

function readProviderValue(provider: ProviderKind, suffix: "API_KEY" | "BASE_URL" | "MODEL") {
  const prefix = provider === "deepseek" ? "DEEPSEEK" : provider.toUpperCase();
  return (
    process.env[`FOCUSED_READING_${prefix}_${suffix}`] ??
    process.env[`${prefix}_${suffix}`]
  );
}

function buildOpencodeConfig(
  config: HostConfig,
  prompt: string,
  translatorPrompt: string,
): Config {
  const providerConfig = buildProviderConfig(config);
  return {
    model: `${config.provider}/${config.model}`,
    share: "disabled",
    autoupdate: false,
    provider: providerConfig,
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
      external_directory: "deny",
    },
    tools: {
      bash: false,
      edit: false,
      webfetch: false,
      websearch: false,
      read: false,
      grep: false,
      glob: false,
      task: false,
      todowrite: false,
    },
    agent: {
      deep_reader: {
        description: "Grounded PDF selected-passage deep reading agent",
        mode: "primary",
        maxSteps: 6,
        model: `${config.provider}/${config.model}`,
        prompt,
        permission: {
          edit: "deny",
          bash: "deny",
          webfetch: "deny",
          external_directory: "deny",
        },
        tools: {
          bash: false,
          edit: false,
          webfetch: false,
          websearch: false,
          read: false,
          grep: false,
          glob: false,
          task: false,
          todowrite: false,
          book_search: true,
          book_get_chunk: true,
          book_get_neighbors: true,
          book_structure: true,
        },
      },
      translator: {
        description:
          "App-owned block-aligned translator agent. Runs a baoyu-aligned translation flow inside a sandbox workspace, preserving [[B###]] block markers.",
        mode: "primary",
        // Translation is multi-step: analyze terminology, translate each page block-by-block, optionally review.
        maxSteps: 24,
        model: `${config.provider}/${config.model}`,
        prompt: translatorPrompt,
        permission: {
          // File + shell allowed so the agent can read page sources and write
          // translation outputs, but locked to the sandbox cwd; never web.
          edit: "allow",
          bash: "allow",
          webfetch: "deny",
          external_directory: "deny",
        },
        tools: {
          bash: true,
          edit: true,
          write: true,
          read: true,
          grep: true,
          glob: true,
          task: true,
          todowrite: true,
          webfetch: false,
          websearch: false,
          // Book tools available for cross-page terminology alignment if needed.
          book_search: true,
          book_get_chunk: true,
          book_get_neighbors: true,
          book_structure: true,
        },
      },
    },
  };
}

function buildProviderConfig(config: HostConfig): NonNullable<Config["provider"]> {
  const base = {
    deepseek: {
      name: "DeepSeek",
      npm: "@ai-sdk/openai-compatible",
      api: config.baseUrl,
      env: [providerEnv.deepseek],
      options: {
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      },
      models: {
        [config.model]: {
          id: config.model,
          name: config.model,
          tool_call: true,
          temperature: true,
        },
      },
    },
    openai: {
      name: "OpenAI",
      npm: "@ai-sdk/openai",
      env: [providerEnv.openai],
      options: {
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      },
      models: {
        [config.model]: {
          id: config.model,
          name: config.model,
          tool_call: true,
          temperature: true,
        },
      },
    },
    anthropic: {
      name: "Anthropic",
      npm: "@ai-sdk/anthropic",
      env: [providerEnv.anthropic],
      options: {
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      },
      models: {
        [config.model]: {
          id: config.model,
          name: config.model,
          tool_call: true,
          temperature: true,
        },
      },
    },
  } satisfies NonNullable<Config["provider"]>;

  return { [config.provider]: base[config.provider] };
}

function redactConfig(config: HostConfig) {
  return {
    provider: config.provider,
    model: `${config.provider}/${config.model}`,
    baseUrl: config.baseUrl,
    apiKeyConfigured: config.apiKey.trim().length > 0,
    opencodePort: config.port,
    configPort: config.configPort,
    bookToolBaseUrl: config.bookToolBaseUrl,
    bookToolTokenConfigured: config.bookToolToken.trim().length > 0,
  };
}

function startConfigServer(config: HostConfig) {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "GET" || request.url !== "/config") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(redactConfig(config)));
  });

  server.listen(config.configPort, config.hostname);
  return server;
}

async function main() {
  const config = readHostConfig();

  if (!config.bookToolToken) {
    console.warn(
      "FOCUSED_READING_BOOK_TOOL_TOKEN is empty. Book tools should be protected before product use.",
    );
  }

  await mkdir(stateDir, { recursive: true });
  const prompt = await readFile(promptPath, "utf8");
  const translatorPrompt = await readFile(translatorPromptPath, "utf8");
  const configServer = startConfigServer(config);

  // OpenCode discovers .opencode/tools relative to the server process cwd.
  process.chdir(opencodeWorktree);

  const opencode = await createOpencode({
    hostname: config.hostname,
    port: config.port,
    timeout: 10_000,
    config: buildOpencodeConfig(config, prompt, translatorPrompt),
  });

  console.log(
    JSON.stringify({
      type: "agent_host_ready",
      serverUrl: opencode.server.url,
      worktree: opencodeWorktree,
      stateDir,
      config: redactConfig(config),
    }),
  );

  process.on("SIGINT", () => {
    configServer.close();
    opencode.server.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    configServer.close();
    opencode.server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
