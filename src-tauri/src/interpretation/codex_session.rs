    use super::*;
    use crate::codex_exec::{self, CodexEvent, CodexExecError};

    /// Cap on how long we wait for the codex turn before giving up (and falling
    /// back to Rust). Generous because agentic retrieval + synthesis is multi-step.
    const SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

    /// Engine-agnostic agent instructions (compiled into the binary so the
    /// packaged app needs no external prompt assets).
    const DEEP_READER_INSTRUCTIONS: &str = include_str!("../../prompts/deep-reader.md");

    #[derive(Debug)]
    pub enum CodexInterpretError {
        Cancelled,
        Engine(String),
        Empty,
    }

    impl std::fmt::Display for CodexInterpretError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                CodexInterpretError::Cancelled => write!(f, "cancelled"),
                CodexInterpretError::Engine(msg) => write!(f, "engine: {msg}"),
                CodexInterpretError::Empty => write!(f, "empty answer from codex"),
            }
        }
    }

    pub async fn interpret_via_codex(
        app: &AppHandle,
        request_id: &str,
        db_path: &Path,
        request: &InterpretRequest,
        book_tools: codex_exec::BookToolsMcp,
        cancellation: CancellationToken,
    ) -> Result<InterpretResponse, CodexInterpretError> {
        emit_stream_event(
            app,
            InterpretationStreamEvent {
                request_id: request_id.to_string(),
                stage: InterpretationStreamStage::Planning,
                message: "正在通过 Codex 规划检索".to_string(),
                delta: None,
                answer: None,
                answer_source: None,
                evidence: Vec::new(),
                trace: Vec::new(),
            },
        );

        let prompt = format!(
            "{DEEP_READER_INSTRUCTIONS}\n\n---\n\n{}",
            build_codex_prompt(request)
        );
        let invocation = codex_exec::CodexInvocation {
            prompt,
            book_tools: Some(book_tools),
            provider: crate::agent_host::bridge_provider(),
            timeout: SESSION_TIMEOUT,
        };

        // `codex exec --json` has no token-level deltas: agent messages arrive
        // complete. We surface tool progress as the "retrieving" stage and the
        // finished message as one delta so the UI still paints incrementally.
        let mut emitted_retrieving = false;
        let mut tool_chunk_ids: Vec<String> = Vec::new();
        let outcome = codex_exec::run(
            invocation,
            |event| match event {
                CodexEvent::ToolStarted => {
                    if !emitted_retrieving {
                        emitted_retrieving = true;
                        emit_stream_event(
                            app,
                            InterpretationStreamEvent {
                                request_id: request_id.to_string(),
                                stage: InterpretationStreamStage::Retrieving,
                                message: "Codex 正在检索书内证据".to_string(),
                                delta: None,
                                answer: None,
                                answer_source: None,
                                evidence: Vec::new(),
                                trace: Vec::new(),
                            },
                        );
                    }
                }
                CodexEvent::ItemCompleted(item) => {
                    for chunk_id in extract_chunk_ids_deep(item) {
                        if !tool_chunk_ids.contains(&chunk_id) {
                            tool_chunk_ids.push(chunk_id);
                        }
                    }
                }
                CodexEvent::AgentMessage(text) => {
                    emit_stream_event(
                        app,
                        InterpretationStreamEvent {
                            request_id: request_id.to_string(),
                            stage: InterpretationStreamStage::Delta,
                            message: "正在接收模型输出".to_string(),
                            delta: Some(text.clone()),
                            answer: None,
                            answer_source: None,
                            evidence: Vec::new(),
                            trace: Vec::new(),
                        },
                    );
                }
                _ => {}
            },
            || llm::is_cancelled(&cancellation),
        )
        .await;

        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(CodexExecError::Cancelled) => return Err(CodexInterpretError::Cancelled),
            Err(CodexExecError::Empty) => return Err(CodexInterpretError::Empty),
            Err(err) => return Err(CodexInterpretError::Engine(err.to_string())),
        };

        let answer = outcome.final_message.trim().to_string();
        if answer.is_empty() {
            return Err(CodexInterpretError::Empty);
        }

        // Build authoritative evidence in Rust from the chunk_ids the agent
        // actually retrieved (coordinate truth always comes from our SQLite).
        let mut by_id: BTreeMap<String, EvidenceItem> = BTreeMap::new();
        for chunk_id in &tool_chunk_ids {
            if let Ok(Some(hit)) = storage::get_chunk(db_path, &request.book_id, chunk_id) {
                insert_hit(&mut by_id, hit);
            }
        }
        // If the agent cited chunk_ids in its answer that we didn't capture as
        // tool results, try to resolve those too so citations stay clickable.
        for chunk_id in chunk_ids_mentioned_in_answer(&answer) {
            if by_id.contains_key(&chunk_id) {
                continue;
            }
            if let Ok(Some(hit)) = storage::get_chunk(db_path, &request.book_id, &chunk_id) {
                insert_hit(&mut by_id, hit);
            }
        }

        let evidence = rank_evidence(by_id.into_values().collect(), request);
        let evidence: Vec<EvidenceItem> = evidence
            .into_iter()
            .take(MAX_SYNTHESIS_EVIDENCE_CHUNKS)
            .collect();

        // Re-ground citations in Rust: the engine's citations are not trusted.
        let answer = enforce_grounded_citations(&answer, request, &evidence);

        let trace = vec![AgentTraceStep {
            phase: AgentTracePhase::Synthesize,
            query: None,
            chunk_ids: evidence.iter().map(|item| item.chunk_id.clone()).collect(),
            note: "由 Codex deep_reader 检索与合成，引用已在后端重新校验。".to_string(),
        }];

        Ok(InterpretResponse {
            answer,
            answer_source: AnswerSource::Llm,
            evidence,
            trace,
        })
    }

    fn build_codex_prompt(request: &InterpretRequest) -> String {
        let mut parts = Vec::new();
        parts.push(format!(
            "用户框选的原文（不可漂移焦点）：\n{}",
            trim_for_prompt(&request.selection_text, 1500)
        ));
        if !request.page_indexes.is_empty() {
            let pages = request
                .page_indexes
                .iter()
                .map(|p| (p + 1).to_string())
                .collect::<Vec<_>>()
                .join(", ");
            parts.push(format!("选区所在页：{pages}"));
        }
        if let Some(question) = request.question.as_deref().filter(|q| !q.trim().is_empty()) {
            parts.push(format!("用户追问：{question}"));
        }
        if let Some(prior) = request
            .prior_answer
            .as_deref()
            .filter(|a| !a.trim().is_empty())
        {
            parts.push(format!(
                "上一轮回答（供延续，不要重复）：\n{}",
                trim_for_prompt(prior, 800)
            ));
        }
        parts.push(format!(
            "请用 book_search 等工具检索本书（bookId = \"{}\"）的证据，围绕框选原文作答；\
             每个关键判断后用 [chunk_id] 标注依据，证据不足要明确说明。",
            request.book_id
        ));
        parts.join("\n\n")
    }

    /// Extract chunkId values from a completed codex item. Tool outputs arrive
    /// as JSON-encoded strings nested inside the item, so string values are
    /// re-parsed and walked as well.
    fn extract_chunk_ids_deep(item: &serde_json::Value) -> Vec<String> {
        let mut ids = Vec::new();
        collect_chunk_ids_deep(item, &mut ids, 0);
        ids
    }

    fn collect_chunk_ids_deep(value: &serde_json::Value, out: &mut Vec<String>, depth: u8) {
        if depth > 6 {
            return;
        }
        match value {
            serde_json::Value::Object(map) => {
                if let Some(id) = map.get("chunkId").and_then(|v| v.as_str()) {
                    out.push(id.to_string());
                }
                for (_, v) in map {
                    collect_chunk_ids_deep(v, out, depth + 1);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    collect_chunk_ids_deep(item, out, depth + 1);
                }
            }
            serde_json::Value::String(text) => {
                let trimmed = text.trim();
                if (trimmed.starts_with('{') || trimmed.starts_with('['))
                    && trimmed.contains("chunkId")
                {
                    if let Ok(nested) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        collect_chunk_ids_deep(&nested, out, depth + 1);
                    }
                }
            }
            _ => {}
        }
    }

    /// Find namespaced chunk_ids the agent wrote into its answer as `[id]`.
    fn chunk_ids_mentioned_in_answer(answer: &str) -> Vec<String> {
        let mut ids = Vec::new();
        let bytes = answer.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'[' {
                if let Some(close) = answer[i + 1..].find(']') {
                    let inner = &answer[i + 1..i + 1 + close];
                    for candidate in inner.split([',', ';', '|', ' ']) {
                        let candidate = candidate.trim();
                        if crate::chunk_id::is_namespaced_chunk_id(candidate) {
                            ids.push(candidate.to_string());
                        }
                    }
                    i = i + 1 + close + 1;
                    continue;
                }
            }
            i += 1;
        }
        ids
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn extract_chunk_ids_from_plain_object_item() {
            let item = serde_json::json!({
                "type": "mcp_tool_call",
                "result": [
                    { "chunkId": "book::p1::c2", "text": "x" },
                    { "chunkId": "book::p1::c3" }
                ]
            });
            assert_eq!(
                extract_chunk_ids_deep(&item),
                vec!["book::p1::c2", "book::p1::c3"]
            );
        }

        #[test]
        fn extract_chunk_ids_from_json_encoded_string_output() {
            // MCP tool results come back as text content: JSON inside a string.
            let item = serde_json::json!({
                "type": "mcp_tool_call",
                "output": "[{\"chunkId\":\"book::p2::c1\",\"pageIndex\":1}]"
            });
            assert_eq!(extract_chunk_ids_deep(&item), vec!["book::p2::c1"]);
        }

        #[test]
        fn extract_chunk_ids_handles_garbage_gracefully() {
            assert!(extract_chunk_ids_deep(&serde_json::json!(null)).is_empty());
            assert!(extract_chunk_ids_deep(&serde_json::json!("not json")).is_empty());
            assert!(
                extract_chunk_ids_deep(&serde_json::json!({ "output": "plain text" })).is_empty()
            );
        }

        #[test]
        fn prompt_carries_selection_question_and_book_id() {
            let request = InterpretRequest {
                book_id: "book-9".to_string(),
                selection_text: "框选片段".to_string(),
                page_indexes: vec![2],
                selection_rects: Vec::new(),
                focus_chunk_ids: Vec::new(),
                question: Some("为什么？".to_string()),
                prior_answer: None,
                prior_evidence_chunk_ids: Vec::new(),
                follow_up_history: Vec::new(),
                lightweight: false,
                mode: InterpretMode::Deep,
            };
            let prompt = build_codex_prompt(&request);
            assert!(prompt.contains("框选片段"));
            assert!(prompt.contains("选区所在页：3"));
            assert!(prompt.contains("为什么？"));
            assert!(prompt.contains("book-9"));
        }
    }
