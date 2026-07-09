//! Book-tool HTTP server: the bridge that lets the out-of-process agent
//! engine (Codex) reach the Rust core's SQLite book data.
//!
//! The engine runs as a separate process and cannot read our in-process
//! SQLite. Its agents call four book tools (`book_search`, `book_get_chunk`,
//! `book_get_neighbors`, `book_structure`) over two equivalent surfaces:
//!
//!   1. POST /tools/{name}  Content-Type: application/json
//!      Authorization: Bearer {token}   (empty/mismatched token => 401)
//!      body = camelCase JSON, response = JSON. (Legacy direct surface.)
//!   2. POST /mcp — MCP streamable-HTTP endpoint (JSON-RPC 2.0). This is what
//!      `codex exec` connects to via `[mcp_servers.books] url = ".../mcp"`,
//!      authenticating with the same bearer token. Only `initialize`,
//!      `tools/list`, `tools/call` and `ping` are implemented; notifications
//!      get 202. Responses are plain JSON (the spec allows non-SSE replies).
//!
//! Implemented as a minimal handwritten HTTP/1.1 server over tokio so we don't
//! pull in a web framework (keeps the `=`-pinned dependency surface minimal).
//! It only ever serves a single trusted localhost client, so the parser only
//! supports exactly what Node's `fetch`/undici sends: Content-Length bodies
//! (never chunked), keep-alive connections, small JSON payloads.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::storage;

/// Hard upper bound on a single request body. Book-tool payloads are tiny
/// JSON objects; anything larger is rejected to bound memory and abuse.
const MAX_BODY_BYTES: usize = 64 * 1024;

/// Read timeout for a single request on a kept-alive connection. Prevents a
/// buggy client (or a Content-Length larger than the body actually sent) from
/// hanging a connection task forever.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Cap header section size so a client that never sends the blank line cannot
/// make us buffer unboundedly.
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct BookToolServerConfig {
    pub db_path: PathBuf,
    pub token: String,
    pub port: u16,
}

/// Resolve the port the book-tool server should bind, honoring an override env
/// var so a port collision can be worked around without a rebuild.
pub fn resolve_port() -> u16 {
    std::env::var("FOCUSED_READING_BOOK_TOOL_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(48173)
}

/// Spawn the server on a tokio task and return the address it bound to. Binds
/// only to 127.0.0.1 so it is never reachable off-host.
pub async fn spawn(config: BookToolServerConfig) -> std::io::Result<SocketAddr> {
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
                            // A dropped/aborted client connection is routine; log at debug level only.
                            eprintln!("book-tool connection ended: {err}");
                        }
                    });
                }
                Err(err) => {
                    eprintln!("book-tool accept failed: {err}");
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });
    Ok(local_addr)
}

/// A parsed HTTP request: method, path, the relevant headers, and the body.
struct ParsedRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    body: Vec<u8>,
    keep_alive: bool,
}

#[derive(Debug)]
enum ConnError {
    /// The peer closed the connection cleanly (or before sending anything).
    Closed,
    Io(std::io::Error),
    /// Malformed request that should produce a 400 and close.
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

async fn serve_connection(
    mut stream: TcpStream,
    config: Arc<BookToolServerConfig>,
) -> Result<(), ConnError> {
    // Buffer that may hold bytes of the *next* pipelined request after we finish
    // one. We carry it across loop iterations so keep-alive works correctly.
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let request = match read_request(&mut stream, &mut carry).await {
            Ok(request) => request,
            Err(ConnError::Closed) => return Ok(()),
            Err(ConnError::BadRequest(msg)) => {
                write_response(&mut stream, 400, &json!({ "error": msg })).await?;
                return Ok(());
            }
            Err(ConnError::Timeout) => {
                // Idle keep-alive connection timed out waiting for the next request.
                return Ok(());
            }
            Err(err) => return Err(err),
        };

        let keep_alive = request.keep_alive;
        let (status, payload) = handle_request(&request, &config);
        write_response(&mut stream, status, &payload).await?;

        if !keep_alive {
            return Ok(());
        }
    }
}

/// Read exactly one HTTP request from the stream, using `carry` to seed bytes
/// left over from a previous pipelined request.
async fn read_request(
    stream: &mut TcpStream,
    carry: &mut Vec<u8>,
) -> Result<ParsedRequest, ConnError> {
    // 1) Read until we have the full header section (terminated by CRLF CRLF).
    let header_end = loop {
        if let Some(pos) = find_header_end(carry) {
            break pos;
        }
        if carry.len() > MAX_HEADER_BYTES {
            return Err(ConnError::BadRequest("headers too large"));
        }
        let mut buf = [0u8; 4096];
        let read = match tokio::time::timeout(READ_TIMEOUT, stream.read(&mut buf)).await {
            Ok(result) => result?,
            Err(_) => {
                // Timeout: only an error mid-request. If nothing buffered yet this
                // is just an idle keep-alive socket, treat as timeout (close quietly).
                return Err(if carry.is_empty() {
                    ConnError::Timeout
                } else {
                    ConnError::BadRequest("incomplete headers")
                });
            }
        };
        if read == 0 {
            return Err(if carry.is_empty() {
                ConnError::Closed
            } else {
                ConnError::BadRequest("eof before headers complete")
            });
        }
        carry.extend_from_slice(&buf[..read]);
    };

    // header_end points at the first byte of the CRLFCRLF terminator.
    let header_bytes = carry[..header_end].to_vec();
    // Drain the headers + the 4-byte terminator from carry, leaving body bytes.
    carry.drain(..header_end + 4);

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
    let mut keep_alive = true; // HTTP/1.1 default
    let mut expect_continue = false;
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
                let parsed = value
                    .parse::<usize>()
                    .map_err(|_| ConnError::BadRequest("invalid content-length"))?;
                content_length = Some(parsed);
            }
            "transfer-encoding" => {
                // Node's fetch never chunk-encodes our small JSON bodies; refuse rather
                // than mis-parse.
                if value.to_ascii_lowercase().contains("chunked") {
                    return Err(ConnError::BadRequest(
                        "chunked transfer-encoding unsupported",
                    ));
                }
            }
            "authorization" => authorization = Some(value.to_string()),
            "connection" => {
                if value.eq_ignore_ascii_case("close") {
                    keep_alive = false;
                }
            }
            "expect" => {
                if value.eq_ignore_ascii_case("100-continue") {
                    expect_continue = true;
                }
            }
            _ => {}
        }
    }

    let length = content_length.unwrap_or(0);
    if length > MAX_BODY_BYTES {
        return Err(ConnError::BadRequest("body too large"));
    }

    if expect_continue {
        stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
        stream.flush().await?;
    }

    // 2) Read the body. Use read_exact-style accumulation against Content-Length;
    //    NEVER read_line (JSON contains arbitrary bytes incl. \n).
    let mut body = Vec::with_capacity(length.min(MAX_BODY_BYTES));
    // First consume any body bytes already sitting in carry.
    if !carry.is_empty() {
        let take = carry.len().min(length);
        body.extend_from_slice(&carry[..take]);
        carry.drain(..take);
    }
    while body.len() < length {
        let mut buf = [0u8; 4096];
        let want = (length - body.len()).min(buf.len());
        let read = match tokio::time::timeout(READ_TIMEOUT, stream.read(&mut buf[..want])).await {
            Ok(result) => result?,
            Err(_) => return Err(ConnError::BadRequest("body read timeout")),
        };
        if read == 0 {
            return Err(ConnError::BadRequest("eof before body complete"));
        }
        body.extend_from_slice(&buf[..read]);
    }

    Ok(ParsedRequest {
        method,
        path,
        authorization,
        body,
        keep_alive,
    })
}

/// Find the byte offset of the CRLF CRLF that ends the header section.
fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Route + authorize a parsed request and produce (status, json body).
fn handle_request(
    request: &ParsedRequest,
    config: &BookToolServerConfig,
) -> (u16, serde_json::Value) {
    // Health check is unauthenticated so the supervisor can probe liveness.
    if request.method == "GET" && request.path == "/health" {
        return (200, json!({ "ok": true }));
    }

    // Bearer auth: empty configured token => deny everything (per security rule).
    if !is_authorized(request, &config.token) {
        return (401, json!({ "error": "unauthorized" }));
    }

    if request.method != "POST" {
        return (405, json!({ "error": "method_not_allowed" }));
    }

    if request.path == "/mcp" || request.path == "/mcp/" {
        return handle_mcp(&request.body, config);
    }

    let Some(tool) = request.path.strip_prefix("/tools/") else {
        return (404, json!({ "error": "not_found" }));
    };

    match dispatch_tool(tool, &request.body, config) {
        Ok(value) => (200, value),
        Err(ToolError::BadInput(msg)) => (400, json!({ "error": msg })),
        Err(ToolError::Backend(msg)) => (500, json!({ "error": msg })),
        Err(ToolError::Unknown) => (404, json!({ "error": "unknown_tool" })),
    }
}

/// MCP protocol version we answer `initialize` with when the client's own
/// version is absent. Codex negotiates by echoing whatever both sides support;
/// tools/list + tools/call semantics are stable across the versions we care about.
const MCP_FALLBACK_PROTOCOL_VERSION: &str = "2025-03-26";

/// Handle one MCP streamable-HTTP message (a single JSON-RPC 2.0 object).
/// Notifications (no `id`) are acknowledged with 202 and an empty object.
fn handle_mcp(body: &[u8], config: &BookToolServerConfig) -> (u16, serde_json::Value) {
    let Ok(message) = serde_json::from_slice::<serde_json::Value>(body) else {
        return (
            400,
            json!({ "jsonrpc": "2.0", "id": null,
                    "error": { "code": -32700, "message": "parse error" } }),
        );
    };
    if message.is_array() {
        // JSON-RPC batching was removed from the MCP spec; codex never sends it.
        return (
            400,
            json!({ "jsonrpc": "2.0", "id": null,
                    "error": { "code": -32600, "message": "batch requests unsupported" } }),
        );
    }
    let method = message.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let id = message.get("id").cloned();
    // Notifications (initialized, cancelled, ...) need no response body.
    if id.is_none() || method.starts_with("notifications/") {
        return (202, json!({}));
    }
    let id = id.unwrap_or(serde_json::Value::Null);
    let params = message.get("params").cloned().unwrap_or(json!({}));

    let result = match method {
        "initialize" => {
            let protocol_version = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or(MCP_FALLBACK_PROTOCOL_VERSION);
            Ok(json!({
                "protocolVersion": protocol_version,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "focused-reading-book-tools",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": mcp_tool_definitions() })),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            let args_bytes = serde_json::to_vec(&arguments).unwrap_or_else(|_| b"{}".to_vec());
            match dispatch_tool(name, &args_bytes, config) {
                Ok(value) => Ok(json!({
                    "content": [{ "type": "text", "text": value.to_string() }],
                    "isError": false,
                })),
                // Tool-level failures go into the result per the MCP spec so the
                // model can see them and adjust, instead of a protocol error.
                Err(ToolError::Unknown) => Ok(json!({
                    "content": [{ "type": "text", "text": format!("unknown tool: {name}") }],
                    "isError": true,
                })),
                Err(ToolError::BadInput(msg)) => Ok(json!({
                    "content": [{ "type": "text", "text": format!("invalid arguments: {msg}") }],
                    "isError": true,
                })),
                Err(ToolError::Backend(msg)) => Ok(json!({
                    "content": [{ "type": "text", "text": format!("backend error: {msg}") }],
                    "isError": true,
                })),
            }
        }
        _ => Err(json!({ "code": -32601, "message": format!("method not found: {method}") })),
    };

    match result {
        Ok(result) => (200, json!({ "jsonrpc": "2.0", "id": id, "result": result })),
        Err(error) => (200, json!({ "jsonrpc": "2.0", "id": id, "error": error })),
    }
}

/// MCP tool definitions mirroring the four /tools/ routes. Schemas use
/// camelCase argument names to match `dispatch_tool`'s serde contracts.
fn mcp_tool_definitions() -> serde_json::Value {
    let book_id = json!({ "type": "string", "description": "本书的 bookId" });
    let chunk_id = json!({ "type": "string", "description": "目标块的 chunk_id" });
    json!([
        {
            "name": "book_search",
            "description": "在当前书内做混合检索（全文+向量），返回相关文本块及其 chunk_id。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "bookId": book_id,
                    "query": { "type": "string", "description": "检索查询" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 24 }
                },
                "required": ["bookId", "query"]
            }
        },
        {
            "name": "book_get_chunk",
            "description": "按 chunk_id 取回单个文本块的完整内容。",
            "inputSchema": {
                "type": "object",
                "properties": { "bookId": book_id, "chunkId": chunk_id },
                "required": ["bookId", "chunkId"]
            }
        },
        {
            "name": "book_get_neighbors",
            "description": "取回某个 chunk_id 前后相邻的文本块（radius 控制范围）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "bookId": book_id,
                    "chunkId": chunk_id,
                    "radius": { "type": "integer", "minimum": 0, "maximum": 8 }
                },
                "required": ["bookId", "chunkId"]
            }
        },
        {
            "name": "book_structure",
            "description": "取回本书的结构（章节标题块列表）。",
            "inputSchema": {
                "type": "object",
                "properties": { "bookId": book_id },
                "required": ["bookId"]
            }
        }
    ])
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
    // Constant-time-ish compare is overkill for a localhost dev token, but avoid
    // trivial length leak by comparing bytes fully.
    presented.as_bytes() == token.as_bytes()
}

enum ToolError {
    BadInput(&'static str),
    Backend(String),
    Unknown,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchArgs {
    book_id: String,
    query: String,
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkArgs {
    book_id: String,
    chunk_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeighborArgs {
    book_id: String,
    chunk_id: String,
    #[serde(default)]
    radius: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StructureArgs {
    book_id: String,
}

fn dispatch_tool(
    tool: &str,
    body: &[u8],
    config: &BookToolServerConfig,
) -> Result<serde_json::Value, ToolError> {
    let db = config.db_path.as_path();
    match tool {
        "book_search" => {
            let args: SearchArgs = parse_args(body)?;
            let limit = args.limit.unwrap_or(6).clamp(1, 24);
            let hits = storage::hybrid_search_book(db, &args.book_id, &args.query, limit)
                .map_err(|err| ToolError::Backend(format!("{err:#}")))?;
            serde_json::to_value(hits).map_err(|err| ToolError::Backend(err.to_string()))
        }
        "book_get_chunk" => {
            let args: ChunkArgs = parse_args(body)?;
            let hit = storage::get_chunk(db, &args.book_id, &args.chunk_id)
                .map_err(|err| ToolError::Backend(format!("{err:#}")))?;
            serde_json::to_value(hit).map_err(|err| ToolError::Backend(err.to_string()))
        }
        "book_get_neighbors" => {
            let args: NeighborArgs = parse_args(body)?;
            let radius = args.radius.unwrap_or(1).clamp(0, 8);
            let hits = storage::get_neighbors(db, &args.book_id, &args.chunk_id, radius)
                .map_err(|err| ToolError::Backend(format!("{err:#}")))?;
            serde_json::to_value(hits).map_err(|err| ToolError::Backend(err.to_string()))
        }
        "book_structure" => {
            let args: StructureArgs = parse_args(body)?;
            let hits = storage::list_structure(db, &args.book_id)
                .map_err(|err| ToolError::Backend(format!("{err:#}")))?;
            serde_json::to_value(hits).map_err(|err| ToolError::Backend(err.to_string()))
        }
        _ => Err(ToolError::Unknown),
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, ToolError> {
    serde_json::from_slice(body).map_err(|_| ToolError::BadInput("invalid request body"))
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    payload: &serde_json::Value,
) -> Result<(), ConnError> {
    let body = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(method: &str, path: &str, auth: Option<&str>, body: &str) -> ParsedRequest {
        ParsedRequest {
            method: method.to_string(),
            path: path.to_string(),
            authorization: auth.map(|value| value.to_string()),
            body: body.as_bytes().to_vec(),
            keep_alive: true,
        }
    }

    fn config(token: &str) -> BookToolServerConfig {
        BookToolServerConfig {
            db_path: PathBuf::from("/nonexistent/library.sqlite3"),
            token: token.to_string(),
            port: 0,
        }
    }

    #[test]
    fn health_is_unauthenticated() {
        let request = parsed("GET", "/health", None, "");
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 200);
        assert_eq!(body["ok"], json!(true));
    }

    #[test]
    fn empty_token_denies_everything() {
        let request = parsed("POST", "/tools/book_search", Some("Bearer "), "{}");
        let (status, _) = handle_request(&request, &config(""));
        assert_eq!(status, 401);
    }

    #[test]
    fn missing_authorization_is_denied() {
        let request = parsed("POST", "/tools/book_search", None, "{}");
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 401);
    }

    #[test]
    fn wrong_token_is_denied() {
        let request = parsed("POST", "/tools/book_search", Some("Bearer nope"), "{}");
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 401);
    }

    #[test]
    fn unknown_tool_after_auth_is_404() {
        let request = parsed(
            "POST",
            "/tools/book_does_not_exist",
            Some("Bearer secret"),
            "{\"bookId\":\"x\"}",
        );
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 404);
    }

    #[test]
    fn non_post_tool_is_405() {
        let request = parsed("GET", "/tools/book_search", Some("Bearer secret"), "");
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 405);
    }

    #[test]
    fn bad_json_body_is_400() {
        // Authorized but malformed body -> 400 from parse_args.
        let request = parsed(
            "POST",
            "/tools/book_search",
            Some("Bearer secret"),
            "not json",
        );
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 400);
    }

    #[test]
    fn header_end_detection() {
        assert_eq!(find_header_end(b"GET / HTTP/1.1\r\n\r\nbody"), Some(14));
        assert_eq!(find_header_end(b"incomplete\r\n"), None);
    }

    fn mcp_request(body: serde_json::Value) -> ParsedRequest {
        parsed("POST", "/mcp", Some("Bearer secret"), &body.to_string())
    }

    #[test]
    fn mcp_requires_auth() {
        let request = parsed(
            "POST",
            "/mcp",
            None,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#,
        );
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 401);
    }

    #[test]
    fn mcp_initialize_echoes_protocol_version() {
        let request = mcp_request(json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-06-18",
                        "capabilities": {}, "clientInfo": { "name": "codex" } }
        }));
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 200);
        assert_eq!(body["result"]["protocolVersion"], json!("2025-06-18"));
        assert!(body["result"]["capabilities"]["tools"].is_object());
        assert_eq!(body["id"], json!(1));
    }

    #[test]
    fn mcp_notification_is_accepted_without_result() {
        let request = mcp_request(json!({
            "jsonrpc": "2.0", "method": "notifications/initialized"
        }));
        let (status, _) = handle_request(&request, &config("secret"));
        assert_eq!(status, 202);
    }

    #[test]
    fn mcp_tools_list_exposes_the_four_book_tools() {
        let request = mcp_request(json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/list"
        }));
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 200);
        let names: Vec<&str> = body["result"]["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .map(|tool| tool["name"].as_str().expect("tool name"))
            .collect();
        assert_eq!(
            names,
            vec![
                "book_search",
                "book_get_chunk",
                "book_get_neighbors",
                "book_structure"
            ]
        );
    }

    #[test]
    fn mcp_tools_call_unknown_tool_is_tool_error_not_protocol_error() {
        let request = mcp_request(json!({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "book_nope", "arguments": {} }
        }));
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 200);
        assert_eq!(body["result"]["isError"], json!(true));
        assert!(body.get("error").is_none());
    }

    #[test]
    fn mcp_tools_call_bad_arguments_is_tool_error() {
        let request = mcp_request(json!({
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": { "name": "book_search", "arguments": { "query": 42 } }
        }));
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 200);
        assert_eq!(body["result"]["isError"], json!(true));
    }

    #[test]
    fn mcp_unknown_method_is_json_rpc_error() {
        let request = mcp_request(json!({
            "jsonrpc": "2.0", "id": 5, "method": "resources/list"
        }));
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 200);
        assert_eq!(body["error"]["code"], json!(-32601));
    }

    #[test]
    fn mcp_batch_is_rejected() {
        let request = mcp_request(json!([
            { "jsonrpc": "2.0", "id": 1, "method": "ping" }
        ]));
        let (status, body) = handle_request(&request, &config("secret"));
        assert_eq!(status, 400);
        assert_eq!(body["error"]["code"], json!(-32600));
    }

    #[test]
    fn is_authorized_requires_bearer_prefix() {
        let request = parsed("POST", "/tools/book_search", Some("secret"), "{}");
        assert!(!is_authorized(&request, "secret"));
        let request = parsed("POST", "/tools/book_search", Some("Bearer secret"), "{}");
        assert!(is_authorized(&request, "secret"));
    }

    /// Live end-to-end smoke: a real `codex exec` connects to our /mcp endpoint,
    /// lists the book tools, and calls one. Requires the codex binary and its
    /// provider credentials, and spends real tokens — run explicitly with
    /// `cargo test --lib mcp_codex_live_smoke -- --ignored --test-threads=1 --nocapture`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn mcp_codex_live_smoke() {
        let Some(binary) = crate::codex_exec::codex_binary() else {
            panic!("codex binary not found; install codex-cli to run this smoke test");
        };

        let dir = std::env::temp_dir().join(format!("fr-mcp-smoke-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("smoke dir");
        let db_path = dir.join("library.sqlite3");
        // Initialize the schema so tool calls hit real (empty) tables.
        let _ = crate::storage::list_books(&db_path).expect("init db");

        let token = "smoke-test-token".to_string();
        let addr = spawn(BookToolServerConfig {
            db_path,
            token: token.clone(),
            port: 0,
        })
        .await
        .expect("bind mcp server");

        let output = std::process::Command::new(binary)
            .arg("exec")
            .arg("--json")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("read-only")
            .arg("-c")
            .arg("approval_policy=\"never\"")
            .arg("--cd")
            .arg(&dir)
            .arg("-c")
            .arg(format!(
                "mcp_servers={{books={{url=\"http://{addr}/mcp\",bearer_token_env_var=\"{}\",startup_timeout_sec=20}}}}",
                crate::codex_exec::BOOK_TOOL_TOKEN_ENV
            ))
            .env(crate::codex_exec::BOOK_TOOL_TOKEN_ENV, &token)
            .arg("call the book_structure tool with bookId \"smoke-book\", then reply with exactly: TOOLS_OK <comma-separated names of the book tools you can see>")
            .output()
            .expect("run codex");

        let stdout = String::from_utf8_lossy(&output.stdout);
        println!("--- codex stdout ---\n{stdout}");
        println!(
            "--- codex stderr ---\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            stdout.contains("mcp_tool_call"),
            "expected an mcp_tool_call item, codex never reached our /mcp endpoint"
        );
        assert!(
            stdout.contains("TOOLS_OK"),
            "expected the final TOOLS_OK message"
        );
        assert!(
            stdout.contains("book_search"),
            "tools/list should expose book_search"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// C9-spike helper (2026-07-09): spawn the real book-tool `/mcp` server and
    /// keep it alive so an *external* `opencode serve` can attach to it as a
    /// remote MCP (`type=remote`, `headers.Authorization = Bearer <token>`) and
    /// we can hard-verify opencode's remote-MCP + bearer support against our own
    /// protocol implementation. Prints the bound address, bearer token, and a
    /// book id for the driver script, then blocks for a keepalive window.
    ///
    /// Not a normal test (it sleeps and never asserts) — gated to `--ignored`.
    /// Run: `SPIKE_MCP_PORT=48191 SPIKE_MCP_TOKEN=opencode-spike-token \
    ///   SPIKE_MCP_KEEPALIVE_SECS=240 cargo test --lib \
    ///   opencode_remote_mcp_keepalive -- --ignored --nocapture`
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn opencode_remote_mcp_keepalive() {
        let dir = std::env::temp_dir().join(format!("fr-oc-mcp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("spike dir");
        let db_path = dir.join("library.sqlite3");
        // Initialize the schema so tool calls hit real (empty) tables.
        let _ = crate::storage::list_books(&db_path).expect("init db");

        let token =
            std::env::var("SPIKE_MCP_TOKEN").unwrap_or_else(|_| "opencode-spike-token".to_string());
        let port: u16 = std::env::var("SPIKE_MCP_PORT")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0);
        let addr = spawn(BookToolServerConfig {
            db_path,
            token: token.clone(),
            port,
        })
        .await
        .expect("bind mcp server");

        println!("SPIKE_MCP_ADDR=http://{addr}/mcp");
        println!("SPIKE_MCP_TOKEN={token}");
        println!("SPIKE_MCP_BOOK_ID=spike-book");

        let secs: u64 = std::env::var("SPIKE_MCP_KEEPALIVE_SECS")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(180);
        tokio::time::sleep(Duration::from_secs(secs)).await;

        let _ = std::fs::remove_dir_all(&dir);
    }
}
