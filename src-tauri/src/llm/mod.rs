use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::config::{self, LlmProviderKind};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResponse {
    pub provider: LlmProviderKind,
    pub model: String,
    pub ok: bool,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub fn search_book_tool() -> ToolDefinition {
    ToolDefinition {
        name: "search_book".to_string(),
        description: "Search indexed chunks in the current book. Use this first for concepts, definitions, context, echoes, and follow-up questions.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A focused search query grounded in the selected text."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 12
                }
            },
            "required": ["query"]
        }),
    }
}

pub fn search_knowledge_tool() -> ToolDefinition {
    ToolDefinition {
        name: "search_knowledge".to_string(),
        description: "Search the current book's built knowledge system, including saved notes and auto-generated full-book concepts, entities, events, claims, and section summaries. It returns original evidence chunks. Final citations must still cite chunk_id evidence, never card ids.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A focused query for saved knowledge cards in the current book."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 12
                }
            },
            "required": ["query"]
        }),
    }
}

pub fn get_knowledge_context_tool() -> ToolDefinition {
    ToolDefinition {
        name: "get_knowledge_context".to_string(),
        description: "Inspect a compact knowledge-graph context for the current book: matching cards, graph relations, map stations, and their evidence chunk ids. Use this before synthesis when the answer should connect to the book's knowledge graph. Do not cite card ids in the final answer; cite only chunk ids.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A focused topic, entity, event, claim, or user question to inspect in the knowledge graph."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10
                }
            },
            "required": ["query"]
        }),
    }
}

pub fn get_chunk_tool() -> ToolDefinition {
    ToolDefinition {
        name: "get_chunk".to_string(),
        description: "Fetch one exact chunk by stable chunk_id.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "chunk_id": { "type": "string" }
            },
            "required": ["chunk_id"]
        }),
    }
}

pub fn get_neighbors_tool() -> ToolDefinition {
    ToolDefinition {
        name: "get_neighbors".to_string(),
        description: "Fetch nearby chunks before and after a known chunk_id for local context."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "chunk_id": { "type": "string" },
                "radius": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 3
                }
            },
            "required": ["chunk_id"]
        }),
    }
}

pub fn list_structure_tool() -> ToolDefinition {
    ToolDefinition {
        name: "list_structure".to_string(),
        description: "List representative structure chunks when direct evidence is sparse."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
    }
}

pub fn book_retrieval_tools() -> Vec<ToolDefinition> {
    vec![
        get_knowledge_context_tool(),
        search_knowledge_tool(),
        search_book_tool(),
        get_chunk_tool(),
        get_neighbors_tool(),
        list_structure_tool(),
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatToolResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTextResponse {
    pub content: String,
    pub stop_reason: Option<String>,
}

impl ChatTextResponse {
    pub fn stopped_by_token_limit(&self) -> bool {
        self.stop_reason
            .as_deref()
            .is_some_and(is_token_limit_stop_reason)
    }
}

fn is_token_limit_stop_reason(reason: &str) -> bool {
    matches!(
        reason,
        "length" | "max_tokens" | "max_output_tokens" | "model_length" | "token_limit"
    )
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: u32,
    pub temperature: f32,
}

impl ChatRequest {
    pub fn plain(messages: Vec<ChatMessage>, max_tokens: u32) -> Self {
        Self {
            messages,
            tools: Vec::new(),
            max_tokens,
            temperature: 0.2,
        }
    }
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::System,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::User,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
    }

    pub fn assistant(content: impl Into<String>, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: ChatRole::Assistant,
            content: content.into(),
            tool_calls,
            tool_call_id: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: ChatRole::Tool,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: Some(tool_call_id.into()),
        }
    }
}

#[derive(Debug, Error)]
pub enum LlmError {
    #[error(transparent)]
    Config(#[from] config::ConfigError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("provider returned {status}: {body}")]
    Provider { status: u16, body: String },
    #[error("invalid auth header")]
    InvalidHeader,
    #[error("LLM request was cancelled")]
    Cancelled,
}

pub type CancellationToken = Arc<AtomicBool>;

pub fn cancellation_token() -> CancellationToken {
    Arc::new(AtomicBool::new(false))
}

pub fn cancel(token: &CancellationToken) {
    token.store(true, Ordering::SeqCst);
}

pub fn is_cancelled(token: &CancellationToken) -> bool {
    token.load(Ordering::SeqCst)
}

pub fn active_model_label() -> Result<String, LlmError> {
    let config = config::llm_config()?;
    Ok(format!("{:?}/{}", config.provider, config.model))
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    id: Option<String>,
    choices: Vec<OpenAiChoice>,
    usage: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    choices: Vec<OpenAiDeltaChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiDeltaChoice {
    delta: OpenAiDelta,
}

#[derive(Debug, Deserialize)]
struct OpenAiDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicMessageResponse {
    content: Vec<AnthropicContentBlock>,
    stop_reason: Option<String>,
    usage: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    id: Option<String>,
    #[serde(rename = "type")]
    block_type: String,
    name: Option<String>,
    input: Option<Value>,
    text: Option<String>,
}

pub async fn test_connection() -> Result<ConnectionTestResponse, LlmError> {
    let config = config::llm_config()?;
    test_connection_for_config(config).await
}

pub async fn test_connection_with_settings(
    request: config::SaveLlmSettingsRequest,
) -> Result<ConnectionTestResponse, LlmError> {
    let config = config::llm_config_from_request(&request)?;
    test_connection_for_config(config).await
}

async fn test_connection_for_config(
    config: config::LlmConfig,
) -> Result<ConnectionTestResponse, LlmError> {
    match config.provider {
        LlmProviderKind::DeepSeek | LlmProviderKind::OpenAi => {
            test_openai_compat(&config).await?;
        }
        LlmProviderKind::Anthropic => {
            test_anthropic(&config).await?;
        }
    }

    Ok(ConnectionTestResponse {
        provider: config.provider,
        model: config.model,
        ok: true,
    })
}

pub async fn chat(messages: Vec<ChatMessage>, max_tokens: u32) -> Result<String, LlmError> {
    Ok(chat_text(messages, max_tokens).await?.content)
}

pub async fn chat_text(
    messages: Vec<ChatMessage>,
    max_tokens: u32,
) -> Result<ChatTextResponse, LlmError> {
    let config = config::llm_config()?;
    let request = ChatRequest::plain(messages, max_tokens);

    match config.provider {
        LlmProviderKind::DeepSeek | LlmProviderKind::OpenAi => {
            chat_openai_compat(&config, request).await
        }
        LlmProviderKind::Anthropic => chat_anthropic(&config, request).await,
    }
}

pub async fn chat_with_tools(request: ChatRequest) -> Result<ChatToolResponse, LlmError> {
    let config = config::llm_config()?;

    match config.provider {
        LlmProviderKind::DeepSeek | LlmProviderKind::OpenAi => {
            chat_openai_compat_with_tools(&config, request).await
        }
        LlmProviderKind::Anthropic => chat_anthropic_with_tools(&config, request).await,
    }
}

/// One provider turn for the Responses bridge: text + tool calls + usage +
/// stop reason, plus the resolved provider/model so the bridge can tag the SSE
/// response and caches. A single attempt — retry/backoff lives in the bridge so
/// it can react to the `LlmError::Provider { status }` it sees (e.g. 429).
#[derive(Debug, Clone)]
pub struct BridgeCompletion {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage: Option<Value>,
    /// The resolved app model name, echoed into the Responses SSE so codex (and
    /// the live smoke) can confirm the answer came from the app provider.
    pub model: String,
}

/// Run one bridge turn against the app's currently configured provider,
/// preserving tool calls, usage, and stop reason for Responses translation.
pub async fn complete_for_bridge(request: ChatRequest) -> Result<BridgeCompletion, LlmError> {
    let config = config::llm_config()?;
    match config.provider {
        LlmProviderKind::DeepSeek | LlmProviderKind::OpenAi => {
            complete_openai_compat_for_bridge(&config, request).await
        }
        LlmProviderKind::Anthropic => complete_anthropic_for_bridge(&config, request).await,
    }
}

async fn complete_openai_compat_for_bridge(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<BridgeCompletion, LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = openai_chat_body(config, &request, false);

    let response = client
        .post(url)
        .headers(bearer_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: Value = serde_json::from_str(&text).map_err(|_| LlmError::Provider {
        status: status.as_u16(),
        body: text.clone(),
    })?;
    log_llm_usage(config.provider, parsed.get("usage"));

    let message = parsed
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first());
    let content = message
        .and_then(|choice| choice.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let tool_calls = message
        .and_then(|choice| choice.get("message"))
        .map(parse_openai_tool_calls)
        .unwrap_or_default();

    Ok(BridgeCompletion {
        text: content,
        tool_calls,
        usage: parsed.get("usage").cloned(),
        model: config.model.clone(),
    })
}

async fn complete_anthropic_for_bridge(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<BridgeCompletion, LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/v1/messages", config.base_url.trim_end_matches('/'));
    let system = request
        .messages
        .iter()
        .filter(|message| matches!(message.role, ChatRole::System))
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let chat_messages = request
        .messages
        .iter()
        .filter(|message| !matches!(message.role, ChatRole::System))
        .map(anthropic_message_json)
        .collect::<Vec<_>>();
    let mut body = anthropic_chat_body(config, &request, chat_messages);
    if !system.trim().is_empty() {
        body["system"] = anthropic_cached_text_block(system);
    }

    let response = client
        .post(url)
        .headers(anthropic_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: AnthropicMessageResponse =
        serde_json::from_str(&text).map_err(|_| LlmError::Provider {
            status: status.as_u16(),
            body: text.clone(),
        })?;
    log_llm_usage(config.provider, parsed.usage.as_ref());
    let usage = parsed.usage.clone();
    let ChatToolResponse {
        content,
        tool_calls,
    } = parse_anthropic_tool_response(parsed.content);

    Ok(BridgeCompletion {
        text: content,
        tool_calls,
        usage,
        model: config.model.clone(),
    })
}

pub async fn chat_stream_with_cancellation<F>(
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    cancellation: Option<CancellationToken>,
    on_delta: F,
) -> Result<String, LlmError>
where
    F: FnMut(&str) + Send,
{
    let config = config::llm_config()?;
    let request = ChatRequest::plain(messages, max_tokens);

    match config.provider {
        LlmProviderKind::DeepSeek | LlmProviderKind::OpenAi => {
            chat_openai_compat_stream(&config, request, cancellation, on_delta).await
        }
        LlmProviderKind::Anthropic => {
            if cancellation.as_ref().is_some_and(is_cancelled) {
                return Err(LlmError::Cancelled);
            }
            let answer = chat_anthropic(&config, request).await?.content;
            if cancellation.as_ref().is_some_and(is_cancelled) {
                return Err(LlmError::Cancelled);
            }
            let mut on_delta = on_delta;
            on_delta(&answer);
            Ok(answer)
        }
    }
}

async fn test_openai_compat(config: &config::LlmConfig) -> Result<(), LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = json!({
        "model": config.model,
        "messages": [
            { "role": "system", "content": "You are a connectivity probe." },
            { "role": "user", "content": "Reply with OK." }
        ],
        "max_tokens": 4,
        "temperature": 0
    });

    let response = client
        .post(url)
        .headers(bearer_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: ChatCompletionResponse =
        serde_json::from_str(&text).map_err(|_| LlmError::Provider {
            status: status.as_u16(),
            body: text.clone(),
        })?;
    let _ = parsed.id;
    log_llm_usage(config.provider, parsed.usage.as_ref());
    Ok(())
}

async fn chat_openai_compat(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<ChatTextResponse, LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = openai_chat_body(config, &request, false);

    let response = client
        .post(url)
        .headers(bearer_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: ChatCompletionResponse =
        serde_json::from_str(&text).map_err(|_| LlmError::Provider {
            status: status.as_u16(),
            body: text.clone(),
        })?;
    log_llm_usage(config.provider, parsed.usage.as_ref());

    parsed
        .choices
        .into_iter()
        .find_map(|choice| {
            choice
                .message
                .content
                .map(|content| ChatTextResponse {
                    content: content.trim().to_string(),
                    stop_reason: choice.finish_reason,
                })
                .filter(|response| !response.content.is_empty())
        })
        .ok_or_else(|| LlmError::Provider {
            status: status.as_u16(),
            body: text,
        })
}

async fn chat_openai_compat_with_tools(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<ChatToolResponse, LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = openai_chat_body(config, &request, false);

    let response = client
        .post(url)
        .headers(bearer_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: Value = serde_json::from_str(&text).map_err(|_| LlmError::Provider {
        status: status.as_u16(),
        body: text.clone(),
    })?;
    log_llm_usage(config.provider, parsed.get("usage"));
    parse_openai_tool_response(&parsed).ok_or_else(|| LlmError::Provider {
        status: status.as_u16(),
        body: text,
    })
}

async fn chat_openai_compat_stream<F>(
    config: &config::LlmConfig,
    request: ChatRequest,
    cancellation: Option<CancellationToken>,
    mut on_delta: F,
) -> Result<String, LlmError>
where
    F: FnMut(&str) + Send,
{
    if cancellation.as_ref().is_some_and(is_cancelled) {
        return Err(LlmError::Cancelled);
    }
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = openai_chat_body(config, &request, true);

    let response = client
        .post(url)
        .headers(bearer_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await?;
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let mut answer = String::new();
    let mut pending = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancellation.as_ref().is_some_and(is_cancelled) {
            return Err(LlmError::Cancelled);
        }
        let chunk = chunk?;
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(event_end) = find_sse_event_end(&pending) {
            let raw_event = pending[..event_end].to_string();
            let drain_to = event_end + sse_separator_len(&pending[event_end..]);
            pending.drain(..drain_to);
            for data in parse_sse_data_lines(&raw_event) {
                let trimmed = data.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed == "[DONE]" {
                    return Ok(answer.trim().to_string());
                }
                let parsed: ChatCompletionChunk =
                    serde_json::from_str(trimmed).map_err(|_| LlmError::Provider {
                        status: status.as_u16(),
                        body: trimmed.to_string(),
                    })?;
                for choice in parsed.choices {
                    if let Some(delta) = choice.delta.content {
                        if !delta.is_empty() {
                            if cancellation.as_ref().is_some_and(is_cancelled) {
                                return Err(LlmError::Cancelled);
                            }
                            answer.push_str(&delta);
                            on_delta(&delta);
                        }
                    }
                }
            }
        }
    }

    if answer.trim().is_empty() {
        Err(LlmError::Provider {
            status: status.as_u16(),
            body: pending,
        })
    } else {
        Ok(answer.trim().to_string())
    }
}

async fn chat_anthropic(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<ChatTextResponse, LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/v1/messages", config.base_url.trim_end_matches('/'));
    let system = request
        .messages
        .iter()
        .filter(|message| matches!(message.role, ChatRole::System))
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let chat_messages = request
        .messages
        .iter()
        .filter(|message| !matches!(message.role, ChatRole::System))
        .map(anthropic_message_json)
        .collect::<Vec<_>>();
    let mut body = anthropic_chat_body(config, &request, chat_messages);

    if !system.trim().is_empty() {
        body["system"] = anthropic_cached_text_block(system);
    }

    let response = client
        .post(url)
        .headers(anthropic_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: AnthropicMessageResponse =
        serde_json::from_str(&text).map_err(|_| LlmError::Provider {
            status: status.as_u16(),
            body: text.clone(),
        })?;
    log_llm_usage(config.provider, parsed.usage.as_ref());
    let answer = parsed
        .content
        .into_iter()
        .filter(|block| block.block_type == "text")
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("\n\n")
        .trim()
        .to_string();

    if answer.is_empty() {
        Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        })
    } else {
        Ok(ChatTextResponse {
            content: answer,
            stop_reason: parsed.stop_reason,
        })
    }
}

async fn chat_anthropic_with_tools(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<ChatToolResponse, LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/v1/messages", config.base_url.trim_end_matches('/'));
    let system = request
        .messages
        .iter()
        .filter(|message| matches!(message.role, ChatRole::System))
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let chat_messages = request
        .messages
        .iter()
        .filter(|message| !matches!(message.role, ChatRole::System))
        .map(anthropic_message_json)
        .collect::<Vec<_>>();
    let mut body = anthropic_chat_body(config, &request, chat_messages);

    if !system.trim().is_empty() {
        body["system"] = anthropic_cached_text_block(system);
    }

    let response = client
        .post(url)
        .headers(anthropic_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let parsed: AnthropicMessageResponse =
        serde_json::from_str(&text).map_err(|_| LlmError::Provider {
            status: status.as_u16(),
            body: text.clone(),
        })?;
    log_llm_usage(config.provider, parsed.usage.as_ref());
    Ok(parse_anthropic_tool_response(parsed.content))
}

fn openai_message_json(message: &ChatMessage) -> Value {
    match message.role {
        ChatRole::System => json!({
            "role": "system",
            "content": message.content,
        }),
        ChatRole::User => json!({
            "role": "user",
            "content": message.content,
        }),
        ChatRole::Assistant => {
            let mut value = json!({
                "role": "assistant",
                "content": message.content,
            });
            if !message.tool_calls.is_empty() {
                value["tool_calls"] = json!(message
                    .tool_calls
                    .iter()
                    .map(openai_tool_call_json)
                    .collect::<Vec<_>>());
            }
            value
        }
        ChatRole::Tool => json!({
            "role": "tool",
            "tool_call_id": message.tool_call_id.clone().unwrap_or_default(),
            "content": message.content,
        }),
    }
}

fn openai_tool_call_json(tool_call: &ToolCall) -> Value {
    json!({
        "id": tool_call.id,
        "type": "function",
        "function": {
            "name": tool_call.name,
            "arguments": tool_call.arguments.to_string(),
        }
    })
}

fn openai_tool_json(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        }
    })
}

fn openai_chat_body(config: &config::LlmConfig, request: &ChatRequest, stream: bool) -> Value {
    let mut body = json!({
        "model": config.model,
        "messages": request
            .messages
            .iter()
            .map(openai_message_json)
            .collect::<Vec<_>>(),
        "max_tokens": request.max_tokens,
        "temperature": request.temperature
    });
    if stream {
        body["stream"] = json!(true);
    }
    if !request.tools.is_empty() {
        body["tools"] = json!(request
            .tools
            .iter()
            .map(openai_tool_json)
            .collect::<Vec<_>>());
        body["tool_choice"] = json!("auto");
    }
    body
}

fn anthropic_message_json(message: &ChatMessage) -> Value {
    match message.role {
        ChatRole::System | ChatRole::User => json!({
            "role": "user",
            "content": message.content,
        }),
        ChatRole::Assistant => {
            let mut content = Vec::new();
            if !message.content.trim().is_empty() {
                content.push(json!({
                    "type": "text",
                    "text": message.content,
                }));
            }
            for tool_call in &message.tool_calls {
                content.push(json!({
                    "type": "tool_use",
                    "id": tool_call.id,
                    "name": tool_call.name,
                    "input": tool_call.arguments,
                }));
            }
            json!({
                "role": "assistant",
                "content": content,
            })
        }
        ChatRole::Tool => json!({
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id.clone().unwrap_or_default(),
                    "content": message.content,
                }
            ],
        }),
    }
}

fn anthropic_tool_json(tool: &ToolDefinition) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
        "cache_control": { "type": "ephemeral" },
    })
}

fn anthropic_cached_text_block(text: String) -> Value {
    json!([
        {
            "type": "text",
            "text": text,
            "cache_control": { "type": "ephemeral" }
        }
    ])
}

fn anthropic_chat_body(
    config: &config::LlmConfig,
    request: &ChatRequest,
    chat_messages: Vec<Value>,
) -> Value {
    let mut body = json!({
        "model": config.model,
        "max_tokens": request.max_tokens,
        "temperature": request.temperature,
        "messages": chat_messages
    });
    if !request.tools.is_empty() {
        body["tools"] = json!(request
            .tools
            .iter()
            .map(anthropic_tool_json)
            .collect::<Vec<_>>());
    }
    body
}

fn parse_openai_tool_calls(message: &Value) -> Vec<ToolCall> {
    message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tool_call| {
            let function = tool_call.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let arguments = function
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .unwrap_or_else(|| json!({}));
            Some(ToolCall {
                id: tool_call
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                name,
                arguments,
            })
        })
        .collect()
}

fn parse_openai_tool_response(value: &Value) -> Option<ChatToolResponse> {
    let message = value.get("choices")?.as_array()?.first()?.get("message")?;
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    Some(ChatToolResponse {
        content,
        tool_calls: parse_openai_tool_calls(message),
    })
}

fn parse_anthropic_tool_calls(content: &[AnthropicContentBlock]) -> Vec<ToolCall> {
    content
        .iter()
        .filter(|block| block.block_type == "tool_use")
        .filter_map(|block| {
            let name = block.name.as_ref()?.to_string();
            Some(ToolCall {
                id: block.id.clone().unwrap_or_default(),
                name,
                arguments: block.input.clone().unwrap_or_else(|| json!({})),
            })
        })
        .collect()
}

fn parse_anthropic_tool_response(content: Vec<AnthropicContentBlock>) -> ChatToolResponse {
    let answer = content
        .iter()
        .filter(|block| block.block_type == "text")
        .filter_map(|block| block.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n\n")
        .trim()
        .to_string();
    let tool_calls = parse_anthropic_tool_calls(&content);
    ChatToolResponse {
        content: answer,
        tool_calls,
    }
}

fn log_llm_usage(provider: LlmProviderKind, usage: Option<&Value>) {
    let Some(usage) = usage else {
        return;
    };
    let input_tokens = usage_token(usage, &["prompt_tokens", "input_tokens"]);
    let output_tokens = usage_token(usage, &["completion_tokens", "output_tokens"]);
    let total_tokens = usage_token(usage, &["total_tokens"]);
    let cache_creation_input_tokens = usage_token(usage, &["cache_creation_input_tokens"]);
    let cache_read_input_tokens = usage_token(usage, &["cache_read_input_tokens"]);
    let cached_prompt_tokens = usage_nested_token(usage, "prompt_tokens_details", "cached_tokens");
    if input_tokens
        .or(output_tokens)
        .or(total_tokens)
        .or(cache_creation_input_tokens)
        .or(cache_read_input_tokens)
        .or(cached_prompt_tokens)
        .is_none()
    {
        return;
    }
    eprintln!(
        "llm usage provider={provider:?} input_tokens={} output_tokens={} total_tokens={} cache_creation_input_tokens={} cache_read_input_tokens={} cached_prompt_tokens={}",
        usage_token_label(input_tokens),
        usage_token_label(output_tokens),
        usage_token_label(total_tokens),
        usage_token_label(cache_creation_input_tokens),
        usage_token_label(cache_read_input_tokens),
        usage_token_label(cached_prompt_tokens),
    );
}

fn usage_token(usage: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| usage.get(*key).and_then(Value::as_u64))
}

fn usage_nested_token(usage: &Value, object_key: &str, token_key: &str) -> Option<u64> {
    usage
        .get(object_key)
        .and_then(|value| value.get(token_key))
        .and_then(Value::as_u64)
}

fn usage_token_label(value: Option<u64>) -> String {
    value
        .map(|tokens| tokens.to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn find_sse_event_end(buffer: &str) -> Option<usize> {
    buffer.find("\n\n").or_else(|| buffer.find("\r\n\r\n"))
}

fn sse_separator_len(separator_and_tail: &str) -> usize {
    if separator_and_tail.starts_with("\r\n\r\n") {
        4
    } else {
        2
    }
}

fn parse_sse_data_lines(event: &str) -> Vec<String> {
    event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.trim_start().to_string())
        .collect()
}

async fn test_anthropic(config: &config::LlmConfig) -> Result<(), LlmError> {
    let client = reqwest::Client::new();
    let url = format!("{}/v1/messages", config.base_url.trim_end_matches('/'));
    let body = json!({
        "model": config.model,
        "max_tokens": 4,
        "messages": [
            { "role": "user", "content": "Reply with OK." }
        ]
    });

    let response = client
        .post(url)
        .headers(anthropic_headers(&config.api_key)?)
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(LlmError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    Ok(())
}

fn bearer_headers(api_key: &str) -> Result<HeaderMap, LlmError> {
    let mut headers = HeaderMap::new();
    let value = format!("Bearer {api_key}");
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&value).map_err(|_| LlmError::InvalidHeader)?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

fn anthropic_headers(api_key: &str) -> Result<HeaderMap, LlmError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|_| LlmError::InvalidHeader)?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

#[cfg(test)]
mod tests;
