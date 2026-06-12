//! Book-tool HTTP server: the bridge that lets the out-of-process OpenCode
//! sidecar reach the Rust core's SQLite book data.
//!
//! OpenCode runs as a separate Node process and cannot read our in-process
//! SQLite. Its `deep_reader` / `translator` agents call four book tools
//! (`book_search`, `book_get_chunk`, `book_get_neighbors`, `book_structure`)
//! which POST to this server (see `agent-host/.../lib/book-tool-client.ts`).
//!
//! The contract is fixed by that client:
//!   POST /tools/{name}  Content-Type: application/json
//!   Authorization: Bearer {token}   (empty/mismatched token => 401)
//!   body = camelCase JSON, response = JSON.
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

    #[test]
    fn is_authorized_requires_bearer_prefix() {
        let request = parsed("POST", "/tools/book_search", Some("secret"), "{}");
        assert!(!is_authorized(&request, "secret"));
        let request = parsed("POST", "/tools/book_search", Some("Bearer secret"), "{}");
        assert!(is_authorized(&request, "secret"));
    }
}
