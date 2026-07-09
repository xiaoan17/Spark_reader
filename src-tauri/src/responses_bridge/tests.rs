use super::*;
use crate::llm::{BridgeCompletion, ChatRole, ToolCall};
use serde_json::json;
use std::collections::BTreeMap;

fn deepseek_completion(text: &str, tool_calls: Vec<ToolCall>) -> BridgeCompletion {
    BridgeCompletion {
        text: text.to_string(),
        tool_calls,
        usage: Some(json!({ "prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13 })),
        model: "deepseek-v4-flash".to_string(),
    }
}

/// SSE with no name remapping (bare tools), for the simple assertions.
fn sse(completion: &BridgeCompletion, id: &str) -> String {
    completion_to_sse(completion, id, &BTreeMap::new())
}

#[test]
fn translates_instructions_and_messages() {
    // Shape mirrors a captured codex 0.142.5 request.
    let req = json!({
        "model": "deepseek-v4-flash",
        "instructions": "You are a coding agent.",
        "input": [
            { "type": "message", "role": "developer",
              "content": [{ "type": "input_text", "text": "sandbox is read-only" }] },
            { "type": "message", "role": "user",
              "content": [{ "type": "input_text", "text": "解读这段" }] }
        ],
        "tools": [],
        "stream": true
    });
    let chat = responses_request_to_chat(&req).chat;
    assert_eq!(chat.messages.len(), 3);
    assert!(matches!(chat.messages[0].role, ChatRole::System));
    assert_eq!(chat.messages[0].content, "You are a coding agent.");
    assert!(matches!(chat.messages[1].role, ChatRole::System)); // developer -> system
    assert_eq!(chat.messages[1].content, "sandbox is read-only");
    assert!(matches!(chat.messages[2].role, ChatRole::User));
    assert_eq!(chat.messages[2].content, "解读这段");
    assert!(chat.tools.is_empty());
}

#[test]
fn translates_function_call_roundtrip() {
    let req = json!({
        "input": [
            { "type": "message", "role": "user",
              "content": [{ "type": "input_text", "text": "go" }] },
            { "type": "function_call", "name": "book_search",
              "arguments": "{\"query\":\"x\"}", "call_id": "call_1" },
            { "type": "function_call_output", "call_id": "call_1",
              "output": "[{\"chunkId\":\"b::p1::c2\"}]" }
        ]
    });
    let chat = responses_request_to_chat(&req).chat;
    // user, assistant(tool_call), tool_result
    assert_eq!(chat.messages.len(), 3);
    assert!(matches!(chat.messages[1].role, ChatRole::Assistant));
    assert_eq!(chat.messages[1].tool_calls.len(), 1);
    assert_eq!(chat.messages[1].tool_calls[0].id, "call_1");
    assert_eq!(chat.messages[1].tool_calls[0].name, "book_search");
    assert_eq!(chat.messages[1].tool_calls[0].arguments, json!({ "query": "x" }));
    assert!(matches!(chat.messages[2].role, ChatRole::Tool));
    assert_eq!(chat.messages[2].tool_call_id.as_deref(), Some("call_1"));
    assert_eq!(chat.messages[2].content, "[{\"chunkId\":\"b::p1::c2\"}]");
}

#[test]
fn groups_consecutive_parallel_function_calls() {
    let req = json!({
        "input": [
            { "type": "function_call", "name": "a", "arguments": "{}", "call_id": "c1" },
            { "type": "function_call", "name": "b", "arguments": "{}", "call_id": "c2" }
        ]
    });
    let chat = responses_request_to_chat(&req).chat;
    assert_eq!(chat.messages.len(), 1);
    assert_eq!(chat.messages[0].tool_calls.len(), 2);
}

#[test]
fn collects_function_tools_qualifies_namespace_and_skips_web_search() {
    // Real codex tools: bare functions, a namespace (`mcp__books` holds the book
    // tools), and web_search. Nested tools must be qualified `<namespace>__<tool>`
    // so codex can route the function_call back to the right MCP tool.
    let req = json!({
        "tools": [
            { "type": "function", "name": "exec_command", "description": "run",
              "strict": false, "parameters": { "type": "object", "properties": {} } },
            { "type": "namespace", "name": "mcp__books", "tools": [
                { "type": "function", "name": "book_structure", "description": "s",
                  "parameters": { "type": "object", "properties": {} } },
                { "type": "function", "name": "book_search", "description": "q",
                  "parameters": { "type": "object", "properties": {} } }
            ] },
            { "type": "web_search", "external_web_access": false }
        ]
    });
    let translation = responses_request_to_chat(&req);
    let names: Vec<&str> = translation.chat.tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["exec_command", "mcp__books__book_structure", "mcp__books__book_search"]
    );
    // Missing `parameters` defaults to an object schema, never null.
    assert_eq!(translation.chat.tools[0].input_schema["type"], json!("object"));
    // `mcp__books` tools are flagged for bridge-side execution with their bare
    // MCP name; bare top-level tools get no route (codex-native passthrough).
    let route = translation
        .tool_routes
        .get("mcp__books__book_structure")
        .expect("book tool route");
    assert_eq!(route.mcp_tool.as_deref(), Some("book_structure"));
    assert_eq!(route.codex_name, "mcp__books.book_structure");
    assert!(!translation.tool_routes.contains_key("exec_command"));
}

#[test]
fn non_mcp_namespace_tools_are_not_bridge_executed() {
    // multi_agent_v1 is a namespace too, but its tools are codex-native — the
    // bridge must NOT try to execute them against book_tool_server.
    let req = json!({
        "tools": [
            { "type": "namespace", "name": "multi_agent_v1", "tools": [
                { "type": "function", "name": "spawn_agent", "description": "s",
                  "parameters": { "type": "object", "properties": {} } }
            ] }
        ]
    });
    let route = responses_request_to_chat(&req)
        .tool_routes
        .remove("multi_agent_v1__spawn_agent")
        .expect("route");
    assert!(route.mcp_tool.is_none());
    assert_eq!(route.codex_name, "multi_agent_v1.spawn_agent");
}

#[test]
fn sse_for_text_answer_has_message_events_and_completed() {
    let sse = sse(&deepseek_completion("答案文本", Vec::new()), "resp1");
    assert!(sse.contains("event: response.created"));
    assert!(sse.contains("event: response.output_item.added"));
    assert!(sse.contains("event: response.output_text.delta"));
    assert!(sse.contains("\"delta\":\"答案文本\""));
    assert!(sse.contains("event: response.output_item.done"));
    assert!(sse.contains("event: response.completed"));
    // No function-call events on a text-only turn.
    assert!(!sse.contains("function_call_arguments"));
    // Usage mapped from prompt/completion tokens.
    assert!(sse.contains("\"input_tokens\":10"));
    assert!(sse.contains("\"output_tokens\":3"));
    assert!(sse.contains("\"total_tokens\":13"));
}

#[test]
fn sse_for_tool_call_emits_function_call_item() {
    let call = ToolCall {
        id: "call_9".to_string(),
        name: "book_search".to_string(),
        arguments: json!({ "query": "焦点" }),
    };
    let sse = sse(&deepseek_completion("", vec![call]), "resp2");
    assert!(sse.contains("event: response.output_item.added"));
    assert!(sse.contains("\"type\":\"function_call\""));
    assert!(sse.contains("\"call_id\":\"call_9\""));
    assert!(sse.contains("\"name\":\"book_search\""));
    assert!(sse.contains("event: response.function_call_arguments.done"));
    assert!(sse.contains("event: response.completed"));
    // No message/text events when there is no assistant text.
    assert!(!sse.contains("output_text.delta"));
}

#[test]
fn sse_maps_anthropic_usage_and_cached_tokens() {
    let mut completion = deepseek_completion("hi", Vec::new());
    completion.usage = Some(json!({
        "input_tokens": 100, "output_tokens": 20,
        "cache_read_input_tokens": 40
    }));
    let sse = sse(&completion, "resp3");
    assert!(sse.contains("\"input_tokens\":100"));
    assert!(sse.contains("\"output_tokens\":20"));
    assert!(sse.contains("\"cached_tokens\":40"));
    assert!(sse.contains("\"total_tokens\":120")); // derived when absent
}

/// Live end-to-end smoke: real `codex exec`, driven by the app-configured model
/// through this bridge, calls a real book tool and answers from the real
/// provider (default DeepSeek). Requires the codex binary and a resolvable app
/// LLM key (from keychain/.env via `config::resolve_secret`) — it spends real
/// tokens. Run explicitly:
///   `cargo test --lib responses_bridge_codex_live_smoke -- --ignored --test-threads=1 --nocapture`
///
/// The proof that the answer came from the app provider (not codex's own
/// machine-local login) is structural: codex runs with an isolated CODEX_HOME
/// and its only configured provider is `spark` → the sole reachable model path
/// is this bridge, whose only credential is the app key resolved in Rust.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn responses_bridge_codex_live_smoke() {
    use crate::book_tool_server::{self, BookToolServerConfig};
    use crate::codex_exec::{self, BookToolsMcp, BridgeProvider, CodexEvent, CodexInvocation};

    let Some(_binary) = codex_exec::codex_binary() else {
        panic!("codex binary not found; install codex-cli to run this smoke test");
    };
    // Test builds default to the in-memory secret store; a live smoke must read
    // the real keychain like the production app does (same as config live tests).
    crate::config::set_override_secret_store_for_tests(std::sync::Arc::new(
        crate::config::KeyringSecretStoreForTests,
    ));
    // Resolve the app model from real config — fail loudly if no key, never fake-pass.
    let llm = crate::config::llm_config()
        .expect("app LLM config must resolve (missing provider key?) — cannot run live smoke");

    let dir = std::env::temp_dir().join(format!("fr-bridge-smoke-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("smoke dir");
    let db_path = dir.join("library.sqlite3");
    let _ = crate::storage::list_books(&db_path).expect("init db");

    // Book-tool MCP server (Spark's book tools).
    let book_token = "bridge-smoke-book-token".to_string();
    let book_addr = book_tool_server::spawn(BookToolServerConfig {
        db_path,
        token: book_token.clone(),
        port: 0,
    })
    .await
    .expect("bind book-tool server");

    // The Responses bridge itself — pointed at the same book-tool server so it
    // can execute codex's namespaced MCP book tools (codex can't route them).
    let bridge_token = "bridge-smoke-token".to_string();
    let bridge_addr = spawn(ResponsesBridgeConfig {
        token: bridge_token.clone(),
        port: 0,
        book_tool_base: format!("http://{book_addr}"),
        book_tool_token: book_token.clone(),
    })
    .await
    .expect("bind responses bridge");

    let invocation = CodexInvocation {
        prompt: "Use the book_structure tool (bookId \"smoke-book\") to look at the book, then reply with exactly: TOOLS_OK".to_string(),
        // codex still attaches the book MCP so it advertises the `mcp__books`
        // namespace tools in its Responses request (the bridge learns the schemas
        // there and executes them itself).
        book_tools: Some(BookToolsMcp {
            mcp_url: format!("http://{book_addr}/mcp"),
            token: book_token,
        }),
        provider: Some(BridgeProvider {
            base_url: format!("http://{bridge_addr}/v1"),
            token: bridge_token,
            model: llm.model.clone(),
        }),
        timeout: std::time::Duration::from_secs(180),
    };

    // codex never sees an mcp_tool_call (the bridge executes book tools), so we
    // count bridge-side executions instead.
    BOOK_TOOLS_EXECUTED.store(0, std::sync::atomic::Ordering::Relaxed);
    let mut codex_saw_tool_call = false;
    let outcome = codex_exec::run(
        invocation,
        |event| {
            if matches!(event, CodexEvent::ToolStarted) {
                codex_saw_tool_call = true;
            }
        },
        || false,
    )
    .await
    .expect("codex turn should complete via the bridge");

    let executed = BOOK_TOOLS_EXECUTED.load(std::sync::atomic::Ordering::Relaxed);
    println!("--- bridge live smoke ---");
    println!("app model: {}", llm.model);
    println!("final message: {}", outcome.final_message);
    println!("book tools executed by bridge: {executed}");
    println!("codex saw its own mcp_tool_call: {codex_saw_tool_call}");

    assert!(
        !outcome.final_message.trim().is_empty(),
        "bridge-driven codex turn produced no answer"
    );
    assert!(
        executed > 0,
        "expected the bridge to execute at least one book tool for the app model"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
