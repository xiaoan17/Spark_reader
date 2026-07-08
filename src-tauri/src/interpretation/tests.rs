    use super::*;
    use crate::coordinates::COORDINATE_VERSION;

    #[test]
    fn prompt_includes_focus_and_chunk_ids() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: Some("为什么强调长期？".to_string()),
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let evidence = vec![EvidenceItem {
            chunk_id: "p1-c1".to_string(),
            title: "Chunk p1-c1".to_string(),
            page_index: 0,
            text: "复利需要时间积累，短期收益并不关键。".to_string(),
            score: 0.0,
            rects: Vec::new(),
        }];

        let messages = build_messages(&request, &evidence, None);
        assert!(messages[0].content.contains("不可动摇的焦点"));
        assert!(messages[1].content.contains("复利来自长期坚持"));
        assert!(messages[1].content.contains("[p1-c1]"));
        assert!(messages[1].content.contains("为什么强调长期"));
    }

    #[test]
    fn prompt_includes_prior_answer_and_follow_up_history() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: Some("那它和风险控制有什么关系？".to_string()),
            prior_answer: Some("上一轮已经说明长期是复利成立的时间条件。[p1-c1]".to_string()),
            prior_evidence_chunk_ids: vec!["p1-c1".to_string()],
            follow_up_history: vec![FollowUpContext {
                question: "为什么强调长期？".to_string(),
                answer: "因为时间会放大差异。[p1-c1]".to_string(),
            }],
            lightweight: false,
            mode: InterpretMode::Plain,
        };
        let evidence = vec![EvidenceItem {
            chunk_id: "p1-c1".to_string(),
            title: "Chunk p1-c1".to_string(),
            page_index: 0,
            text: "复利需要时间积累，短期收益并不关键。".to_string(),
            score: 0.0,
            rects: Vec::new(),
        }];

        let messages = build_messages(
            &request,
            &evidence,
            Some("知识体系上下文：\n- 复利 [concept / candidate] evidence=[p1-c1]"),
        );
        assert!(messages[1].content.contains("上一轮解读摘要"));
        assert!(messages[1].content.contains("长期是复利成立的时间条件"));
        assert!(messages[1].content.contains("已有追问上下文"));
        assert!(messages[1].content.contains("为什么强调长期"));
        assert!(messages[1].content.contains("风险控制"));
        assert!(messages[1].content.contains("知识体系上下文"));
    }

    #[test]
    fn evidence_queries_include_focus_question_and_combined_query() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持，也需要风险控制。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: Some("为什么强调长期？".to_string()),
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };

        let queries = evidence_queries(&request);
        assert!(queries
            .iter()
            .any(|query| query == "复利来自长期坚持，也需要风险控制。"));
        assert!(queries.iter().any(|query| query == "为什么强调长期？"));
        assert!(queries
            .iter()
            .any(|query| query == "复利来自长期坚持，也需要风险控制。 为什么强调长期？"));
        assert!(queries.iter().any(|query| query.contains("长期 时间")));
        assert!(queries.iter().any(|query| query.contains("波动 控制")));
    }

    #[test]
    fn cjk_lexical_terms_add_topic_windows_without_domain_concepts() {
        let terms = lexical_terms("这段讨论社会制度演化与组织治理，而不是投资复利。");

        assert!(terms.iter().any(|term| term == "社会制度"));
        assert!(terms.iter().any(|term| term == "组织治理"));
        assert!(lexical_match_score("后文继续分析组织治理结构。", &terms) >= 4);
    }

    #[test]
    fn query_rewrite_expansions_cover_general_concepts() {
        let expansions = query_rewrite_expansions("组织治理依赖制度约束和数据反馈。");

        assert!(expansions.iter().any(|query| query.contains("组织 协作")));
        assert!(expansions.iter().any(|query| query.contains("制度 规则")));
        assert!(expansions.iter().any(|query| query.contains("数据 指标")));
    }

    #[test]
    fn parses_configurable_concept_pairs_from_env_format() {
        let pairs = parse_concept_pairs("氧化=电子 转移; 叙事 = 视角 结构 ;bad;空=");

        assert_eq!(
            pairs,
            vec![
                ("氧化".to_string(), "电子 转移".to_string()),
                ("叙事".to_string(), "视角 结构".to_string()),
            ]
        );
    }

    #[test]
    fn query_rewrite_expansions_can_use_custom_domain_concepts() {
        let pairs = vec![("叙事".to_string(), "视角 结构 节奏".to_string())];
        let expansions = query_rewrite_expansions_with_pairs("这一段讨论叙事声音。", &pairs);

        assert!(expansions
            .iter()
            .any(|query| query.contains("叙事 视角 结构 节奏")));
        assert!(!expansions.iter().any(|query| query.contains("长期 时间")));
    }

    #[test]
    fn trim_for_prompt_prefers_sentence_boundaries() {
        let text = "第一句用于铺垫。第二句包含关键判断。第三句很长很长很长很长很长很长很长。";
        let trimmed = trim_for_prompt(text, 24);

        assert_eq!(trimmed, "第一句用于铺垫。第二句包含关键判断。…");
    }

    #[test]
    fn tldr_prompt_avoids_leaky_genre_anchors() {
        let messages = build_tldr_messages("[p1-c1] page 1\n韩立进入七玄门。\n");
        let prompt = messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(!prompt.contains("论文"));
        assert!(!prompt.contains("文章/论文"));
        assert!(prompt.contains("读者可见的 TLDR 正文"));
        assert!(prompt.contains("不要人为压缩到固定字数"));
        assert!(prompt.contains("不要套用不符合材料类型的体裁标签"));
    }

    #[test]
    fn clean_tldr_text_preserves_long_cjk_output() {
        let text = format!(
            "{}{}",
            "这本书围绕长期复利展开，核心强调时间、纪律、现金流和风险控制共同决定结果。".repeat(4),
            "后面还有很多也应该保留的内容。".repeat(10)
        );
        let cleaned = clean_tldr_text(&text);

        assert_eq!(cleaned, text);
        assert!(cleaned.contains("也应该保留"));
    }

    #[test]
    fn clean_tldr_text_removes_outer_quotes_and_blank_lines() {
        let text = "\n\n“第一段。\n\n第二段继续展开。”\n\n";
        let cleaned = clean_tldr_text(text);

        assert_eq!(cleaned, "第一段。\n\n第二段继续展开。");
    }

    #[test]
    fn clean_tldr_text_keeps_paragraph_breaks_but_normalizes_soft_wraps() {
        let text = "第一段第一行。\n第一段第二行。\n\n\n第二段。";
        let cleaned = clean_tldr_text(text);

        assert_eq!(cleaned, "第一段第一行。 第一段第二行。\n\n第二段。");
    }

    #[test]
    fn retrieval_plan_adds_mode_specific_queries_without_losing_focus() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: Some("为什么强调长期？".to_string()),
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };

        let plan = build_retrieval_plan(&request);
        assert!(plan.note.contains("Plan"));
        assert!(plan
            .queries
            .iter()
            .any(|query| query.contains("复利来自长期坚持")));
        assert!(plan.queries.iter().any(|query| query.contains("定义")));
        assert!(plan.queries.iter().any(|query| query.contains("呼应")));
    }

    #[test]
    fn retrieval_tool_definitions_expose_required_book_tools() {
        let tools = retrieval_tool_definitions();
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
        let search = tools
            .iter()
            .find(|tool| tool.name == "search_book")
            .expect("search_book tool");
        assert_eq!(search.input_schema["required"][0], "query");
        assert_eq!(search.input_schema["properties"]["limit"]["maximum"], 12);
    }

    #[test]
    fn tool_planning_messages_pin_the_selected_text() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c1".to_string()],
            question: Some("为什么强调长期？".to_string()),
            prior_answer: Some("上一轮说明长期是时间条件。".to_string()),
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };

        let messages = build_tool_planning_messages(&request);
        assert!(messages[0].content.contains("检索规划器"));
        assert!(messages[1].content.contains("复利来自长期坚持"));
        assert!(messages[1].content.contains("为什么强调长期"));
        assert!(messages[1].content.contains("p1-c1"));
        assert!(messages[1].content.contains("上一轮说明"));
    }

    #[test]
    fn tool_loop_messages_feed_prior_tool_results_into_next_round() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c1".to_string()],
            question: Some("它和风险控制有什么关系？".to_string()),
            prior_answer: Some("上一轮说明长期是复利成立的时间条件。".to_string()),
            prior_evidence_chunk_ids: vec!["p1-c1".to_string()],
            follow_up_history: vec![FollowUpContext {
                question: "为什么强调长期？".to_string(),
                answer: "因为时间会放大差异。[p1-c1]".to_string(),
            }],
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let history = vec![ToolLoopRound {
            model_note: "先查框选段落附近的语境。".to_string(),
            tool_calls: vec![ToolCall {
                id: "call-1".to_string(),
                name: "search_book".to_string(),
                arguments: json!({"query": "复利 风险控制"}),
            }],
            executions: vec![ToolExecutionRecord {
                tool_call_id: "call-1".to_string(),
                chunk_ids: vec!["p1-c1".to_string(), "p2-c1".to_string()],
                result_prompt: "search_book {\"query\":\"复利 风险控制\"}\n结果：\n[p1-c1] page 1\n复利来自长期坚持。\n\n[p2-c1] page 2\n风险控制让长期计划不被打断。".to_string(),
            }],
        }];

        let messages = build_tool_loop_messages(&request, &history, 1);

        assert!(messages[0].content.contains("agentic RAG"));
        assert!(messages[1].content.contains("第 2 轮检索"));
        assert!(messages[1].content.contains("上一轮工具结果"));
        assert!(messages[1].content.contains("框选文本摘要"));
        assert!(messages[1].content.contains("复利来自长期坚持"));
        assert!(!messages[1].content.contains("上一轮说明长期"));
        assert!(!messages[1].content.contains("为什么强调长期"));
        assert_eq!(messages[2].tool_calls[0].id, "call-1");
        assert!(messages[2].content.contains("先查框选段落"));
        assert_eq!(messages[3].tool_call_id.as_deref(), Some("call-1"));
        assert!(messages[3].content.contains("chunks: [p1-c1, p2-c1]"));
        assert!(messages[3].content.contains("[p2-c1] page 2"));
    }

    #[test]
    fn tool_loop_messages_compact_old_tool_results_but_keep_latest_snippets() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c1".to_string()],
            question: Some("它和风险控制有什么关系？".to_string()),
            prior_answer: Some("上一轮说明长期是复利成立的时间条件。".to_string()),
            prior_evidence_chunk_ids: vec!["p1-c1".to_string()],
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let history = vec![
            ToolLoopRound {
                model_note: "先查框选段落附近的语境。".to_string(),
                tool_calls: vec![ToolCall {
                    id: "call-1".to_string(),
                    name: "search_book".to_string(),
                    arguments: json!({"query": "复利 长期"}),
                }],
                executions: vec![ToolExecutionRecord {
                    tool_call_id: "call-1".to_string(),
                    chunk_ids: vec!["p1-c1".to_string()],
                    result_prompt: "search_book {\"query\":\"复利 长期\"}\n结果：\n[p1-c1] page 1\n早期轮次的长正文不应在后续轮反复回灌。".to_string(),
                }],
            },
            ToolLoopRound {
                model_note: "再查风险控制。".to_string(),
                tool_calls: vec![ToolCall {
                    id: "call-2".to_string(),
                    name: "search_book".to_string(),
                    arguments: json!({"query": "风险控制"}),
                }],
                executions: vec![ToolExecutionRecord {
                    tool_call_id: "call-2".to_string(),
                    chunk_ids: vec!["p2-c1".to_string()],
                    result_prompt: "search_book {\"query\":\"风险控制\"}\n结果：\n[p2-c1] page 2\n最新轮次正文需要保留，供模型判断是否继续检索。".to_string(),
                }],
            },
        ];

        let messages = build_tool_loop_messages(&request, &history, 2);

        assert_eq!(messages[3].tool_call_id.as_deref(), Some("call-1"));
        assert!(messages[3].content.contains("chunks: [p1-c1]"));
        assert!(messages[3].content.contains("旧轮证据正文已压缩"));
        assert!(!messages[3].content.contains("早期轮次的长正文"));
        assert_eq!(messages[5].tool_call_id.as_deref(), Some("call-2"));
        assert!(messages[5].content.contains("chunks: [p2-c1]"));
        assert!(messages[5].content.contains("最新轮次正文需要保留"));
    }

    #[test]
    fn first_tool_loop_round_carries_full_query_context_once() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c1".to_string()],
            question: Some("它和风险控制有什么关系？".to_string()),
            prior_answer: Some("上一轮说明长期是复利成立的时间条件。".to_string()),
            prior_evidence_chunk_ids: vec!["p1-c1".to_string()],
            follow_up_history: vec![FollowUpContext {
                question: "为什么强调长期？".to_string(),
                answer: "因为时间会放大差异。[p1-c1]".to_string(),
            }],
            lightweight: false,
            mode: InterpretMode::Deep,
        };

        let messages = build_tool_loop_messages(&request, &[], 0);

        assert!(messages[1].content.contains("复利来自长期坚持"));
        assert!(messages[1].content.contains("它和风险控制有什么关系"));
        assert!(messages[1].content.contains("上一轮说明长期"));
        assert!(messages[1].content.contains("为什么强调长期"));
    }

    #[test]
    fn execute_tool_call_searches_fetches_neighbors_and_structure() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        let db_path = std::env::temp_dir().join(format!(
            "focused-reading-tool-call-exec-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);
        let saved = storage::save_book(
            &db_path,
            storage::SaveBookRequest {
                title: "工具执行测试".to_string(),
                total_pages: 2,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    storage::ParsedPageInput {
                        page_index: 0,
                        text: "复利来自长期坚持。现金流也重要。".to_string(),
                        markdown: "## Page 1\n\n复利来自长期坚持。现金流也重要。".to_string(),
                    },
                    storage::ParsedPageInput {
                        page_index: 1,
                        text: "风险控制让长期计划不被打断。".to_string(),
                        markdown: "## Page 2\n\n风险控制让长期计划不被打断。".to_string(),
                    },
                ],
                chunks: vec![
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "复利来自长期坚持。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n复利来自长期坚持。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c2".to_string(),
                        page_index: 0,
                        text: "现金流也重要。".to_string(),
                        markdown: "### [p1-c2] Page 1\n\n现金流也重要。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "风险控制让长期计划不被打断。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n风险控制让长期计划不被打断。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");
        let request = InterpretRequest {
            book_id: saved.book_id,
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c1".to_string()],
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };

        let search_hits = execute_retrieval_tool_call(
            &db_path,
            &request,
            &ToolCall {
                id: "call-1".to_string(),
                name: "search_book".to_string(),
                arguments: json!({"query": "复利", "limit": 99}),
            },
        )
        .expect("search_book should run");
        let p1_c1_hit = search_hits
            .iter()
            .find(|hit| hit.page_index == 0 && hit.text.contains("复利来自长期坚持"))
            .expect("legacy search hit should resolve to migrated chunk id");
        assert!(chunk_id::is_namespaced_chunk_id(&p1_c1_hit.chunk_id));

        let chunk_hits = execute_retrieval_tool_call(
            &db_path,
            &request,
            &ToolCall {
                id: "call-2".to_string(),
                name: "get_chunk".to_string(),
                arguments: json!({"chunk_id": "p1-c2"}),
            },
        )
        .expect("get_chunk should run");
        assert!(chunk_id::is_namespaced_chunk_id(&chunk_hits[0].chunk_id));
        assert!(chunk_hits[0].text.contains("现金流也重要"));

        let neighbor_hits = execute_retrieval_tool_call(
            &db_path,
            &request,
            &ToolCall {
                id: "call-3".to_string(),
                name: "get_neighbors".to_string(),
                arguments: json!({"chunk_id": "p1-c1", "radius": 99}),
            },
        )
        .expect("get_neighbors should run");
        assert!(neighbor_hits
            .iter()
            .any(|hit| hit.text.contains("现金流也重要")));

        let structure_hits = execute_retrieval_tool_call(
            &db_path,
            &request,
            &ToolCall {
                id: "call-4".to_string(),
                name: "list_structure".to_string(),
                arguments: json!({}),
            },
        )
        .expect("list_structure should run");
        assert!(!structure_hits.is_empty());

        knowledge::build_knowledge_graph(&db_path, &request.book_id)
            .expect("knowledge graph should build");
        let knowledge_context_hits = execute_retrieval_tool_call(
            &db_path,
            &request,
            &ToolCall {
                id: "call-6".to_string(),
                name: "get_knowledge_context".to_string(),
                arguments: json!({"query": "风险控制 长期", "limit": 4}),
            },
        )
        .expect("get_knowledge_context should run");
        assert!(knowledge_context_hits
            .iter()
            .any(|hit| hit.text.contains("风险控制") || hit.text.contains("复利")));

        let unknown_hits = execute_retrieval_tool_call(
            &db_path,
            &request,
            &ToolCall {
                id: "call-5".to_string(),
                name: "unknown".to_string(),
                arguments: json!({}),
            },
        )
        .expect("unknown tools should be ignored");
        assert!(unknown_hits.is_empty());

        let _ = std::fs::remove_file(&db_path);
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
    }

    #[test]
    fn rank_evidence_prioritizes_current_page_then_order() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "焦点".to_string(),
            page_indexes: vec![3],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let ranked = rank_evidence(
            vec![
                EvidenceItem {
                    chunk_id: "p2-c1".to_string(),
                    title: "Chunk p2-c1".to_string(),
                    page_index: 1,
                    text: "前文".to_string(),
                    score: 0.0,
                    rects: Vec::new(),
                },
                EvidenceItem {
                    chunk_id: "p4-c1".to_string(),
                    title: "Chunk p4-c1".to_string(),
                    page_index: 3,
                    text: "当前页".to_string(),
                    score: 0.0,
                    rects: Vec::new(),
                },
            ],
            &request,
        );

        assert_eq!(ranked[0].chunk_id, "p4-c1");
    }

    #[test]
    fn rank_evidence_keeps_frontend_focus_chunk_before_same_page_overlap() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "核心概念".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c3".to_string()],
            question: Some("为什么强调核心概念？".to_string()),
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let ranked = rank_evidence(
            vec![
                EvidenceItem {
                    chunk_id: "p1-c1".to_string(),
                    title: "Chunk p1-c1".to_string(),
                    page_index: 0,
                    text: "核心概念 核心概念 核心概念 为什么 强调".to_string(),
                    score: 0.0,
                    rects: Vec::new(),
                },
                EvidenceItem {
                    chunk_id: "p1-c3".to_string(),
                    title: "Chunk p1-c3".to_string(),
                    page_index: 0,
                    text: "用户真正框选的最后一段。".to_string(),
                    score: 0.0,
                    rects: Vec::new(),
                },
            ],
            &request,
        );

        assert_eq!(ranked[0].chunk_id, "p1-c3");
    }

    #[test]
    fn rank_evidence_uses_selection_rects_as_secondary_signal() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "核心概念".to_string(),
            page_indexes: vec![0],
            selection_rects: vec![storage::NormalizedRectInput {
                page_index: 0,
                x0: 0.60,
                y0: 0.60,
                x1: 0.90,
                y1: 0.70,
            }],
            focus_chunk_ids: Vec::new(),
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let ranked = rank_evidence(
            vec![
                EvidenceItem {
                    chunk_id: "p1-c1".to_string(),
                    title: "Chunk p1-c1".to_string(),
                    page_index: 0,
                    text: "核心概念".to_string(),
                    score: 0.0,
                    rects: vec![storage::NormalizedRectInput {
                        page_index: 0,
                        x0: 0.10,
                        y0: 0.10,
                        x1: 0.30,
                        y1: 0.20,
                    }],
                },
                EvidenceItem {
                    chunk_id: "p1-c2".to_string(),
                    title: "Chunk p1-c2".to_string(),
                    page_index: 0,
                    text: "核心概念".to_string(),
                    score: 0.0,
                    rects: vec![storage::NormalizedRectInput {
                        page_index: 0,
                        x0: 0.58,
                        y0: 0.58,
                        x1: 0.92,
                        y1: 0.72,
                    }],
                },
            ],
            &request,
        );

        assert_eq!(ranked[0].chunk_id, "p1-c2");
    }

    #[test]
    fn rank_evidence_uses_retrieval_score_when_primary_signals_tie() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "核心概念".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let ranked = rank_evidence(
            vec![
                EvidenceItem {
                    chunk_id: "p1-c1".to_string(),
                    title: "Chunk p1-c1".to_string(),
                    page_index: 0,
                    text: "核心概念".to_string(),
                    score: 0.01,
                    rects: Vec::new(),
                },
                EvidenceItem {
                    chunk_id: "p1-c2".to_string(),
                    title: "Chunk p1-c2".to_string(),
                    page_index: 0,
                    text: "核心概念".to_string(),
                    score: 0.05,
                    rects: Vec::new(),
                },
            ],
            &request,
        );

        assert_eq!(ranked[0].chunk_id, "p1-c2");
    }

    #[test]
    fn rank_evidence_lets_retrieval_score_outrank_lexical_overlap_after_geometry() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "核心概念".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let ranked = rank_evidence(
            vec![
                EvidenceItem {
                    chunk_id: "p1-c-lexical".to_string(),
                    title: "Chunk p1-c-lexical".to_string(),
                    page_index: 0,
                    text: "核心概念 核心概念 核心概念 核心概念".to_string(),
                    score: 0.01,
                    rects: Vec::new(),
                },
                EvidenceItem {
                    chunk_id: "p1-c-semantic".to_string(),
                    title: "Chunk p1-c-semantic".to_string(),
                    page_index: 0,
                    text: "这一段用不同措辞解释同一个含义。".to_string(),
                    score: 0.10,
                    rects: Vec::new(),
                },
            ],
            &request,
        );

        assert_eq!(ranked[0].chunk_id, "p1-c-semantic");
    }

    #[test]
    fn synthesis_evidence_budget_is_capped_for_prompt_size() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "焦点".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let evidence = (0..12)
            .map(|index| EvidenceItem {
                chunk_id: format!("p{}-c1", index + 1),
                title: format!("Chunk {}", index + 1),
                page_index: index,
                text: format!("证据 {index}"),
                score: 0.0,
                rects: Vec::new(),
            })
            .collect::<Vec<_>>();

        let capped = rank_evidence(evidence, &request)
            .into_iter()
            .take(MAX_SYNTHESIS_EVIDENCE_CHUNKS)
            .collect::<Vec<_>>();

        assert_eq!(MAX_SYNTHESIS_EVIDENCE_CHUNKS, 6);
        assert_eq!(capped.len(), 6);
    }

    #[test]
    fn deterministic_fallback_is_only_a_last_line_of_defense() {
        assert_eq!(
            deterministic_fallback_reason(Some(&ModelToolLoopStatus::Completed), false, 6),
            None,
        );
        assert_eq!(
            deterministic_fallback_reason(Some(&ModelToolLoopStatus::Completed), false, 2),
            Some(DeterministicFallbackReason::InsufficientEvidence),
        );
        assert_eq!(
            deterministic_fallback_reason(None, true, 6),
            Some(DeterministicFallbackReason::ToolLoopUnavailable),
        );
        assert_eq!(
            deterministic_fallback_reason(
                Some(&ModelToolLoopStatus::NoToolCalls {
                    note: "够了".to_string(),
                }),
                false,
                0,
            ),
            Some(DeterministicFallbackReason::NoToolCalls),
        );
        assert_eq!(
            deterministic_fallback_reason(
                Some(&ModelToolLoopStatus::NoToolCalls {
                    note: "已有证据".to_string(),
                }),
                false,
                4,
            ),
            None,
        );
        assert_eq!(
            deterministic_fallback_reason(
                Some(&ModelToolLoopStatus::NoNewEvidence {
                    note: "没有新 chunk".to_string(),
                }),
                false,
                6,
            ),
            Some(DeterministicFallbackReason::NoNewEvidence),
        );
    }

    #[test]
    fn no_new_evidence_only_stops_at_the_max_tool_round() {
        assert!(!should_stop_for_no_new_evidence(0, 3, 0));
        assert!(!should_stop_for_no_new_evidence(1, 3, 0));
        assert!(should_stop_for_no_new_evidence(2, 3, 0));
        assert!(!should_stop_for_no_new_evidence(2, 3, 1));
    }

    #[test]
    fn agentic_retrieval_collects_focus_search_neighbors_and_structure() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        let db_path = std::env::temp_dir().join(format!(
            "focused-reading-agentic-retrieval-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);
        let saved = storage::save_book(
            &db_path,
            storage::SaveBookRequest {
                title: "检索循环测试".to_string(),
                total_pages: 3,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    storage::ParsedPageInput {
                        page_index: 0,
                        text: "复利来自长期坚持。".to_string(),
                        markdown: "## Page 1\n\n复利来自长期坚持。".to_string(),
                    },
                    storage::ParsedPageInput {
                        page_index: 1,
                        text: "风险控制让长期计划不被短期波动打断。".to_string(),
                        markdown: "## Page 2\n\n风险控制让长期计划不被短期波动打断。".to_string(),
                    },
                    storage::ParsedPageInput {
                        page_index: 2,
                        text: "结论再次强调时间、现金流和耐心。".to_string(),
                        markdown: "## Page 3\n\n结论再次强调时间、现金流和耐心。".to_string(),
                    },
                ],
                chunks: vec![
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "复利来自长期坚持。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n复利来自长期坚持。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "风险控制让长期计划不被短期波动打断。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n风险控制让长期计划不被短期波动打断。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p3-c1".to_string(),
                        page_index: 2,
                        text: "结论再次强调时间、现金流和耐心。".to_string(),
                        markdown: "### [p3-c1] Page 3\n\n结论再次强调时间、现金流和耐心。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");

        let request = InterpretRequest {
            book_id: saved.book_id,
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: Some("为什么强调长期计划？".to_string()),
            prior_answer: Some("上一轮提到风险控制是长期计划的保护条件。".to_string()),
            prior_evidence_chunk_ids: vec!["p2-c1".to_string()],
            follow_up_history: vec![FollowUpContext {
                question: "这和风险有什么关系？".to_string(),
                answer: "风险控制让长期计划不被短期波动打断。[p2-c1]".to_string(),
            }],
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let (evidence, trace) =
            run_agentic_retrieval(&db_path, &request).expect("retrieval should run");

        let p1_c1 = evidence
            .iter()
            .find(|item| item.page_index == 0 && item.text.contains("复利来自长期坚持"))
            .map(|item| item.chunk_id.clone())
            .expect("page 1 evidence should be collected");
        let p2_c1 = evidence
            .iter()
            .find(|item| item.page_index == 1 && item.text.contains("风险控制"))
            .map(|item| item.chunk_id.clone())
            .expect("legacy prior evidence alias should resolve to page 2 chunk");
        assert!(chunk_id::is_namespaced_chunk_id(&p1_c1));
        assert!(chunk_id::is_namespaced_chunk_id(&p2_c1));
        assert!(trace.iter().any(|step| {
            step.phase == AgentTracePhase::Retrieve
                && step
                    .query
                    .as_deref()
                    .is_some_and(|query| query.contains("page_indexes"))
        }));
        assert!(trace.iter().any(|step| {
            step.phase == AgentTracePhase::Retrieve
                && step
                    .query
                    .as_deref()
                    .is_some_and(|query| query.contains("为什么强调长期计划"))
        }));
        assert!(trace.iter().any(|step| {
            step.phase == AgentTracePhase::Retrieve
                && step.query.as_deref() == Some("prior_evidence")
                && step.chunk_ids.iter().any(|chunk_id| chunk_id == &p2_c1)
        }));
        assert!(trace
            .iter()
            .any(|step| step.phase == AgentTracePhase::Iterate));
        assert!(trace
            .iter()
            .any(|step| step.phase == AgentTracePhase::Synthesize));

        let _ = std::fs::remove_file(&db_path);
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
    }

    #[test]
    fn agentic_retrieval_prioritizes_frontend_focus_chunk_ids() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        let db_path = std::env::temp_dir().join(format!(
            "focused-reading-focus-chunk-retrieval-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);
        let saved = storage::save_book(
            &db_path,
            storage::SaveBookRequest {
                title: "焦点 chunk 测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![storage::ParsedPageInput {
                    page_index: 0,
                    text: "第一页有很多段，用户选中的是最后一段。".to_string(),
                    markdown: "## Page 1\n\n第一页有很多段，用户选中的是最后一段。".to_string(),
                }],
                chunks: vec![
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "本页第一段只是导入。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n本页第一段只是导入。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c2".to_string(),
                        page_index: 0,
                        text: "本页第二段仍然不是焦点。".to_string(),
                        markdown: "### [p1-c2] Page 1\n\n本页第二段仍然不是焦点。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c3".to_string(),
                        page_index: 0,
                        text: "用户真正框选的最后一段包含核心概念。".to_string(),
                        markdown: "### [p1-c3] Page 1\n\n用户真正框选的最后一段包含核心概念。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");

        let request = InterpretRequest {
            book_id: saved.book_id,
            selection_text: "最后一段包含核心概念".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec!["p1-c3".to_string()],
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let (evidence, trace) =
            run_agentic_retrieval(&db_path, &request).expect("retrieval should run");

        assert!(chunk_id::is_namespaced_chunk_id(&evidence[0].chunk_id));
        assert!(evidence[0].text.contains("用户真正框选的最后一段"));
        assert!(trace.iter().any(|step| {
            step.phase == AgentTracePhase::Retrieve
                && step.query.as_deref() == Some("focus_chunk_ids")
                && step.chunk_ids == vec![evidence[0].chunk_id.clone()]
        }));

        let _ = std::fs::remove_file(&db_path);
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
    }

    #[test]
    fn grounded_citation_rewrite_drops_unknown_chunk_ids() {
        let chunk_a = "b12345678-p1-c1-abcdef12";
        let chunk_unknown = "b12345678-p9-c9-99999999";
        let allowed = BTreeSet::from([chunk_a]);
        let (rewritten, valid_count) = rewrite_chunk_citations(
            &format!("这句话有依据 [{chunk_a}]，但这个引用不存在 [{chunk_unknown}]，旧引用 [p1-c1] 会移除。"),
            &allowed,
        );

        assert_eq!(valid_count, 1);
        assert!(rewritten.contains(&format!("[{chunk_a}]")));
        assert!(!rewritten.contains(chunk_unknown));
        assert!(rewritten.contains("[p1-c1]"));
    }

    #[test]
    fn grounded_citation_rewrite_splits_multi_citation_brackets() {
        let chunk_a = "b12345678-p1-c1-abcdef12";
        let chunk_b = "b12345678-p2-c1-bbbbbbbb";
        let chunk_unknown = "b12345678-p9-c9-99999999";
        let allowed = BTreeSet::from([chunk_a, chunk_b]);
        let (rewritten, valid_count) = rewrite_chunk_citations(
            &format!(
                "同一个判断可能同时依赖 [{chunk_a}, {chunk_b}, {chunk_unknown}] 和【{chunk_b}】。"
            ),
            &allowed,
        );

        assert_eq!(valid_count, 3);
        assert!(rewritten.contains(&format!("[{chunk_a}][{chunk_b}]")));
        assert!(rewritten.contains(&format!("和[{chunk_b}]")));
        assert!(!rewritten.contains(chunk_unknown));
        assert!(!rewritten.contains("【"));
    }

    #[test]
    fn grounded_citation_rewrite_keeps_ordinary_bracketed_explanations() {
        let chunk_a = "b12345678-p1-c1-abcdef12";
        let allowed = BTreeSet::from([chunk_a]);
        let (rewritten, valid_count) = rewrite_chunk_citations(
            &format!("普通说明 [不是引用] 要保留，证据见 [{chunk_a}]。"),
            &allowed,
        );

        assert_eq!(valid_count, 1);
        assert!(rewritten.contains("[不是引用]"));
        assert!(rewritten.contains(&format!("[{chunk_a}]")));
    }

    #[test]
    fn enforce_grounded_citations_adds_footer_when_model_omits_citations() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        };
        let evidence = vec![EvidenceItem {
            chunk_id: "p1-c1".to_string(),
            title: "Chunk p1-c1".to_string(),
            page_index: 0,
            text: "复利需要时间积累。".to_string(),
            score: 0.0,
            rects: Vec::new(),
        }];

        let answer = enforce_grounded_citations("这是一个没有引用的回答。", &request, &evidence);
        assert!(answer.contains("这是一个没有引用的回答。"));
        assert!(answer.contains("[p1-c1]"));
    }

    #[test]
    fn fallback_answer_uses_real_evidence_chunk_ids() {
        let request = InterpretRequest {
            book_id: "book-1".to_string(),
            selection_text: "复利来自长期坚持。".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: Vec::new(),
            question: Some("为什么强调长期？".to_string()),
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Plain,
        };
        let evidence = vec![EvidenceItem {
            chunk_id: "p1-c1".to_string(),
            title: "Chunk p1-c1".to_string(),
            page_index: 0,
            text: "复利需要时间积累，短期收益并不关键。".to_string(),
            score: 0.0,
            rects: Vec::new(),
        }];

        let answer = fallback_grounded_answer(&request, &evidence, Some("missing key"));
        assert!(answer.contains("LLM 暂不可用"));
        assert!(answer.contains("本地书库检索证据"));
        assert!(!answer.contains("后端"));
        assert!(!answer.contains("missing key"));
        assert!(answer.contains("为什么强调长期"));
        assert!(answer.contains("[p1-c1]"));
        assert!(answer.contains("第 1 页"));
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn interpret_returns_grounded_fallback_when_llm_is_unconfigured() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let config_dir = std::env::temp_dir().join(format!(
            "focused-reading-interpret-config-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&config_dir);
        std::fs::create_dir_all(&config_dir).unwrap();
        std::env::set_var("FOCUSED_READING_CONFIG_DIR", &config_dir);
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        std::env::remove_var("DEEPSEEK_API_KEY");

        let db_path = std::env::temp_dir().join(format!(
            "focused-reading-interpret-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);
        let saved = storage::save_book(
            &db_path,
            storage::SaveBookRequest {
                title: "解读兜底测试".to_string(),
                total_pages: 2,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(storage::TextQuality {
                    char_count: 42,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    storage::ParsedPageInput {
                        page_index: 0,
                        text: "复利来自长期坚持，时间会放大微小差异。".to_string(),
                        markdown: "## Page 1\n\n复利来自长期坚持，时间会放大微小差异。".to_string(),
                    },
                    storage::ParsedPageInput {
                        page_index: 1,
                        text: "风险控制让长期计划不被短期波动打断。".to_string(),
                        markdown: "## Page 2\n\n风险控制让长期计划不被短期波动打断。".to_string(),
                    },
                ],
                chunks: vec![
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "复利来自长期坚持，时间会放大微小差异。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n复利来自长期坚持，时间会放大微小差异。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "风险控制让长期计划不被短期波动打断。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n风险控制让长期计划不被短期波动打断。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .unwrap();

        let response = interpret(
            &db_path,
            InterpretRequest {
                book_id: saved.book_id,
                selection_text: "复利来自长期坚持".to_string(),
                page_indexes: vec![0],
                selection_rects: Vec::new(),
                focus_chunk_ids: Vec::new(),
                question: Some("为什么强调长期？".to_string()),
                prior_answer: None,
                prior_evidence_chunk_ids: Vec::new(),
                follow_up_history: Vec::new(),
                lightweight: false,
                mode: InterpretMode::Deep,
            },
        )
        .await
        .unwrap();

        assert!(response.answer.contains("LLM 暂不可用"));
        let evidence_chunk_id = response
            .evidence
            .iter()
            .find(|item| item.page_index == 0 && item.text.contains("复利来自长期坚持"))
            .map(|item| item.chunk_id.clone())
            .expect("page 1 evidence should be present");
        assert!(chunk_id::is_namespaced_chunk_id(&evidence_chunk_id));
        assert!(response.answer.contains(&format!("[{evidence_chunk_id}]")));
        assert!(response
            .trace
            .iter()
            .any(|step| step.note.contains("后端改用已检索的书内证据")));
        assert!(response
            .evidence
            .iter()
            .any(|item| item.chunk_id == evidence_chunk_id));

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_dir_all(&config_dir);
        std::env::remove_var("FOCUSED_READING_CONFIG_DIR");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn backend_reading_chain_saves_searches_interprets_and_persists_history() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let config_dir =
            std::env::temp_dir().join(format!("focused-reading-e2e-config-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&config_dir);
        std::fs::create_dir_all(&config_dir).unwrap();
        std::env::set_var("FOCUSED_READING_CONFIG_DIR", &config_dir);
        std::env::set_var("FOCUSED_READING_ENV_PATH", config_dir.join(".env"));
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        std::env::remove_var("DEEPSEEK_API_KEY");

        let db_path = std::env::temp_dir().join(format!(
            "focused-reading-backend-chain-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);
        let saved = storage::save_book(
            &db_path,
            storage::SaveBookRequest {
                title: "后端链路测试".to_string(),
                total_pages: 3,
                parser_engine: "test-local".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(storage::TextQuality {
                    char_count: 96,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    storage::ParsedPageInput {
                        page_index: 0,
                        text: "复利来自长期坚持，时间会放大微小差异。".to_string(),
                        markdown: "## Page 1\n\n复利来自长期坚持，时间会放大微小差异。".to_string(),
                    },
                    storage::ParsedPageInput {
                        page_index: 1,
                        text: "风险控制让长期计划不被短期波动打断。".to_string(),
                        markdown: "## Page 2\n\n风险控制让长期计划不被短期波动打断。".to_string(),
                    },
                    storage::ParsedPageInput {
                        page_index: 2,
                        text: "现金流保证长期策略可以持续执行。".to_string(),
                        markdown: "## Page 3\n\n现金流保证长期策略可以持续执行。".to_string(),
                    },
                ],
                chunks: vec![
                    storage::ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "复利来自长期坚持，时间会放大微小差异。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n复利来自长期坚持，时间会放大微小差异。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "风险控制让长期计划不被短期波动打断。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n风险控制让长期计划不被短期波动打断。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    storage::ParsedChunkInput {
                        chunk_id: "p3-c1".to_string(),
                        page_index: 2,
                        text: "现金流保证长期策略可以持续执行。".to_string(),
                        markdown: "### [p3-c1] Page 3\n\n现金流保证长期策略可以持续执行。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("converted book should save and index");

        let search_hits = storage::hybrid_search_book(&db_path, &saved.book_id, "长期 风险", 6)
            .expect("search should run on converted text");
        let p1_c1 = search_hits
            .iter()
            .find(|hit| hit.page_index == 0 && hit.text.contains("复利来自长期坚持"))
            .map(|hit| hit.chunk_id.clone())
            .expect("page 1 search hit should be present");
        let p2_c1 = search_hits
            .iter()
            .find(|hit| hit.page_index == 1 && hit.text.contains("风险控制"))
            .map(|hit| hit.chunk_id.clone())
            .expect("page 2 search hit should be present");
        assert!(chunk_id::is_namespaced_chunk_id(&p1_c1));
        assert!(chunk_id::is_namespaced_chunk_id(&p2_c1));

        let response = interpret(
            &db_path,
            InterpretRequest {
                book_id: saved.book_id.clone(),
                selection_text: "复利来自长期坚持".to_string(),
                page_indexes: vec![0],
                selection_rects: Vec::new(),
                focus_chunk_ids: vec!["p1-c1".to_string()],
                question: Some("它和风险控制有什么关系？".to_string()),
                prior_answer: None,
                prior_evidence_chunk_ids: Vec::new(),
                follow_up_history: Vec::new(),
                lightweight: false,
                mode: InterpretMode::Deep,
            },
        )
        .await
        .expect("interpretation should complete with fallback when LLM is unconfigured");

        assert!(response.answer.contains(&format!("[{p1_c1}]")));
        assert!(response.evidence.iter().any(|item| item.chunk_id == p1_c1));
        assert!(response
            .trace
            .iter()
            .any(|step| step.phase == AgentTracePhase::Synthesize));

        let saved_interpretation = storage::save_interpretation(
            &db_path,
            storage::SaveInterpretationRequest {
                book_id: saved.book_id.clone(),
                selection_text: "复利来自长期坚持".to_string(),
                session_id: Some("backend-chain-session".to_string()),
                turn_index: Some(0),
                prefix: "".to_string(),
                suffix: "，时间会放大微小差异。".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(8),
                page_indexes: vec![0],
                evidence_chunk_ids: response
                    .evidence
                    .iter()
                    .map(|item| item.chunk_id.clone())
                    .collect(),
                question: Some("它和风险控制有什么关系？".to_string()),
                answer: response.answer.clone(),
                answer_source: response.answer_source.into(),
                kind: None,
                mode: None,
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("interpretation history should persist");
        let history = storage::list_interpretations(&db_path, &saved.book_id)
            .expect("interpretation history should list");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, saved_interpretation.id);
        assert_eq!(history[0].session_id, "backend-chain-session");
        assert_eq!(
            history[0].question.as_deref(),
            Some("它和风险控制有什么关系？")
        );
        assert!(history[0].answer.contains(&format!("[{p1_c1}]")));

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_dir_all(&config_dir);
        std::env::remove_var("FOCUSED_READING_CONFIG_DIR");
        std::env::remove_var("FOCUSED_READING_ENV_PATH");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
    }

    #[test]
    fn active_interpretation_registry_cancels_and_unregisters_requests() {
        let request_id = format!("cancel-test-{}", std::process::id());
        unregister_active_interpretation(&request_id);

        assert!(!cancel_interpretation(&request_id));
        let token = register_active_interpretation(&request_id);
        assert!(cancel_interpretation(&request_id));
        assert!(llm::is_cancelled(&token));

        unregister_active_interpretation(&request_id);
        assert!(!cancel_interpretation(&request_id));
    }
