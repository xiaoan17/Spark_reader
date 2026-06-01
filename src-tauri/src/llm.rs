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

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    id: Option<String>,
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
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
            let answer = chat_anthropic(&config, request).await?;
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
    Ok(())
}

async fn chat_openai_compat(
    config: &config::LlmConfig,
    request: ChatRequest,
) -> Result<String, LlmError> {
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

    parsed
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
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
) -> Result<String, LlmError> {
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
        Ok(answer)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{LlmConfig, LlmProviderKind};

    #[test]
    fn parses_sse_data_lines() {
        let event = "event: message\ndata: {\"a\":1}\ndata: [DONE]\n";
        assert_eq!(
            parse_sse_data_lines(event),
            vec!["{\"a\":1}".to_string(), "[DONE]".to_string()]
        );
    }

    #[test]
    fn detects_lf_and_crlf_sse_event_boundaries() {
        assert_eq!(find_sse_event_end("data: one\n\nrest"), Some(9));
        assert_eq!(find_sse_event_end("data: one\r\n\r\nrest"), Some(9));
        assert_eq!(sse_separator_len("\r\n\r\nrest"), 4);
        assert_eq!(sse_separator_len("\n\nrest"), 2);
    }

    #[test]
    fn openai_chat_body_translates_provider_neutral_tools() {
        let body = openai_chat_body(
            &llm_config(LlmProviderKind::DeepSeek),
            &tool_request(),
            true,
        );

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["stream"], true);
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "search_book");
        assert_eq!(
            body["tools"][0]["function"]["parameters"]["properties"]["query"]["type"],
            "string"
        );
    }

    #[test]
    fn anthropic_chat_body_translates_provider_neutral_tools() {
        let request = tool_request();
        let chat_messages = request
            .messages
            .iter()
            .filter(|message| !matches!(message.role, ChatRole::System))
            .map(anthropic_message_json)
            .collect::<Vec<_>>();
        let body = anthropic_chat_body(
            &llm_config(LlmProviderKind::Anthropic),
            &request,
            chat_messages,
        );

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["tools"][0]["name"], "search_book");
        assert_eq!(
            body["tools"][0]["input_schema"]["properties"]["query"]["type"],
            "string"
        );
        assert_eq!(body["tools"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["messages"][0]["role"], "user");
    }

    #[test]
    fn anthropic_prompt_cache_marks_static_blocks_only() {
        let request = tool_round_request();
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
        let mut body = anthropic_chat_body(
            &llm_config(LlmProviderKind::Anthropic),
            &request,
            chat_messages,
        );
        body["system"] = anthropic_cached_text_block(system);

        assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["tools"][0]["cache_control"]["type"], "ephemeral");
        let tool_result = &body["messages"][2]["content"][0];
        assert_eq!(tool_result["type"], "tool_result");
        assert!(tool_result.get("cache_control").is_none());
    }

    #[test]
    fn openai_chat_body_translates_native_tool_results() {
        let request = tool_round_request();
        let body = openai_chat_body(&llm_config(LlmProviderKind::DeepSeek), &request, false);
        let messages = body["messages"].as_array().expect("messages array");

        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[2]["tool_calls"][0]["id"], "call-1");
        assert_eq!(
            messages[2]["tool_calls"][0]["function"]["name"],
            "search_book"
        );
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "call-1");
        assert!(messages[3]["content"]
            .as_str()
            .is_some_and(|content| content.contains("[p1-c1]")));
    }

    #[test]
    fn anthropic_chat_body_translates_native_tool_results() {
        let request = tool_round_request();
        let chat_messages = request
            .messages
            .iter()
            .filter(|message| !matches!(message.role, ChatRole::System))
            .map(anthropic_message_json)
            .collect::<Vec<_>>();
        let body = anthropic_chat_body(
            &llm_config(LlmProviderKind::Anthropic),
            &request,
            chat_messages,
        );
        let messages = body["messages"].as_array().expect("messages array");

        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"][0]["type"], "text");
        assert_eq!(messages[1]["content"][1]["type"], "tool_use");
        assert_eq!(messages[1]["content"][1]["id"], "call-1");
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "call-1");
        assert!(messages[2]["content"][0]["content"]
            .as_str()
            .is_some_and(|content| content.contains("[p1-c1]")));
    }

    #[test]
    fn parses_openai_tool_calls_into_neutral_shape() {
        let message = json!({
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "search_book",
                        "arguments": "{\"query\":\"复利\",\"limit\":4}"
                    }
                }
            ]
        });

        assert_eq!(
            parse_openai_tool_calls(&message),
            vec![ToolCall {
                id: "call-1".to_string(),
                name: "search_book".to_string(),
                arguments: json!({"query": "复利", "limit": 4}),
            }]
        );
    }

    #[test]
    fn parses_openai_tool_response_content_and_calls() {
        let response = json!({
            "choices": [
                {
                    "message": {
                        "content": "我需要先查书内证据。",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "search_book",
                                    "arguments": "{\"query\":\"复利\"}"
                                }
                            }
                        ]
                    }
                }
            ]
        });

        assert_eq!(
            parse_openai_tool_response(&response),
            Some(ChatToolResponse {
                content: "我需要先查书内证据。".to_string(),
                tool_calls: vec![ToolCall {
                    id: "call-1".to_string(),
                    name: "search_book".to_string(),
                    arguments: json!({"query": "复利"}),
                }],
            })
        );
    }

    #[test]
    fn parses_anthropic_tool_use_into_neutral_shape() {
        let content = vec![AnthropicContentBlock {
            id: Some("toolu-1".to_string()),
            block_type: "tool_use".to_string(),
            name: Some("get_neighbors".to_string()),
            input: Some(json!({"chunk_id": "p1-c1", "radius": 1})),
            text: None,
        }];

        assert_eq!(
            parse_anthropic_tool_calls(&content),
            vec![ToolCall {
                id: "toolu-1".to_string(),
                name: "get_neighbors".to_string(),
                arguments: json!({"chunk_id": "p1-c1", "radius": 1}),
            }]
        );
    }

    #[test]
    fn parses_anthropic_tool_response_content_and_calls() {
        let response = parse_anthropic_tool_response(vec![
            AnthropicContentBlock {
                id: None,
                block_type: "text".to_string(),
                name: None,
                input: None,
                text: Some("先读相邻上下文。".to_string()),
            },
            AnthropicContentBlock {
                id: Some("toolu-1".to_string()),
                block_type: "tool_use".to_string(),
                name: Some("get_neighbors".to_string()),
                input: Some(json!({"chunk_id": "p1-c1", "radius": 1})),
                text: None,
            },
        ]);

        assert_eq!(
            response,
            ChatToolResponse {
                content: "先读相邻上下文。".to_string(),
                tool_calls: vec![ToolCall {
                    id: "toolu-1".to_string(),
                    name: "get_neighbors".to_string(),
                    arguments: json!({"chunk_id": "p1-c1", "radius": 1}),
                }],
            }
        );
    }

    fn llm_config(provider: LlmProviderKind) -> LlmConfig {
        LlmConfig {
            provider,
            api_key: "test-key".to_string(),
            base_url: "https://example.test".to_string(),
            model: "test-model".to_string(),
        }
    }

    fn tool_request() -> ChatRequest {
        ChatRequest {
            messages: vec![
                ChatMessage::system("系统提示"),
                ChatMessage::user("查找复利"),
            ],
            tools: vec![ToolDefinition {
                name: "search_book".to_string(),
                description: "Search indexed book chunks by query.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "integer" }
                    },
                    "required": ["query"]
                }),
            }],
            max_tokens: 800,
            temperature: 0.1,
        }
    }

    fn tool_round_request() -> ChatRequest {
        let mut request = tool_request();
        request.messages.push(ChatMessage::assistant(
            "先搜索书内证据。",
            vec![ToolCall {
                id: "call-1".to_string(),
                name: "search_book".to_string(),
                arguments: json!({"query": "复利", "limit": 4}),
            }],
        ));
        request.messages.push(ChatMessage::tool_result(
            "call-1",
            "[p1-c1] page 1\n复利来自长期坚持。",
        ));
        request
    }
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
