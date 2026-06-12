//! Agent-host supervisor: owns the lifecycle of the out-of-process OpenCode
//! sidecar plus the in-process book-tool HTTP server it depends on.
//!
//! On app startup (`init`) we:
//!   1. mint a per-run book-tool bearer token,
//!   2. start the book-tool HTTP server (see `book_tool_server`),
//!   3. spawn the `agent-host` Node sidecar, injecting provider creds + the
//!      book-tool base url/token via env,
//!   4. parse the sidecar's `agent_host_ready` stdout line to learn its
//!      OpenCode server URL.
//!
//! The resolved URL + token are kept in a global so Tauri commands
//! (`get_agent_host_url`) and the Spark/translation OpenCode paths can read
//! them. Provider keys only ever travel Rust -> sidecar env; they never reach
//! the frontend.
//!
//! Failure is non-fatal: if the sidecar can't start (no node, no provider key,
//! port busy) we simply leave the host URL `None` and callers fall back to the
//! in-process Rust pipelines.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::book_tool_server::{self, BookToolServerConfig};
use crate::config::{self, LlmProviderKind};

/// Global host state, populated by `init`. `None` host_url means the OpenCode
/// path is unavailable and callers should use the Rust fallback.
struct AgentHostState {
    host_url: Option<String>,
    book_tool_token: String,
    book_tool_port: u16,
    /// Kept alive so the child is not reaped while the app runs; killed on exit.
    child: Option<Child>,
}

static STATE: OnceLock<Mutex<AgentHostState>> = OnceLock::new();

fn state() -> &'static Mutex<AgentHostState> {
    STATE.get_or_init(|| {
        Mutex::new(AgentHostState {
            host_url: None,
            book_tool_token: String::new(),
            book_tool_port: 0,
            child: None,
        })
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHostStatus {
    pub host_url: Option<String>,
    pub book_tool_port: u16,
    pub ready: bool,
}

/// Whether the OpenCode path is enabled. Defaults OFF; opt in via env so the
/// migration can be rolled out behind a flag and instantly reverted.
pub fn opencode_enabled() -> bool {
    std::env::var("FOCUSED_READING_OPENCODE_ENABLED")
        .ok()
        .map(|value| {
            let v = value.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes" || v == "on"
        })
        .unwrap_or(false)
}

/// The resolved OpenCode server URL, if the sidecar is up.
pub fn host_url() -> Option<String> {
    state().lock().ok().and_then(|s| s.host_url.clone())
}

/// True when the OpenCode path is both enabled and the sidecar is ready.
pub fn ready() -> bool {
    opencode_enabled() && host_url().is_some()
}

pub fn status() -> AgentHostStatus {
    let guard = state().lock().ok();
    match guard {
        Some(s) => AgentHostStatus {
            host_url: s.host_url.clone(),
            book_tool_port: s.book_tool_port,
            ready: s.host_url.is_some(),
        },
        None => AgentHostStatus {
            host_url: None,
            book_tool_port: 0,
            ready: false,
        },
    }
}

/// Generate a per-run bearer token using the standard library's RandomState
/// (seeded from OS entropy each construction) without pulling in `rand`.
fn mint_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::with_capacity(48);
    // Combine several independently-seeded hashers for >128 bits of entropy.
    for _ in 0..3 {
        let hasher = RandomState::new().build_hasher();
        let value = hasher.finish();
        out.push_str(&format!("{value:016x}"));
    }
    out
}

fn provider_env_prefix(kind: LlmProviderKind) -> &'static str {
    match kind {
        LlmProviderKind::DeepSeek => "DEEPSEEK",
        LlmProviderKind::OpenAi => "OPENAI",
        LlmProviderKind::Anthropic => "ANTHROPIC",
    }
}

fn provider_label(kind: LlmProviderKind) -> &'static str {
    match kind {
        LlmProviderKind::DeepSeek => "deepseek",
        LlmProviderKind::OpenAi => "openai",
        LlmProviderKind::Anthropic => "anthropic",
    }
}

/// Resolve the agent-host package directory relative to the repo / bundle.
/// Dev: `<repo>/agent-host`. We resolve from the manifest dir at build time.
fn agent_host_dir() -> Option<PathBuf> {
    // Allow explicit override (useful for bundled installs).
    if let Ok(dir) = std::env::var("FOCUSED_READING_AGENT_HOST_DIR") {
        let path = PathBuf::from(dir);
        if path.exists() {
            return Some(path);
        }
    }
    // Dev layout: src-tauri/ is one level under the repo root; agent-host is a sibling.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir.parent().map(|p| p.join("agent-host"));
    candidate.filter(|p| p.exists())
}

/// Initialize the book-tool server and (best-effort) the OpenCode sidecar.
/// Always starts the book-tool server (cheap, in-process). Only spawns the
/// sidecar when `opencode_enabled()` and a provider key is configured.
pub fn init(db_path: PathBuf) {
    let token = mint_token();
    let port = book_tool_server::resolve_port();

    {
        let mut guard = state().lock().expect("agent host state poisoned");
        guard.book_tool_token = token.clone();
        guard.book_tool_port = port;
    }

    // Start the book-tool HTTP server on the existing tokio runtime.
    let server_config = BookToolServerConfig {
        db_path,
        token: token.clone(),
        port,
    };
    tauri::async_runtime::spawn(async move {
        match book_tool_server::spawn(server_config).await {
            Ok(addr) => {
                eprintln!("book-tool server listening on {addr}");
            }
            Err(err) => {
                eprintln!("book-tool server failed to start: {err}");
            }
        }
    });

    if !opencode_enabled() {
        eprintln!("OpenCode path disabled (FOCUSED_READING_OPENCODE_ENABLED not set); using Rust fallback.");
        return;
    }

    // Spawn the sidecar on a blocking thread so we can read its stdout line.
    let book_tool_token = token;
    let book_tool_port = port;
    std::thread::spawn(move || {
        if let Err(err) = spawn_sidecar(book_tool_token, book_tool_port) {
            eprintln!("agent-host sidecar not started: {err}");
        }
    });
}

fn spawn_sidecar(book_tool_token: String, book_tool_port: u16) -> Result<(), String> {
    let llm = config::llm_config().map_err(|err| format!("no llm config: {err}"))?;
    if llm.api_key.trim().is_empty() {
        return Err("provider api key not configured".to_string());
    }
    let host_dir = agent_host_dir().ok_or("agent-host directory not found")?;

    let prefix = provider_env_prefix(llm.provider);
    let provider = provider_label(llm.provider);

    let mut command = Command::new("pnpm");
    command
        .current_dir(&host_dir)
        .arg("--filter")
        .arg("@focused-reading/agent-host")
        // `dev` runs via tsx (no prior tsc build needed); `start` would require dist/.
        .arg("dev")
        .env("FOCUSED_READING_LLM_PROVIDER", provider)
        .env(format!("FOCUSED_READING_{prefix}_API_KEY"), &llm.api_key)
        .env(format!("FOCUSED_READING_{prefix}_BASE_URL"), &llm.base_url)
        .env(format!("FOCUSED_READING_{prefix}_MODEL"), &llm.model)
        .env(
            "FOCUSED_READING_BOOK_TOOL_BASE_URL",
            format!("http://127.0.0.1:{book_tool_port}"),
        )
        .env("FOCUSED_READING_BOOK_TOOL_TOKEN", &book_tool_token)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    let mut child = command
        .spawn()
        .map_err(|err| format!("failed to spawn agent-host: {err}"))?;

    let stdout = child.stdout.take().ok_or("agent-host stdout unavailable")?;

    // Read stdout looking for the ready JSON line. Keep reading afterwards so the
    // pipe never fills and blocks the child.
    let reader = BufReader::new(stdout);
    {
        let mut guard = state().lock().expect("agent host state poisoned");
        guard.child = Some(child);
    }

    for line in reader.lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(url) = parse_ready_line(trimmed) {
            eprintln!("agent-host ready at {url}");
            if let Ok(mut guard) = state().lock() {
                guard.host_url = Some(url);
            }
        }
    }
    Ok(())
}

/// Parse the `{"type":"agent_host_ready","serverUrl":"..."}` stdout line.
fn parse_ready_line(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "agent_host_ready" {
        return None;
    }
    value
        .get("serverUrl")?
        .as_str()
        .map(|url| url.trim_end_matches('/').to_string())
}

/// Terminate the sidecar on app exit.
pub fn shutdown() {
    if let Ok(mut guard) = state().lock() {
        if let Some(mut child) = guard.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.host_url = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ready_line() {
        let line =
            r#"{"type":"agent_host_ready","serverUrl":"http://127.0.0.1:48172/","worktree":"x"}"#;
        assert_eq!(
            parse_ready_line(line).as_deref(),
            Some("http://127.0.0.1:48172")
        );
    }

    #[test]
    fn ignores_non_ready_lines() {
        assert_eq!(parse_ready_line("plain log line"), None);
        assert_eq!(parse_ready_line(r#"{"type":"other"}"#), None);
    }

    #[test]
    fn mint_token_is_long_and_hex() {
        let token = mint_token();
        assert_eq!(token.len(), 48);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        // Two independent mints should differ.
        assert_ne!(token, mint_token());
    }

    #[test]
    fn provider_mappings() {
        assert_eq!(provider_env_prefix(LlmProviderKind::DeepSeek), "DEEPSEEK");
        assert_eq!(provider_label(LlmProviderKind::Anthropic), "anthropic");
    }
}
