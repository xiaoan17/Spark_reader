//! Local Responses API bridge: lets the app-configured LLM (default DeepSeek)
//! drive `codex exec`, instead of codex inheriting the machine's `~/.codex`
//! login. This is the C8 bridge (see
//! `docs/[todo]20260709_C9-spike-opencode验证记录.md` for why we stayed on Codex
//! and bridge the provider rather than switching engines).
//!
//! codex is configured with a custom `wire_api="responses"` provider whose
//! `base_url` points here (`http://127.0.0.1:<port>/v1`). It POSTs OpenAI
//! Responses API requests to `/v1/responses`. We:
//!   1. authenticate codex with a per-run bearer token (the real provider key
//!      never enters codex's environment — it stays in Rust/keychain),
//!   2. translate the Responses request into an app-provider chat call
//!      (`llm::complete_for_bridge`, OpenAI-compatible or Anthropic),
//!   3. translate the result back into the Responses SSE event stream codex
//!      consumes — including function-call round-trips, which are the lifeline
//!      of Spark's book tools.
//!
//! The exact request/response subset was captured from real codex-cli 0.142.5
//! (see the module tests and the C8 handoff notes): request top-level fields
//! `model`, `instructions`, `input` (message / function_call /
//! function_call_output items), `tools` (function / namespace / web_search),
//! `tool_choice`, `parallel_tool_calls`, `stream`; response SSE events
//! `response.created`, `response.output_item.added`,
//! `response.output_text.delta` / `.done`, `response.function_call_arguments.*`,
//! `response.output_item.done`, `response.completed`.
//!
//! Like `book_tool_server`, a minimal handwritten HTTP/1.1 server over tokio
//! (no web framework) serving a single trusted localhost client.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use std::collections::BTreeMap;

use crate::llm::{BridgeCompletion, ChatMessage, ChatRequest, ToolCall, ToolDefinition};

/// Responses requests carry the full instruction preamble (~20 KB) plus the
/// running conversation and tool schemas, so the cap is far larger than the
/// book-tool server's tiny-JSON limit.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Default output token budget when codex omits `max_output_tokens` (it does in
/// the captured requests). Generous enough for a deep-reading synthesis turn.
const DEFAULT_MAX_TOKENS: u32 = 8192;
const DEFAULT_TEMPERATURE: f32 = 0.3;

/// Retry budget for provider rate limiting. The C9 spike found DeepSeek governor
/// -limits larger tool-bearing requests; we back off and retry a few times
/// before surfacing the failure (which lets codex_exec fall back to Rust).
const MAX_PROVIDER_ATTEMPTS: u32 = 4;
const BACKOFF_BASE: Duration = Duration::from_millis(500);

/// Env var codex sends as the bearer token for the bridge provider
/// (`env_key="SPARK_BRIDGE_TOKEN"` in the injected `model_providers.spark`).
pub const BRIDGE_TOKEN_ENV: &str = "SPARK_BRIDGE_TOKEN";

#[derive(Clone)]
pub struct ResponsesBridgeConfig {
    pub token: String,
    pub port: u16,
    /// Base URL of the book-tool server (e.g. `http://127.0.0.1:48173`) and its
    /// bearer token. The bridge executes codex's namespaced MCP book tools here
    /// itself — see [`run_agentic_turn`] for why codex can't route them.
    pub book_tool_base: String,
    pub book_tool_token: String,
}

/// Cap on bridge-internal tool round-trips per codex turn, so a misbehaving
/// model can't loop forever inside one Responses request.
const MAX_TOOL_ITERATIONS: u32 = 16;

/// Test-only counter of book tools the bridge executed, so the live smoke can
/// assert real tool use even though codex never sees an `mcp_tool_call`.
#[cfg(test)]
pub(crate) static BOOK_TOOLS_EXECUTED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// Resolve the bridge port, honoring an override env var for collision recovery.
pub fn resolve_port() -> u16 {
    std::env::var("FOCUSED_READING_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(48174)
}

/// Spawn the bridge server on a tokio task. Binds only to 127.0.0.1.
pub async fn spawn(config: ResponsesBridgeConfig) -> std::io::Result<SocketAddr> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, config.port));
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    let shared = Arc::new(config);
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer)) => {
                    let shared = Arc::clone(&shared);
                    tokio::spawn(async move {
                        if let Err(err) = serve_connection(stream, shared).await {
                            eprintln!("responses-bridge connection ended: {err}");
                        }
                    });
                }
                Err(err) => {
                    eprintln!("responses-bridge accept failed: {err}");
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });
    Ok(local_addr)
}

#[derive(Debug)]
enum ConnError {
    Closed,
    Io(std::io::Error),
    BadRequest(&'static str),
    Timeout,
}

impl std::fmt::Display for ConnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnError::Closed => write!(f, "connection closed"),
            ConnError::Io(err) => write!(f, "io error: {err}"),
            ConnError::BadRequest(msg) => write!(f, "bad request: {msg}"),
            ConnError::Timeout => write!(f, "read timeout"),
        }
    }
}

impl From<std::io::Error> for ConnError {
    fn from(err: std::io::Error) -> Self {
        ConnError::Io(err)
    }
}

struct ParsedRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    body: Vec<u8>,
}

async fn serve_connection(
    mut stream: TcpStream,
    config: Arc<ResponsesBridgeConfig>,
) -> Result<(), ConnError> {
    // One request per connection (we answer with `Connection: close`), so no
    // keep-alive carry is needed.
    let request = match read_request(&mut stream).await {
        Ok(request) => request,
        Err(ConnError::Closed) | Err(ConnError::Timeout) => return Ok(()),
        Err(ConnError::BadRequest(msg)) => {
            write_json(&mut stream, 400, &json!({ "error": msg })).await?;
            return Ok(());
        }
        Err(err) => return Err(err),
    };

    // Health check is unauthenticated so a supervisor can probe liveness.
    if request.method == "GET" && request.path == "/health" {
        write_json(&mut stream, 200, &json!({ "ok": true })).await?;
        return Ok(());
    }

    if !is_authorized(&request, &config.token) {
        write_json(&mut stream, 401, &json!({ "error": "unauthorized" })).await?;
        return Ok(());
    }

    if request.method != "POST"
        || !(request.path == "/v1/responses" || request.path == "/responses")
    {
        write_json(&mut stream, 404, &json!({ "error": "not_found" })).await?;
        return Ok(());
    }

    maybe_dump_request(&request.body);

    let Ok(req_json) = serde_json::from_slice::<Value>(&request.body) else {
        write_json(&mut stream, 400, &json!({ "error": "invalid json" })).await?;
        return Ok(());
    };

    let translation = responses_request_to_chat(&req_json);
    match run_agentic_turn(translation, &config).await {
        Ok(sse) => {
            write_sse(&mut stream, &sse).await?;
        }
        Err(message) => {
            // Surface as an HTTP error; codex treats a non-2xx as a failed turn
            // and codex_exec falls back to the Rust pipeline.
            eprintln!("responses-bridge provider call failed: {message}");
            write_json(&mut stream, 502, &json!({ "error": message })).await?;
        }
    }
    Ok(())
}

/// Run one codex "turn" as a bridge-internal agentic loop, returning the final
/// Responses SSE stream.
///
/// codex-cli 0.142.5 wraps MCP tools in a `type:"namespace"` (`mcp__books`) and
/// its router only routes namespaced tool calls that arrive in OpenAI's native
/// namespace format — a flat `function_call` name (any spelling) comes back as
/// "unsupported call" for custom Responses providers (openai/codex issues
/// #23186, #26977, #20652). Chat/Anthropic providers can only emit flat function
/// calls, so codex can never route the book tools itself. Instead the bridge
/// executes those MCP tools directly against `book_tool_server` and loops with
/// the provider until it produces a final answer (or a codex-native tool call,
/// which is proxied back for codex to run). codex only ever sees the final text.
async fn run_agentic_turn(
    translation: BridgeTranslation,
    config: &ResponsesBridgeConfig,
) -> Result<String, String> {
    let BridgeTranslation { mut chat, tool_routes } = translation;
    let codex_names = codex_name_map(&tool_routes);

    for _ in 0..MAX_TOOL_ITERATIONS {
        let completion = complete_with_backoff(chat.clone()).await?;

        // Partition this turn's tool calls into MCP book tools (we execute) and
        // anything else (codex-native / non-MCP namespace — proxy back to codex).
        let book_calls: Vec<&ToolCall> = completion
            .tool_calls
            .iter()
            .filter(|call| {
                tool_routes
                    .get(&call.name)
                    .and_then(|route| route.mcp_tool.as_ref())
                    .is_some()
            })
            .collect();
        let has_other = completion
            .tool_calls
            .iter()
            .any(|call| {
                tool_routes
                    .get(&call.name)
                    .and_then(|route| route.mcp_tool.as_ref())
                    .is_none()
            });

        // Only loop when the model asked exclusively for book tools; otherwise
        // (final text, or a codex-native tool call) hand back to codex.
        if book_calls.is_empty() || has_other {
            return Ok(completion_to_sse(&completion, &short_id(), &codex_names));
        }

        // Execute each book tool against book_tool_server, then feed the results
        // back to the provider as a tool round-trip.
        let assistant_calls = completion.tool_calls.clone();
        chat.messages
            .push(ChatMessage::assistant(completion.text.clone(), assistant_calls));
        for call in &completion.tool_calls {
            let bare = tool_routes
                .get(&call.name)
                .and_then(|route| route.mcp_tool.clone())
                .unwrap_or_else(|| call.name.clone());
            let result = execute_book_tool(config, &bare, &call.arguments).await;
            chat.messages
                .push(ChatMessage::tool_result(call.id.clone(), result));
        }
    }

    Err(format!(
        "book-tool loop exceeded {MAX_TOOL_ITERATIONS} iterations"
    ))
}

/// Execute one MCP book tool against `book_tool_server`'s direct `/tools/{name}`
/// surface (camelCase args match the schemas codex advertised). Errors are
/// returned as text so the model can see them and adjust, never aborting the turn.
async fn execute_book_tool(
    config: &ResponsesBridgeConfig,
    tool: &str,
    arguments: &Value,
) -> String {
    #[cfg(test)]
    BOOK_TOOLS_EXECUTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    if config.book_tool_base.is_empty() {
        return "book tools are not available in this environment".to_string();
    }
    let url = format!("{}/tools/{tool}", config.book_tool_base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", config.book_tool_token),
        )
        .json(arguments)
        .send()
        .await;
    match response {
        Ok(resp) => resp
            .text()
            .await
            .unwrap_or_else(|err| format!("book tool read error: {err}")),
        Err(err) => format!("book tool call failed: {err}"),
    }
}

/// Read exactly one HTTP request (Content-Length body only; codex/reqwest never
/// chunk-encodes these JSON bodies).
async fn read_request(stream: &mut TcpStream) -> Result<ParsedRequest, ConnError> {
    let mut buf: Vec<u8> = Vec::new();
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(ConnError::BadRequest("headers too large"));
        }
        let mut chunk = [0u8; 4096];
        let read = match tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk)).await {
            Ok(result) => result?,
            Err(_) => {
                return Err(if buf.is_empty() {
                    ConnError::Timeout
                } else {
                    ConnError::BadRequest("incomplete headers")
                })
            }
        };
        if read == 0 {
            return Err(if buf.is_empty() {
                ConnError::Closed
            } else {
                ConnError::BadRequest("eof before headers complete")
            });
        }
        buf.extend_from_slice(&chunk[..read]);
    };

    let header_bytes = buf[..header_end].to_vec();
    let mut body = buf[header_end + 4..].to_vec();

    let header_text =
        String::from_utf8(header_bytes).map_err(|_| ConnError::BadRequest("non-utf8 headers"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().ok_or(ConnError::BadRequest("empty request"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or(ConnError::BadRequest("missing method"))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or(ConnError::BadRequest("missing path"))?
        .to_string();

    let mut content_length: Option<usize> = None;
    let mut authorization: Option<String> = None;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(ConnError::BadRequest("malformed header"));
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "content-length" => {
                content_length = Some(
                    value
                        .parse::<usize>()
                        .map_err(|_| ConnError::BadRequest("invalid content-length"))?,
                );
            }
            "transfer-encoding" => {
                if value.to_ascii_lowercase().contains("chunked") {
                    return Err(ConnError::BadRequest("chunked transfer-encoding unsupported"));
                }
            }
            "authorization" => authorization = Some(value.to_string()),
            _ => {}
        }
    }

    let length = content_length.unwrap_or(0);
    if length > MAX_BODY_BYTES {
        return Err(ConnError::BadRequest("body too large"));
    }
    while body.len() < length {
        let mut chunk = [0u8; 8192];
        let want = (length - body.len()).min(chunk.len());
        let read = match tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk[..want])).await {
            Ok(result) => result?,
            Err(_) => return Err(ConnError::BadRequest("body read timeout")),
        };
        if read == 0 {
            return Err(ConnError::BadRequest("eof before body complete"));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);

    Ok(ParsedRequest {
        method,
        path,
        authorization,
        body,
    })
}

fn is_authorized(request: &ParsedRequest, token: &str) -> bool {
    if token.trim().is_empty() {
        return false;
    }
    let Some(header) = request.authorization.as_deref() else {
        return false;
    };
    let Some(presented) = header.strip_prefix("Bearer ") else {
        return false;
    };
    presented.as_bytes() == token.as_bytes()
}

/// Optional capture mode so we can inspect exactly what codex sends and extend
/// the translation against real payloads instead of a guessed spec:
/// - `FOCUSED_READING_BRIDGE_DUMP=1` logs a truncated body to stderr.
/// - `FOCUSED_READING_BRIDGE_DUMP_DIR=<dir>` writes each full body to
///   `<dir>/bridge-req-<n>.json` (counter is per-process).
fn maybe_dump_request(body: &[u8]) {
    if let Ok(dir) = std::env::var("FOCUSED_READING_BRIDGE_DUMP_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            use std::sync::atomic::{AtomicU32, Ordering};
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let _ = std::fs::create_dir_all(dir);
            let path = std::path::Path::new(dir).join(format!("bridge-req-{n}.json"));
            let _ = std::fs::write(&path, body);
        }
    }
    let enabled = std::env::var("FOCUSED_READING_BRIDGE_DUMP")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes" || v == "on"
        })
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let text = String::from_utf8_lossy(body);
    let shown = if text.len() > 20_000 {
        format!("{}…<{} bytes total>", &text[..20_000], text.len())
    } else {
        text.to_string()
    };
    eprintln!("--- responses-bridge request ---\n{shown}\n--- end ---");
}

async fn complete_with_backoff(request: ChatRequest) -> Result<BridgeCompletion, String> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        match crate::llm::complete_for_bridge(request.clone()).await {
            Ok(completion) => return Ok(completion),
            Err(err) => {
                let retryable = matches!(
                    &err,
                    crate::llm::LlmError::Provider { status, .. }
                        if *status == 429 || *status == 500 || *status == 502 || *status == 503
                );
                if retryable && attempt < MAX_PROVIDER_ATTEMPTS {
                    // Exponential backoff: 0.5s, 1s, 2s …
                    let delay = BACKOFF_BASE * 2u32.pow(attempt - 1);
                    eprintln!(
                        "responses-bridge provider retry {attempt}/{MAX_PROVIDER_ATTEMPTS} after {err}"
                    );
                    tokio::time::sleep(delay).await;
                    continue;
                }
                return Err(err.to_string());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Request translation: Responses request -> chat request. Pure, unit-tested.
// ---------------------------------------------------------------------------

/// Routing info for one flattened provider tool name.
pub struct ToolRoute {
    /// If this is an `mcp__<server>` namespaced tool, the bare MCP tool name the
    /// bridge executes against `book_tool_server` (e.g. `book_structure`).
    /// `None` for codex-native tools, which are proxied back to codex instead.
    pub mcp_tool: Option<String>,
    /// The name codex expects if this call is proxied back (dotted
    /// `<namespace>.<tool>` for non-MCP namespaces, bare for flat tools).
    pub codex_name: String,
}

/// A translated request: the app-provider `ChatRequest` plus per-tool routing.
/// codex groups tools in `namespace`s and requires `[A-Za-z0-9_-]` names have no
/// dots, so nested tools are flattened to `<namespace>__<tool>` for the provider;
/// [`ToolRoute`] records how to route each call afterwards.
pub struct BridgeTranslation {
    pub chat: ChatRequest,
    pub tool_routes: BTreeMap<String, ToolRoute>,
}

/// Build the flattened-name -> codex-name map used when proxying a tool call
/// back to codex (only non-MCP tools are ever proxied).
fn codex_name_map(routes: &BTreeMap<String, ToolRoute>) -> BTreeMap<String, String> {
    routes
        .iter()
        .map(|(flat, route)| (flat.clone(), route.codex_name.clone()))
        .collect()
}

/// Translate a codex Responses request into an app-provider `ChatRequest`.
pub fn responses_request_to_chat(req: &Value) -> BridgeTranslation {
    let mut messages: Vec<ChatMessage> = Vec::new();

    // Top-level `instructions` is codex's system preamble.
    if let Some(instructions) = req.get("instructions").and_then(Value::as_str) {
        if !instructions.trim().is_empty() {
            messages.push(ChatMessage::system(instructions.to_string()));
        }
    }

    // Index of the assistant message currently accumulating parallel tool
    // calls, so consecutive `function_call` items group into one assistant
    // message (required by OpenAI/DeepSeek tool-call ordering).
    let mut grouping_assistant: Option<usize> = None;

    for item in req.get("input").and_then(Value::as_array).into_iter().flatten() {
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or("message");
        match item_type {
            "message" => {
                grouping_assistant = None;
                let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
                let text = collect_text_content(item.get("content"));
                match role {
                    "assistant" => messages.push(ChatMessage::assistant(text, Vec::new())),
                    // codex's `developer` role carries sandbox/skill instructions;
                    // map it (and any explicit system) to a system message.
                    "system" | "developer" => messages.push(ChatMessage::system(text)),
                    _ => messages.push(ChatMessage::user(text)),
                }
            }
            "function_call" => {
                let call = ToolCall {
                    id: item
                        .get("call_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    name: item
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    arguments: item
                        .get("arguments")
                        .and_then(Value::as_str)
                        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                        .unwrap_or_else(|| json!({})),
                };
                if let Some(idx) = grouping_assistant {
                    messages[idx].tool_calls.push(call);
                } else {
                    messages.push(ChatMessage::assistant("", vec![call]));
                    grouping_assistant = Some(messages.len() - 1);
                }
            }
            "function_call_output" => {
                grouping_assistant = None;
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let output = function_output_to_string(item.get("output"));
                messages.push(ChatMessage::tool_result(call_id, output));
            }
            _ => {
                grouping_assistant = None;
            }
        }
    }

    let (tools, tool_routes) = collect_function_tools(req.get("tools"));
    let max_tokens = req
        .get("max_output_tokens")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(256, 32_768) as u32)
        .unwrap_or(DEFAULT_MAX_TOKENS);

    BridgeTranslation {
        chat: ChatRequest {
            messages,
            tools,
            max_tokens,
            temperature: DEFAULT_TEMPERATURE,
        },
        tool_routes,
    }
}

/// Collect text from Responses content, which is either a string or an array of
/// content parts (`input_text` / `output_text` / …), each carrying a `text`.
fn collect_text_content(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// A function_call_output `output` is usually a plain string (the MCP tool's
/// text), but tolerate a structured object by stringifying it.
fn function_output_to_string(output: Option<&Value>) -> String {
    match output {
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

/// Collect Responses `tools` into app `ToolDefinition`s. Chat-completions has no
/// namespace concept, so a codex `namespace` (e.g. `mcp__books`, which holds the
/// book tools) is flattened: each nested tool is emitted with a fully-qualified
/// name `<namespace>__<tool>` (codex's own `mcp__server__tool` routing key), so
/// the function_call codex gets back routes to the right MCP tool. Bare
/// top-level `function` tools pass through unchanged; other kinds (`web_search`,
/// …) have no chat-completions equivalent and are skipped (never needed for
/// Spark/translation).
fn collect_function_tools(
    tools: Option<&Value>,
) -> (Vec<ToolDefinition>, BTreeMap<String, ToolRoute>) {
    let mut out = Vec::new();
    let mut routes = BTreeMap::new();
    let Some(array) = tools.and_then(Value::as_array) else {
        return (out, routes);
    };
    for entry in array {
        match entry.get("type").and_then(Value::as_str) {
            Some("function") => {
                if let Some(def) = function_tool_definition(entry, None) {
                    out.push(def);
                }
            }
            Some("namespace") => {
                let namespace = entry.get("name").and_then(Value::as_str);
                for nested in entry.get("tools").and_then(Value::as_array).into_iter().flatten() {
                    if nested.get("type").and_then(Value::as_str) == Some("function") {
                        if let Some(def) = function_tool_definition(nested, namespace) {
                            if let (Some(ns), Some(bare)) =
                                (namespace, nested.get("name").and_then(Value::as_str))
                            {
                                if !ns.is_empty() {
                                    routes.insert(
                                        def.name.clone(),
                                        ToolRoute {
                                            // `mcp__<server>` namespaces are MCP tools the
                                            // bridge executes; other namespaces are codex-native.
                                            mcp_tool: ns
                                                .strip_prefix("mcp__")
                                                .map(|_| bare.to_string()),
                                            codex_name: format!("{ns}.{bare}"),
                                        },
                                    );
                                }
                            }
                            out.push(def);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    (out, routes)
}

fn function_tool_definition(entry: &Value, namespace: Option<&str>) -> Option<ToolDefinition> {
    let bare = entry.get("name").and_then(Value::as_str)?;
    let name = match namespace {
        Some(ns) if !ns.is_empty() => format!("{ns}__{bare}"),
        _ => bare.to_string(),
    };
    let description = entry
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let input_schema = entry
        .get("parameters")
        .cloned()
        .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
    Some(ToolDefinition {
        name,
        description,
        input_schema,
    })
}

// ---------------------------------------------------------------------------
// Response translation: completion -> Responses SSE. Pure, unit-tested.
// ---------------------------------------------------------------------------

/// Build the Responses SSE event stream codex consumes for one completed turn.
/// Emits any assistant text as a `message` output item, then each tool call as
/// a `function_call` output item, and closes with `response.completed`.
/// `tool_call_names` maps flattened provider tool names back to the dotted
/// namespaced names codex routes on (see [`BridgeTranslation`]).
pub fn completion_to_sse(
    completion: &BridgeCompletion,
    response_id: &str,
    tool_call_names: &BTreeMap<String, String>,
) -> String {
    let mut out = String::new();
    let created_at = now_unix();
    let model = completion.model.clone();

    let created = json!({
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": "in_progress",
        "model": model,
        "output": [],
    });
    push_event(&mut out, "response.created", &json!({
        "type": "response.created",
        "response": created,
    }));

    let mut output_items: Vec<Value> = Vec::new();
    let mut output_index = 0u32;

    if !completion.text.trim().is_empty() {
        let msg_id = format!("msg_{response_id}");
        let added_item = json!({
            "type": "message",
            "id": msg_id,
            "status": "in_progress",
            "role": "assistant",
            "content": [],
        });
        push_event(&mut out, "response.output_item.added", &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": added_item,
        }));
        push_event(&mut out, "response.content_part.added", &json!({
            "type": "response.content_part.added",
            "item_id": msg_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": "" },
        }));
        push_event(&mut out, "response.output_text.delta", &json!({
            "type": "response.output_text.delta",
            "item_id": msg_id,
            "output_index": output_index,
            "content_index": 0,
            "delta": completion.text,
        }));
        push_event(&mut out, "response.output_text.done", &json!({
            "type": "response.output_text.done",
            "item_id": msg_id,
            "output_index": output_index,
            "content_index": 0,
            "text": completion.text,
        }));
        push_event(&mut out, "response.content_part.done", &json!({
            "type": "response.content_part.done",
            "item_id": msg_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": completion.text },
        }));
        let done_item = json!({
            "type": "message",
            "id": msg_id,
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": completion.text }],
        });
        push_event(&mut out, "response.output_item.done", &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": done_item,
        }));
        output_items.push(done_item);
        output_index += 1;
    }

    for (index, call) in completion.tool_calls.iter().enumerate() {
        let fc_id = format!("fc_{response_id}_{index}");
        let args = call.arguments.to_string();
        // Map the flattened provider tool name back to codex's dotted
        // `<namespace>.<tool>` routing name (bare top-level tools are unchanged).
        let call_name = tool_call_names
            .get(&call.name)
            .cloned()
            .unwrap_or_else(|| call.name.clone());
        let added_item = json!({
            "type": "function_call",
            "id": fc_id,
            "call_id": call.id,
            "name": call_name,
            "arguments": "",
        });
        push_event(&mut out, "response.output_item.added", &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": added_item,
        }));
        push_event(&mut out, "response.function_call_arguments.delta", &json!({
            "type": "response.function_call_arguments.delta",
            "item_id": fc_id,
            "output_index": output_index,
            "delta": args,
        }));
        push_event(&mut out, "response.function_call_arguments.done", &json!({
            "type": "response.function_call_arguments.done",
            "item_id": fc_id,
            "output_index": output_index,
            "arguments": args,
        }));
        let done_item = json!({
            "type": "function_call",
            "id": fc_id,
            "call_id": call.id,
            "name": call_name,
            "arguments": args,
        });
        push_event(&mut out, "response.output_item.done", &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": done_item,
        }));
        output_items.push(done_item);
        output_index += 1;
    }

    let final_response = json!({
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": "completed",
        "model": model,
        "output": output_items,
        "usage": map_usage(completion.usage.as_ref()),
    });
    push_event(&mut out, "response.completed", &json!({
        "type": "response.completed",
        "response": final_response,
    }));

    out
}

/// Map provider usage (OpenAI `prompt_tokens`/`completion_tokens` or Anthropic
/// `input_tokens`/`output_tokens`) into the Responses usage shape codex reads.
fn map_usage(usage: Option<&Value>) -> Value {
    let get = |keys: &[&str]| -> u64 {
        usage
            .and_then(|u| keys.iter().find_map(|k| u.get(*k).and_then(Value::as_u64)))
            .unwrap_or(0)
    };
    let cached = usage
        .and_then(|u| {
            u.get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(Value::as_u64)
                .or_else(|| u.get("cache_read_input_tokens").and_then(Value::as_u64))
        })
        .unwrap_or(0);
    let input = get(&["prompt_tokens", "input_tokens"]);
    let output = get(&["completion_tokens", "output_tokens"]);
    let total = {
        let t = get(&["total_tokens"]);
        if t == 0 {
            input + output
        } else {
            t
        }
    };
    json!({
        "input_tokens": input,
        "input_tokens_details": { "cached_tokens": cached },
        "output_tokens": output,
        "output_tokens_details": { "reasoning_tokens": 0 },
        "total_tokens": total,
    })
}

fn push_event(out: &mut String, event: &str, data: &Value) {
    out.push_str("event: ");
    out.push_str(event);
    out.push_str("\ndata: ");
    out.push_str(&data.to_string());
    out.push_str("\n\n");
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Short, unique-enough id for a single response (not security-sensitive).
fn short_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    format!("{:016x}", RandomState::new().build_hasher().finish())
}

async fn write_sse(stream: &mut TcpStream, body: &str) -> Result<(), ConnError> {
    // No Content-Length: the SSE body length is delimited by connection close
    // (RFC 7230 §3.3.3), which reqwest/codex read fine.
    let header = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}

async fn write_json(stream: &mut TcpStream, status: u16, payload: &Value) -> Result<(), ConnError> {
    let body = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        502 => "Bad Gateway",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
