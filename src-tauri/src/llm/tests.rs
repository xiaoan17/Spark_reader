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
    fn book_retrieval_tools_expose_all_book_tool_schemas() {
        let tools = book_retrieval_tools();
        let names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "get_knowledge_context",
                "search_knowledge",
                "search_book",
                "get_chunk",
                "get_neighbors",
                "list_structure"
            ]
        );
        assert_eq!(tools[0].input_schema["required"][0], "query");
        assert_eq!(tools[0].input_schema["properties"]["limit"]["maximum"], 10);
        assert_eq!(tools[1].input_schema["required"][0], "query");
        assert_eq!(tools[1].input_schema["properties"]["limit"]["maximum"], 12);
        assert_eq!(tools[2].input_schema["required"][0], "query");
        assert_eq!(tools[3].input_schema["required"][0], "chunk_id");
        assert_eq!(tools[4].input_schema["properties"]["radius"]["maximum"], 3);
        assert!(tools[5].input_schema["properties"].is_object());
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
    fn parses_anthropic_cache_usage_tokens() {
        let usage = json!({
            "input_tokens": 120,
            "output_tokens": 30,
            "cache_creation_input_tokens": 80,
            "cache_read_input_tokens": 40
        });

        assert_eq!(
            usage_token(&usage, &["prompt_tokens", "input_tokens"]),
            Some(120)
        );
        assert_eq!(
            usage_token(&usage, &["completion_tokens", "output_tokens"]),
            Some(30)
        );
        assert_eq!(
            usage_token(&usage, &["cache_creation_input_tokens"]),
            Some(80)
        );
        assert_eq!(usage_token(&usage, &["cache_read_input_tokens"]), Some(40));
    }

    #[test]
    fn parses_openai_cached_prompt_tokens() {
        let usage = json!({
            "prompt_tokens": 200,
            "completion_tokens": 25,
            "total_tokens": 225,
            "prompt_tokens_details": {
                "cached_tokens": 150
            }
        });

        assert_eq!(
            usage_token(&usage, &["prompt_tokens", "input_tokens"]),
            Some(200)
        );
        assert_eq!(
            usage_token(&usage, &["completion_tokens", "output_tokens"]),
            Some(25)
        );
        assert_eq!(usage_token(&usage, &["total_tokens"]), Some(225));
        assert_eq!(
            usage_nested_token(&usage, "prompt_tokens_details", "cached_tokens"),
            Some(150)
        );
    }

    #[test]
    fn chat_text_response_detects_token_limit_stops() {
        assert!(ChatTextResponse {
            content: "未完".to_string(),
            stop_reason: Some("length".to_string()),
        }
        .stopped_by_token_limit());
        assert!(ChatTextResponse {
            content: "未完".to_string(),
            stop_reason: Some("max_tokens".to_string()),
        }
        .stopped_by_token_limit());
        assert!(!ChatTextResponse {
            content: "完成".to_string(),
            stop_reason: Some("stop".to_string()),
        }
        .stopped_by_token_limit());
    }

    #[test]
    fn openai_chat_body_translates_native_tool_results() {
        let request = tool_round_request();
        let body = openai_chat_body(&llm_config(LlmProviderKind::DeepSeek), &request, false);
        let messages = json_array(&body["messages"]);

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
        let messages = json_array(&body["messages"]);

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
            tools: vec![search_book_tool()],
            max_tokens: 800,
            temperature: 0.1,
        }
    }

    fn json_array(value: &Value) -> &[Value] {
        assert!(value.is_array(), "expected JSON array, got {value}");
        value
            .as_array()
            .unwrap_or_else(|| unreachable!("checked above"))
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
