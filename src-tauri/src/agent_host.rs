//! Agent-engine supervisor: owns the book-tool HTTP/MCP server lifecycle and
//! probes Codex availability.
//!
//! Since the 2026-07 engine replacement (OpenCode sidecar -> per-request
//! `codex exec`, see `codex_exec`), there is no long-running agent process to
//! supervise. On app startup (`init`) we:
//!   1. mint a per-run book-tool bearer token,
//!   2. start the book-tool HTTP server (see `book_tool_server`), which also
//!      exposes the MCP streamable-HTTP endpoint codex connects to,
//!   3. probe the codex binary in the background to decide engine readiness.
//!
//! Failure is non-fatal: when codex is missing or disabled, Spark and
//! translation fall back to the in-process Rust pipelines exactly as before.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::book_tool_server::{self, BookToolServerConfig};
use crate::codex_exec;
use crate::responses_bridge::{self, ResponsesBridgeConfig};

struct AgentHostState {
    book_tool_token: String,
    book_tool_port: u16,
    /// Per-run bearer token + port for the local Responses bridge (C8).
    bridge_token: String,
    bridge_port: u16,
    codex_available: bool,
}

static STATE: OnceLock<Mutex<AgentHostState>> = OnceLock::new();

fn state() -> &'static Mutex<AgentHostState> {
    STATE.get_or_init(|| {
        Mutex::new(AgentHostState {
            book_tool_token: String::new(),
            book_tool_port: 0,
            bridge_token: String::new(),
            bridge_port: 0,
            codex_available: false,
        })
    })
}

/// Kept shape-compatible with the frontend's AgentHostStatus consumer.
/// `host_url` is always `None` now (there is no long-running engine server);
/// the AI workbench keeps using its built-in fallback until it gets its own
/// codex bridge command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHostStatus {
    pub host_url: Option<String>,
    pub book_tool_port: u16,
    pub ready: bool,
    pub engine: &'static str,
}

/// Whether the Codex engine path is enabled. Defaults ON (codex IS the
/// scaffold); set `FOCUSED_READING_CODEX_DISABLED=1` to force the Rust
/// in-process pipelines.
pub fn codex_enabled() -> bool {
    !std::env::var("FOCUSED_READING_CODEX_DISABLED")
        .ok()
        .map(|value| {
            let v = value.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes" || v == "on"
        })
        .unwrap_or(false)
}

/// True when the Codex path is enabled and the binary was found.
pub fn ready() -> bool {
    codex_enabled()
        && state()
            .lock()
            .ok()
            .map(|s| s.codex_available)
            .unwrap_or(false)
}

/// Book-tool MCP endpoint + token for `codex_exec` invocations.
pub fn book_tools_mcp() -> Option<codex_exec::BookToolsMcp> {
    let guard = state().lock().ok()?;
    if guard.book_tool_token.is_empty() || guard.book_tool_port == 0 {
        return None;
    }
    Some(codex_exec::BookToolsMcp {
        mcp_url: format!("http://127.0.0.1:{}/mcp", guard.book_tool_port),
        token: guard.book_tool_token.clone(),
    })
}

/// The Responses bridge provider for `codex_exec`, resolved against the current
/// Agent model-source setting. Returns `None` — meaning "let codex use its own
/// machine-local login" — when the source is `CodexLocal`, when the bridge is
/// not up, or when the app's LLM config can't be resolved (e.g. no key). The
/// provider key never appears here; only the app model name and the bridge's own
/// bearer token do.
pub fn bridge_provider() -> Option<codex_exec::BridgeProvider> {
    if !matches!(
        crate::config::agent_model_source(),
        crate::config::AgentModelSource::App
    ) {
        return None;
    }
    let (token, port) = {
        let guard = state().lock().ok()?;
        (guard.bridge_token.clone(), guard.bridge_port)
    };
    if token.is_empty() || port == 0 {
        return None;
    }
    // Model name comes from the app's LLM config; if it can't resolve (missing
    // key), fall back to codex-local rather than driving codex with no model.
    let model = crate::config::llm_config().ok()?.model;
    Some(codex_exec::BridgeProvider {
        base_url: format!("http://127.0.0.1:{port}/v1"),
        token,
        model,
    })
}

pub fn status() -> AgentHostStatus {
    let (port, available) = state()
        .lock()
        .ok()
        .map(|s| (s.book_tool_port, s.codex_available))
        .unwrap_or((0, false));
    AgentHostStatus {
        host_url: None,
        book_tool_port: port,
        ready: codex_enabled() && available,
        engine: "codex",
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

/// Initialize the book-tool server and probe codex availability.
pub fn init(db_path: PathBuf) {
    let token = mint_token();
    let port = book_tool_server::resolve_port();
    let bridge_token = mint_token();
    let bridge_port = responses_bridge::resolve_port();

    {
        let mut guard = state().lock().expect("agent host state poisoned");
        guard.book_tool_token = token.clone();
        guard.book_tool_port = port;
        guard.bridge_token = bridge_token.clone();
        guard.bridge_port = bridge_port;
    }

    // Start the book-tool HTTP/MCP server on the existing tokio runtime.
    let book_tool_token_for_bridge = token.clone();
    let server_config = BookToolServerConfig {
        db_path,
        token,
        port,
    };
    tauri::async_runtime::spawn(async move {
        match book_tool_server::spawn(server_config).await {
            Ok(addr) => {
                eprintln!("book-tool server listening on {addr} (MCP at /mcp)");
            }
            Err(err) => {
                eprintln!("book-tool server failed to start: {err}");
            }
        }
    });

    // Start the local Responses bridge (C8) so the app-configured model can
    // drive codex without inheriting the machine's ~/.codex login. The bridge
    // executes codex's namespaced MCP book tools itself (codex can't route them
    // for custom Responses providers), so it needs the book-tool endpoint.
    let bridge_config = ResponsesBridgeConfig {
        token: bridge_token,
        port: bridge_port,
        book_tool_base: format!("http://127.0.0.1:{port}"),
        book_tool_token: book_tool_token_for_bridge,
    };
    tauri::async_runtime::spawn(async move {
        match responses_bridge::spawn(bridge_config).await {
            Ok(addr) => {
                eprintln!("responses bridge listening on {addr} (Responses API at /v1/responses)");
            }
            Err(err) => {
                eprintln!("responses bridge failed to start: {err}");
            }
        }
    });

    if !codex_enabled() {
        eprintln!("Codex engine disabled (FOCUSED_READING_CODEX_DISABLED); using Rust fallback.");
        return;
    }

    // Probe on a background thread so a slow filesystem never delays startup.
    std::thread::spawn(|| {
        let available = codex_exec::codex_binary().is_some();
        if available {
            eprintln!("codex binary found; Codex engine ready");
        } else {
            eprintln!("codex binary not found; Spark/translation will use the Rust fallback");
        }
        if let Ok(mut guard) = state().lock() {
            guard.codex_available = available;
        }
    });
}

/// App-exit hook. Per-request codex children use `kill_on_drop`, so there is
/// no persistent process to terminate here anymore.
pub fn shutdown() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_token_is_long_and_hex() {
        let token = mint_token();
        assert_eq!(token.len(), 48);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        // Two independent mints should differ.
        assert_ne!(token, mint_token());
    }

    #[test]
    fn status_never_exposes_a_host_url() {
        assert!(status().host_url.is_none());
    }
}
