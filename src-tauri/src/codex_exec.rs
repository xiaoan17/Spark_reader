//! Shared runner for headless `codex exec` invocations (Spark deep reading and
//! block-aligned translation both go through here).
//!
//! Verified against codex-cli 0.142.5 (2026-07-07, see
//! `docs/[todo]20260707_稳健化-Obsidian-Agent引擎计划.md` C 节调研):
//!   - `codex exec --json` emits JSONL events: `thread.started` (thread_id),
//!     `turn.started`, `item.started`/`item.completed` (agent_message /
//!     command_execution / mcp_tool_call items), `turn.completed` (usage).
//!   - `-c 'mcp_servers={...}'` REPLACES the whole table, so each invocation
//!     fully controls which MCP servers load — the user's global
//!     `~/.codex/config.toml` servers never leak in. An unreachable MCP server
//!     is non-fatal (codex logs and continues).
//!   - Sandbox/approvals must be passed explicitly; the user's global config
//!     may be `danger-full-access` and must never be inherited.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// Env var read by codex for the book-tool MCP bearer token
/// (`bearer_token_env_var` in the mcp_servers override).
pub const BOOK_TOOL_TOKEN_ENV: &str = "FOCUSED_READING_BOOK_TOOL_TOKEN";

#[derive(Debug, Clone)]
pub struct BookToolsMcp {
    pub mcp_url: String,
    pub token: String,
}

/// Drive codex with the app-configured model through the local Responses bridge
/// (C8). When present, codex is pointed at a custom `wire_api="responses"`
/// provider served by `responses_bridge`, and its `CODEX_HOME` is isolated so
/// none of the user's `~/.codex` login/config/instructions leak in. When absent,
/// codex uses its own machine-local login (the "codex-local" model source).
#[derive(Debug, Clone)]
pub struct BridgeProvider {
    /// Bridge base URL, e.g. `http://127.0.0.1:48174/v1`.
    pub base_url: String,
    /// Per-run bearer token codex sends to the bridge (NOT the provider key).
    pub token: String,
    /// The app-configured model name codex should request.
    pub model: String,
}

#[derive(Debug, Clone)]
pub struct CodexInvocation {
    pub prompt: String,
    /// Attach the book-tool MCP server; `None` runs tool-less (translation).
    pub book_tools: Option<BookToolsMcp>,
    /// Drive codex with the app model via the Responses bridge; `None` keeps
    /// codex's machine-local login (codex-local model source).
    pub provider: Option<BridgeProvider>,
    pub timeout: Duration,
}

#[derive(Debug, Default)]
pub struct CodexOutcome {
    pub thread_id: Option<String>,
    /// Last agent_message text of the turn (the final answer).
    pub final_message: String,
    /// Raw completed items (agent messages and tool calls) for callers that
    /// mine tool outputs (e.g. chunk_id extraction).
    pub completed_items: Vec<serde_json::Value>,
}

#[derive(Debug)]
pub enum CodexEvent {
    ThreadStarted(String),
    /// A tool-ish item began executing (mcp_tool_call / command_execution).
    ToolStarted,
    AgentMessage(String),
    ItemCompleted(serde_json::Value),
    TurnCompleted,
    Fatal(String),
    Other,
}

#[derive(Debug)]
pub enum CodexExecError {
    Cancelled,
    Unavailable(String),
    Timeout,
    Failed(String),
    Empty,
}

impl std::fmt::Display for CodexExecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CodexExecError::Cancelled => write!(f, "cancelled"),
            CodexExecError::Unavailable(msg) => write!(f, "codex unavailable: {msg}"),
            CodexExecError::Timeout => write!(f, "codex exec timeout"),
            CodexExecError::Failed(msg) => write!(f, "codex exec failed: {msg}"),
            CodexExecError::Empty => write!(f, "codex returned an empty answer"),
        }
    }
}

/// Resolve the codex binary. GUI-launched Tauri apps get a minimal PATH on
/// macOS, so fall back to the standard Homebrew/user locations.
pub fn codex_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("FOCUSED_READING_CODEX_BIN") {
        let path = PathBuf::from(explicit.trim());
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("codex");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    for fallback in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        let candidate = PathBuf::from(fallback);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Neutral working directory for codex runs — never the user's repo/home, so
/// read-only shell commands the model might run see nothing sensitive by default.
fn workspace_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("focused-reading-codex-workspace");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Isolated `CODEX_HOME` for bridge-driven runs. Pointing codex here (instead of
/// the default `~/.codex`) keeps the user's login/auth, global config, and
/// global instructions from leaking into app-model runs — the whole point of
/// the C8 bridge. Empty is fine: all provider wiring comes via `-c` overrides.
fn isolated_codex_home() -> PathBuf {
    let dir = std::env::temp_dir().join("focused-reading-codex-home");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The `-c model_providers.spark=...` override wiring codex to the local
/// Responses bridge. `env_key` names the env var codex sends as the bearer
/// token; the real provider key never enters codex's environment.
fn spark_provider_override(provider: &BridgeProvider) -> String {
    format!(
        "model_providers.spark={{name=\"spark\",base_url=\"{}\",env_key=\"{}\",wire_api=\"responses\"}}",
        provider.base_url,
        crate::responses_bridge::BRIDGE_TOKEN_ENV,
    )
}

/// The `-c mcp_servers=...` override value. Whole-table replacement (verified):
/// with book tools only the books server loads; without, no MCP servers load.
fn mcp_servers_override(book_tools: &Option<BookToolsMcp>) -> String {
    match book_tools {
        Some(tools) => format!(
            "mcp_servers={{books={{url=\"{}\",bearer_token_env_var=\"{BOOK_TOOL_TOKEN_ENV}\",startup_timeout_sec=20}}}}",
            tools.mcp_url
        ),
        None => "mcp_servers={}".to_string(),
    }
}

/// Classify one `codex exec --json` stdout line. Unknown event/item types map
/// to `Other` so schema additions in future codex versions degrade gracefully.
pub fn parse_event_line(line: &str) -> CodexEvent {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return CodexEvent::Other;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return CodexEvent::Other;
    };
    let event_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match event_type {
        "thread.started" => value
            .get("thread_id")
            .and_then(|v| v.as_str())
            .map(|id| CodexEvent::ThreadStarted(id.to_string()))
            .unwrap_or(CodexEvent::Other),
        "item.started" => {
            let item_type = value
                .get("item")
                .and_then(|item| item.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if matches!(item_type, "mcp_tool_call" | "command_execution") {
                CodexEvent::ToolStarted
            } else {
                CodexEvent::Other
            }
        }
        "item.completed" => {
            let Some(item) = value.get("item") else {
                return CodexEvent::Other;
            };
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if item_type == "agent_message" {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    return CodexEvent::AgentMessage(text.to_string());
                }
            }
            CodexEvent::ItemCompleted(item.clone())
        }
        "turn.completed" => CodexEvent::TurnCompleted,
        "turn.failed" | "error" => {
            let message = value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
                .or_else(|| value.get("message").and_then(|v| v.as_str()))
                .unwrap_or("codex reported an error");
            CodexEvent::Fatal(message.to_string())
        }
        _ => CodexEvent::Other,
    }
}

/// Run one headless codex turn. `on_event` sees every classified event (for UI
/// progress); `should_cancel` is polled between events and kills the child.
pub async fn run(
    invocation: CodexInvocation,
    mut on_event: impl FnMut(&CodexEvent),
    should_cancel: impl Fn() -> bool,
) -> Result<CodexOutcome, CodexExecError> {
    let binary = codex_binary()
        .ok_or_else(|| CodexExecError::Unavailable("codex binary not found".to_string()))?;

    let mut command = Command::new(binary);
    command
        .arg("exec")
        .arg("--json")
        .arg("--skip-git-repo-check")
        // Explicit hard boundaries — never inherit the user's global sandbox
        // (which may be danger-full-access) or approval policy. `exec` has no
        // --ask-for-approval flag (it is headless by design); approval_policy
        // goes through -c for explicitness.
        .arg("--sandbox")
        .arg("read-only")
        .arg("-c")
        .arg("approval_policy=\"never\"")
        .arg("--cd")
        .arg(workspace_dir())
        .arg("-c")
        .arg(mcp_servers_override(&invocation.book_tools))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(tools) = &invocation.book_tools {
        command.env(BOOK_TOOL_TOKEN_ENV, &tools.token);
    }
    // C8: when the app model drives codex, point it at the local Responses
    // bridge and isolate CODEX_HOME so ~/.codex login/config/instructions never
    // leak in. Without a provider, codex keeps its own machine-local login.
    if let Some(provider) = &invocation.provider {
        command
            .env("CODEX_HOME", isolated_codex_home())
            .env(crate::responses_bridge::BRIDGE_TOKEN_ENV, &provider.token)
            .arg("-c")
            .arg("model_provider=\"spark\"")
            .arg("-c")
            .arg(format!("model=\"{}\"", provider.model))
            .arg("-c")
            .arg(spark_provider_override(provider));
    }
    // Prompt arrives via stdin ("-") so long selections never hit argv limits.
    // Must be the final positional arg (after all `-c` overrides).
    command.arg("-");

    let mut child = command
        .spawn()
        .map_err(|err| CodexExecError::Unavailable(format!("spawn failed: {err}")))?;

    // Feed the prompt and close stdin so codex starts the turn.
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| CodexExecError::Failed("codex stdin unavailable".to_string()))?;
        stdin
            .write_all(invocation.prompt.as_bytes())
            .await
            .map_err(|err| CodexExecError::Failed(format!("write prompt: {err}")))?;
        stdin
            .shutdown()
            .await
            .map_err(|err| CodexExecError::Failed(format!("close stdin: {err}")))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CodexExecError::Failed("codex stdout unavailable".to_string()))?;
    let mut lines = BufReader::new(stdout).lines();

    let started = std::time::Instant::now();
    let mut outcome = CodexOutcome::default();
    let mut turn_completed = false;

    loop {
        if should_cancel() {
            let _ = child.kill().await;
            return Err(CodexExecError::Cancelled);
        }
        if started.elapsed() > invocation.timeout {
            let _ = child.kill().await;
            return Err(CodexExecError::Timeout);
        }

        let next = tokio::time::timeout(Duration::from_secs(2), lines.next_line()).await;
        let line = match next {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => break, // stdout closed — child is done
            Ok(Err(err)) => {
                let _ = child.kill().await;
                return Err(CodexExecError::Failed(format!("read stdout: {err}")));
            }
            Err(_) => continue, // 2s poll tick; re-check cancel/timeout
        };

        let event = parse_event_line(&line);
        on_event(&event);
        match event {
            CodexEvent::ThreadStarted(id) => outcome.thread_id = Some(id),
            CodexEvent::AgentMessage(text) => outcome.final_message = text,
            CodexEvent::ItemCompleted(item) => outcome.completed_items.push(item),
            CodexEvent::TurnCompleted => {
                turn_completed = true;
                // Keep draining until stdout closes so the child exits cleanly.
            }
            CodexEvent::Fatal(message) => {
                let _ = child.kill().await;
                return Err(CodexExecError::Failed(message));
            }
            CodexEvent::ToolStarted | CodexEvent::Other => {}
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|err| CodexExecError::Failed(format!("wait: {err}")))?;
    if !turn_completed && !status.success() {
        return Err(CodexExecError::Failed(format!(
            "codex exited with {status} before completing the turn"
        )));
    }
    if outcome.final_message.trim().is_empty() {
        return Err(CodexExecError::Empty);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thread_started() {
        let event = parse_event_line(r#"{"type":"thread.started","thread_id":"abc-123"}"#);
        assert!(matches!(event, CodexEvent::ThreadStarted(id) if id == "abc-123"));
    }

    #[test]
    fn parses_agent_message() {
        let event = parse_event_line(
            r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}"#,
        );
        assert!(matches!(event, CodexEvent::AgentMessage(text) if text == "pong"));
    }

    #[test]
    fn parses_tool_item_lifecycle() {
        let started = parse_event_line(
            r#"{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","status":"in_progress"}}"#,
        );
        assert!(matches!(started, CodexEvent::ToolStarted));

        let completed = parse_event_line(
            r#"{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","output":"[{\"chunkId\":\"b::p::c\"}]"}}"#,
        );
        match completed {
            CodexEvent::ItemCompleted(item) => {
                assert_eq!(item["type"], "mcp_tool_call");
            }
            other => panic!("expected ItemCompleted, got {other:?}"),
        }
    }

    #[test]
    fn parses_turn_completed_and_errors() {
        assert!(matches!(
            parse_event_line(r#"{"type":"turn.completed","usage":{"input_tokens":1}}"#),
            CodexEvent::TurnCompleted
        ));
        assert!(matches!(
            parse_event_line(r#"{"type":"error","message":"boom"}"#),
            CodexEvent::Fatal(msg) if msg == "boom"
        ));
        assert!(matches!(
            parse_event_line(r#"{"type":"turn.failed","error":{"message":"bad"}}"#),
            CodexEvent::Fatal(msg) if msg == "bad"
        ));
    }

    #[test]
    fn unknown_events_and_garbage_are_other() {
        assert!(matches!(
            parse_event_line(r#"{"type":"future.event"}"#),
            CodexEvent::Other
        ));
        assert!(matches!(parse_event_line("not json"), CodexEvent::Other));
        assert!(matches!(parse_event_line(""), CodexEvent::Other));
    }

    #[test]
    fn mcp_override_replaces_whole_table() {
        let with_tools = mcp_servers_override(&Some(BookToolsMcp {
            mcp_url: "http://127.0.0.1:48173/mcp".to_string(),
            token: "t".to_string(),
        }));
        assert_eq!(
            with_tools,
            "mcp_servers={books={url=\"http://127.0.0.1:48173/mcp\",bearer_token_env_var=\"FOCUSED_READING_BOOK_TOOL_TOKEN\",startup_timeout_sec=20}}"
        );
        assert_eq!(mcp_servers_override(&None), "mcp_servers={}");
    }
}
