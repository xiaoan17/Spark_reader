# OpenCode Reader Agent

This project embeds OpenCode as a constrained agent host for selected-passage PDF interpretation.

## Isolation

The app must not use the user's global OpenCode workspace, sessions, or running server.

- OpenCode runs from `agent-host/opencode`.
- Runtime state for the wrapper is written under `agent-host/.state/`, which is ignored by Git.
- The SDK server binds to `127.0.0.1` on `FOCUSED_READING_OPENCODE_PORT` (default `48172`).
- A read-only local config endpoint binds to `127.0.0.1` on `FOCUSED_READING_AGENT_CONFIG_PORT` (default `48174`) and exposes redacted status at `GET /config`.
- Book tools call the Rust core through `FOCUSED_READING_BOOK_TOOL_BASE_URL` and `FOCUSED_READING_BOOK_TOOL_TOKEN`.

This avoids conflicts with a user's normal `~/.config/opencode` setup and any manually running OpenCode instance. A port collision is still possible if the user has another service on `48172`; in that case set `FOCUSED_READING_OPENCODE_PORT` to another local port.

`agent-host` depends on pinned `opencode-ai@1.15.13`, so the SDK can launch the workspace-local CLI instead of relying on a user-managed global install.

## Provider Configuration

The app should keep Rust/settings UI as the single writable provider configuration surface. The agent host consumes that configuration through environment variables when Tauri starts the sidecar.

Provider selection:

- `FOCUSED_READING_LLM_PROVIDER`, falling back to `LLM_PROVIDER`
- supported values: `deepseek`, `openai`, `anthropic`

Provider credentials:

- DeepSeek: `FOCUSED_READING_DEEPSEEK_API_KEY` or `DEEPSEEK_API_KEY`
- OpenAI: `FOCUSED_READING_OPENAI_API_KEY` or `OPENAI_API_KEY`
- Anthropic: `FOCUSED_READING_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`

Provider base URL and model follow the same pattern, for example `FOCUSED_READING_DEEPSEEK_BASE_URL`, `DEEPSEEK_BASE_URL`, `FOCUSED_READING_DEEPSEEK_MODEL`, `DEEPSEEK_MODEL`.

Defaults:

- DeepSeek: `https://api.deepseek.com`, `deepseek-v4-flash`
- OpenAI: `https://api.openai.com/v1`, `gpt-5-mini`
- Anthropic: `https://api.anthropic.com`, `claude-sonnet-4-5`

The host injects these values into OpenCode's inline `provider` config. It does not use OpenCode's `/connect` flow and should not write provider credentials to the user's global OpenCode auth file.

## Agent Contract

The configured OpenCode agent is `deep_reader`.

It is intentionally not a coding agent:

- allowed tools: `book_search`, `book_get_chunk`, `book_get_neighbors`, `book_structure`
- denied by default: shell, edit, filesystem, web, subagents, and any undeclared tools
- citations: answers must preserve literal `[chunk_id]` references
- source of truth: Rust core owns PDF coordinates, anchors, SQLite, retrieval, and provider keys

OpenCode is only the conversation/session runner. Product state remains in the app database.

## Development

Install dependencies:

```sh
pnpm install
```

Start the isolated host:

```sh
FOCUSED_READING_BOOK_TOOL_TOKEN=dev-token pnpm --filter @focused-reading/agent-host dev
```

The host prints a JSON line with `type: "agent_host_ready"` when the OpenCode server is running.
