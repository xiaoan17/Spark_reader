# OpenCode Reader Agent

> Status: experimental and not wired into the shipped product. The current
> product RAG loop runs inside the Rust process through `src-tauri/src/interpretation.rs`;
> this OpenCode host is not started by Tauri, is not bundled in release builds,
> and has no Rust book-tool HTTP server connected today.

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

## P5 Wiring Checklist — connecting the real runner

> Status (2026-06-08): The AI workbench「任务」区 ships with `MockAgentTaskRunner` as the
> default. A real `OpencodeAgentTaskRunner` skeleton exists at
> `src/core/agent-task/opencode-runner.ts` (fetch-only, no SDK dep) but is NOT enabled.
> `createAgentTaskRunner()` still returns the mock. Below is what remains to make the
> real runner work end-to-end. None of this is verifiable without a running host + a real
> provider key, so it is intentionally left as a checklist rather than half-wired code.

### Done (frontend, testable today)
- `AgentTaskRunner` adapter interface + `MockAgentTaskRunner` (`src/core/agent-task/`).
- Task artifacts → `kb_cards`: `agentTaskToKnowledgeCardRequests()` maps a finished
  `AgentTask` to candidate `KnowledgeCard` upserts; App.tsx persists them to the book the
  task was STARTED for (not the currently-open book) via `persistAgentTaskCards`, with a
  double-persist guard (`persistedAgentTaskIds`).
- `OpencodeAgentTaskRunner` skeleton + pure `translateOpencodeEventToAgentTask` (unit-tested
  against synthetic events).

### TODO 1 — Tauri spawns the host sidecar
- On app start (Tauri side, Rust), spawn `agent-host` (`pnpm --filter @focused-reading/agent-host start`
  or a bundled node), injecting provider env (`FOCUSED_READING_LLM_PROVIDER` + the matching
  `*_API_KEY` / `*_BASE_URL` / `*_MODEL`) from the existing settings/provider surface.
- Parse the `agent_host_ready` JSON line from stdout to learn `serverUrl`; pass that base URL
  to the frontend (e.g. a Tauri command `get_agent_host_url`) instead of the hardcoded
  `DEFAULT_OPENCODE_BASE_URL`.
- Generate a per-run `FOCUSED_READING_BOOK_TOOL_TOKEN` and pass it to the host.
- Tear the sidecar down on app exit (SIGTERM).

### TODO 2 — Rust book-tool HTTP server (does not exist today)
- Stand up an HTTP server in the Rust core on `FOCUSED_READING_BOOK_TOOL_BASE_URL`
  (default `http://127.0.0.1:48173`) exposing the four allowed tools:
  `book_search`, `book_get_chunk`, `book_get_neighbors`, `book_structure`.
- Auth every request with `FOCUSED_READING_BOOK_TOOL_TOKEN`.
- These map onto existing retrieval in `src-tauri/src/interpretation.rs` / search; reuse, don't
  duplicate. Citations must return literal `[chunk_id]` so the agent can preserve them.
- Wire the host's `agent-host/opencode/.opencode/tools` to call this server.

### TODO 3 — verify the skeleton against opencode-ai@1.15.13, then enable
- Verify the route constants in `opencode-runner.ts` (`SESSION_CREATE_PATH`,
  `SESSION_PROMPT_PATH`, `SESSION_ABORT_PATH`, `EVENT_SUBSCRIBE_PATH`) and the SSE event
  schema against the real server (the SDK's `OpencodeClient` in
  `agent-host/node_modules/@opencode-ai/sdk` is the reference: `session.create`,
  `session.prompt`, `session.abort`, `event.subscribe`).
- Fix `translateOpencodeEventToAgentTask` to match real event `type`/`status` fields and to
  attach real evidence (`step.evidence[].chunkId`) from tool-result events — that evidence is
  what flows into `kb_cards` and powers citation jump-back.
- Flip `createAgentTaskRunner()` to return `new OpencodeAgentTaskRunner({ baseUrl })` (guarded
  by a settings flag + host-ready check), keeping the mock as fallback when the host is down.

### End-to-end smoke test (manual, once wired)
1. Set a provider key in settings; start the app (Tauri spawns host).
2. Open a book, switch to「任务」, run「整理本章论证结构」.
3. Confirm: planning→running→done steps stream in; on done, a candidate KnowledgeCard
   appears in the top-bar knowledge view, bound to the correct book, with citations that
   jump back to the source chunk.
