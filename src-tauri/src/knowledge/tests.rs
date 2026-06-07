//! Tests for the knowledge module. Split out of knowledge/mod.rs (P10).
//! Declared via `#[cfg(test)] mod tests;` in mod.rs.

    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::storage::{
        AnswerSource, InterpretationKind, NormalizedRectInput, ParsedChunkInput, ParsedPageInput,
        SaveBookOptions, SaveBookRequest, SaveHighlightRequest, SaveInterpretationRequest,
        TextQuality,
    };

    fn temp_db(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!(
            "focused-reading-knowledge-{}-{}-{nonce}.sqlite3",
            name,
            std::process::id()
        ))
    }

    fn save_fixture_book(path: &Path) -> String {
        save_fixture_book_with_chunks(
            path,
            vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间、纪律和风险控制。".to_string(),
                markdown: "[p1-c1] 复利来自时间、纪律和风险控制。".to_string(),
                rects: Vec::new(),
                coordinate_version: 1,
            }],
        )
    }

    fn save_fixture_book_with_chunks(path: &Path, chunks: Vec<ParsedChunkInput>) -> String {
        let page_text = chunks
            .iter()
            .map(|chunk| chunk.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let page_markdown = chunks
            .iter()
            .map(|chunk| chunk.markdown.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let saved = storage::save_book_with_options(
            path,
            SaveBookRequest {
                title: "知识层测试书".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: page_text.chars().count() as u32,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: page_text,
                    markdown: page_markdown,
                }],
                chunks,
            },
            SaveBookOptions {
                skip_embedding_rebuild: true,
            },
        )
        .expect("fixture book should save");
        saved.book_id
    }

    fn first_chunk_id(path: &Path, book_id: &str) -> String {
        storage::list_structure(path, book_id)
            .expect("structure should list")
            .into_iter()
            .next()
            .expect("fixture should have a chunk")
            .chunk_id
    }

    #[test]
    fn saving_highlight_creates_knowledge_card_with_evidence() {
        let path = temp_db("highlight");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let highlight = storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                prefix: "".to_string(),
                suffix: "、纪律".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                rects: vec![NormalizedRectInput {
                    page_index: 0,
                    x0: 0.1,
                    y0: 0.1,
                    x1: 0.4,
                    y1: 0.2,
                }],
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");

        let cards = list_cards(&path, &book_id).expect("cards should list");
        let card = cards
            .iter()
            .find(|card| card.payload_json.contains(&highlight.id))
            .expect("highlight card should exist");
        assert_eq!(card.card_type, "highlight");
        assert_eq!(card.evidence.len(), 1);
        assert!(card.evidence[0].chunk_id.contains("-p1-c1-"));
    }

    #[test]
    fn saving_interpretation_creates_exportable_knowledge_card() {
        let path = temp_db("interpretation");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let saved = storage::save_interpretation(
            &path,
            SaveInterpretationRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                session_id: None,
                turn_index: None,
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                page_indexes: vec![0],
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                question: Some("这句话怎么理解？".to_string()),
                answer: "作者强调长期过程比单次收益更重要。[p1-c1]".to_string(),
                answer_source: AnswerSource::Llm,
                kind: Some(InterpretationKind::Interpretation),
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("interpretation should save");

        let cards = list_cards(&path, &book_id).expect("cards should list");
        let card = cards
            .iter()
            .find(|card| card.payload_json.contains(&saved.id))
            .expect("interpretation card should exist");
        assert_eq!(card.card_type, "interpretation");
        assert_eq!(card.evidence.len(), 1);

        let export = export_book_knowledge_markdown(&path, &book_id).expect("export should work");
        assert!(export.markdown.contains("阅读知识册"));
        assert!(export.markdown.contains(&card.evidence[0].chunk_id));
    }

    #[test]
    fn knowledge_upsert_does_not_overwrite_locked_card() {
        let path = temp_db("locked");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let highlight = storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                rects: Vec::new(),
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");
        let card_id = source_card_id("highlight", &highlight.id);
        let conn = storage::open_database(&path).expect("db should open");
        conn.execute(
            "UPDATE kb_cards
             SET title = '用户标题', summary = '用户摘要', body_markdown = '用户正文', user_locked = 1
             WHERE card_id = ?1",
            params![card_id],
        )
        .expect("card should lock");
        let evidence_before = list_cards(&path, &book_id)
            .expect("cards should list before")
            .into_iter()
            .find(|card| card.card_id == card_id)
            .expect("locked card should exist")
            .evidence;

        create_card_for_highlight(
            &conn,
            &SavedHighlight {
                selection_text: "自动流程的新文本".to_string(),
                interpretation: Some("自动流程的新解释".to_string()),
                ..highlight
            },
            HighlightKnowledgeInput {
                evidence_chunk_ids: &[String::from("p1-c1")],
                evidence_chunk_snapshots: &[],
            },
        )
        .expect("card should upsert");

        let cards = list_cards(&path, &book_id).expect("cards should list");
        let card = cards.iter().find(|card| card.card_id == card_id).unwrap();
        assert_eq!(card.title, "用户标题");
        assert_eq!(card.summary, "用户摘要");
        assert_eq!(card.body_markdown, "用户正文");
        assert_eq!(card.evidence.len(), evidence_before.len());
        assert!(card.user_locked);
    }

    #[test]
    fn knowledge_evidence_ignores_missing_chunks() {
        let path = temp_db("missing-evidence");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                rects: Vec::new(),
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["missing-chunk".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");

        let cards = list_cards(&path, &book_id).expect("cards should list");
        assert_eq!(cards.len(), 1);
        assert!(cards[0].evidence.is_empty());
    }

    #[test]
    fn build_graph_creates_candidate_cards_and_evidence_edges() {
        let path = temp_db("graph-build");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book_with_chunks(
            &path,
            vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间、纪律和风险控制。".to_string(),
                    markdown: "[p1-c1] 复利来自时间、纪律和风险控制。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: 1,
                },
                ParsedChunkInput {
                    chunk_id: "p1-c2".to_string(),
                    page_index: 0,
                    text: "风险控制支持复利，短期波动可能导致离场。".to_string(),
                    markdown: "[p1-c2] 风险控制支持复利，短期波动可能导致离场。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: 1,
                },
            ],
        );
        storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间、纪律和风险控制。".to_string(),
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(14),
                rects: Vec::new(),
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");
        storage::save_interpretation(
            &path,
            SaveInterpretationRequest {
                book_id: book_id.clone(),
                selection_text: "风险控制支持复利".to_string(),
                session_id: None,
                turn_index: None,
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(8),
                page_indexes: vec![0],
                evidence_chunk_ids: vec!["p1-c1".to_string(), "p1-c2".to_string()],
                question: Some("风险控制为什么重要？".to_string()),
                answer: "风险控制支持复利，并能降低短期波动导致离场的概率。[p1-c2]".to_string(),
                answer_source: AnswerSource::Llm,
                kind: Some(InterpretationKind::Interpretation),
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("interpretation should save");

        let build = build_knowledge_graph(&path, &book_id).expect("graph should build");
        assert!(build.candidate_count > 0);
        assert!(build.edge_count > 0);

        let graph = get_knowledge_graph(&path, &book_id).expect("graph should list");
        assert!(graph.nodes.iter().any(|node| {
            node.status == "candidate"
                && matches!(node.card_type.as_str(), "concept" | "entity" | "event")
                && node.title.contains("复利")
                && !node.evidence.is_empty()
        }));
        assert!(graph.edges.iter().any(|edge| edge.edge_type == "mentions"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.edge_type == "same_evidence"));
        assert!(graph
            .edges
            .iter()
            .all(|edge| !edge.evidence_chunk_ids.is_empty()));
    }

    #[test]
    fn build_graph_seeds_new_book_without_existing_notes() {
        let path = temp_db("graph-seed-book");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book_with_chunks(
            &path,
            vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "This paper explains suspicious overnight returns and regulator silence in financial markets.".to_string(),
                    markdown: "## Nothing to see here\n\nThis paper explains suspicious overnight returns and regulator silence in financial markets.".to_string(),
                    rects: Vec::new(),
                    coordinate_version: 1,
                },
                ParsedChunkInput {
                    chunk_id: "p2-c1".to_string(),
                    page_index: 1,
                    text: "The author describes how vague explanations and selective framing can dismiss evidence.".to_string(),
                    markdown: "## How to say it\n\nThe author describes how vague explanations and selective framing can dismiss evidence.".to_string(),
                    rects: Vec::new(),
                    coordinate_version: 1,
                },
            ],
        );

        let build = build_knowledge_graph(&path, &book_id).expect("graph should seed");
        assert!(build.card_count > 0);
        let graph = get_knowledge_graph(&path, &book_id).expect("graph should list");
        assert!(graph
            .nodes
            .iter()
            .any(|node| matches!(node.card_type.as_str(), "claim" | "concept" | "entity")));
        assert!(graph.nodes.iter().any(|node| !node.evidence.is_empty()));
    }

    #[test]
    fn build_graph_scans_the_whole_book_into_an_index() {
        let path = temp_db("graph-full-book");
        let _ = fs::remove_file(&path);
        let mut chunks = Vec::new();
        for index in 0..96 {
            let text = if index == 88 {
                "The appendix explains Market Manipulation Pattern and Regulatory Silence as a repeated evidence structure."
                    .to_string()
            } else {
                format!("Filler paragraph {index} describes ordinary background context without the target phrase.")
            };
            chunks.push(ParsedChunkInput {
                chunk_id: format!("p{}-c1", index + 1),
                page_index: index,
                text: text.clone(),
                markdown: if index == 88 {
                    "## Appendix Evidence\n\nThe appendix explains Market Manipulation Pattern and Regulatory Silence."
                        .to_string()
                } else {
                    text
                },
                rects: Vec::new(),
                coordinate_version: 1,
            });
        }
        let book_id = save_fixture_book_with_chunks(&path, chunks);

        let build = build_knowledge_graph(&path, &book_id).expect("graph should build");
        assert!(build.card_count > 0);

        let cards = list_cards(&path, &book_id).expect("cards should list");
        assert!(cards.iter().any(|card| {
            matches!(card.card_type.as_str(), "entity" | "concept")
                && card.title.contains("Market Manipulation Pattern")
                && card.evidence.iter().any(|item| item.page_index == Some(88))
        }));
        assert!(cards.iter().any(|card| card.card_type == "summary"));

        let graph = get_knowledge_graph(&path, &book_id).expect("graph should list");
        assert!(graph
            .edges
            .iter()
            .any(|edge| matches!(edge.edge_type.as_str(), "part_of" | "sequel")));
    }

    #[test]
    fn build_graph_is_idempotent() {
        let path = temp_db("graph-idempotent");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间、纪律和风险控制。".to_string(),
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(14),
                rects: Vec::new(),
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");

        build_knowledge_graph(&path, &book_id).expect("first build should work");
        let first = get_knowledge_graph(&path, &book_id).expect("first graph should list");
        build_knowledge_graph(&path, &book_id).expect("second build should work");
        let second = get_knowledge_graph(&path, &book_id).expect("second graph should list");

        let first_edges = first
            .edges
            .iter()
            .map(|edge| edge.edge_id.clone())
            .collect::<BTreeSet<_>>();
        let second_edges = second
            .edges
            .iter()
            .map(|edge| edge.edge_id.clone())
            .collect::<BTreeSet<_>>();
        assert_eq!(first_edges, second_edges);
        assert_eq!(first.edges.len(), second.edges.len());
    }

    #[test]
    fn graph_build_does_not_overwrite_locked_candidate() {
        let path = temp_db("graph-locked");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间、纪律和风险控制。".to_string(),
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(14),
                rects: Vec::new(),
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");
        build_knowledge_graph(&path, &book_id).expect("graph should build");
        let candidate = list_cards(&path, &book_id)
            .expect("cards should list")
            .into_iter()
            .find(|card| card.source == "auto" && card.title.contains("复利"))
            .expect("candidate should exist");
        let conn = storage::open_database(&path).expect("db should open");
        conn.execute(
            "UPDATE kb_cards
             SET title = '用户锁定候选', summary = '用户锁定摘要', body_markdown = '用户锁定正文', user_locked = 1
             WHERE card_id = ?1",
            params![candidate.card_id],
        )
        .expect("candidate should lock");

        build_knowledge_graph(&path, &book_id).expect("graph should rebuild");
        let card = list_cards(&path, &book_id)
            .expect("cards should list")
            .into_iter()
            .find(|card| card.card_id == candidate.card_id)
            .expect("locked candidate should remain");
        assert_eq!(card.title, "用户锁定候选");
        assert_eq!(card.summary, "用户锁定摘要");
        assert_eq!(card.body_markdown, "用户锁定正文");
        assert!(card.user_locked);
    }

    #[test]
    fn user_card_crud_status_chunk_lookup_health_and_json_export_work() {
        let path = temp_db("crud");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let chunk_id = first_chunk_id(&path, &book_id);

        let card = upsert_user_card(
            &path,
            UpsertKnowledgeCardRequest {
                card_id: None,
                book_id: book_id.clone(),
                card_type: "note".to_string(),
                title: "复利笔记".to_string(),
                summary: "用户整理的复利摘要".to_string(),
                body_markdown: "复利依赖时间和纪律。".to_string(),
                payload_json: None,
                status: "candidate".to_string(),
                evidence_chunk_ids: vec![chunk_id],
            },
        )
        .expect("user card should upsert");

        assert_eq!(card.card_type, "note");
        assert!(card.user_locked);
        assert_eq!(card.evidence.len(), 1);

        let by_chunk = list_cards_by_chunk(&path, &book_id, &card.evidence[0].chunk_id)
            .expect("cards by chunk should list");
        assert!(by_chunk.iter().any(|item| item.card_id == card.card_id));

        let confirmed = confirm_card(&path, &book_id, &card.card_id).expect("card should confirm");
        assert_eq!(confirmed.status, "confirmed");

        let health = knowledge_health(&path, &book_id).expect("health should compute");
        assert!(health.card_count >= 1);
        assert!(health.confirmed_count >= 1);

        let export = export_book_knowledge_json(&path, &book_id).expect("json export should work");
        assert!(export.cards.iter().any(|item| item.card_id == card.card_id));

        reject_card(&path, &book_id, &card.card_id).expect("card should reject");
        let listed = list_cards(&path, &book_id).expect("cards should list");
        assert!(!listed.iter().any(|item| item.card_id == card.card_id));
    }

    #[test]
    fn knowledge_search_is_scoped_to_book_and_returns_evidence_chunks() {
        let path = temp_db("search");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let chunk_id = first_chunk_id(&path, &book_id);
        let other_book_id = save_fixture_book_with_chunks(
            &path,
            vec![ParsedChunkInput {
                chunk_id: "other-c1".to_string(),
                page_index: 0,
                text: "另一本书也讨论复利。".to_string(),
                markdown: "[other-c1] 另一本书也讨论复利。".to_string(),
                rects: Vec::new(),
                coordinate_version: 1,
            }],
        );
        let other_chunk_id = first_chunk_id(&path, &other_book_id);
        upsert_user_card(
            &path,
            UpsertKnowledgeCardRequest {
                card_id: None,
                book_id: book_id.clone(),
                card_type: "concept".to_string(),
                title: "复利".to_string(),
                summary: "复利来自时间、纪律和风险控制。".to_string(),
                body_markdown: "这是当前书的知识卡片。".to_string(),
                payload_json: None,
                status: "confirmed".to_string(),
                evidence_chunk_ids: vec![chunk_id.clone()],
            },
        )
        .expect("current book card should upsert");
        upsert_user_card(
            &path,
            UpsertKnowledgeCardRequest {
                card_id: None,
                book_id: other_book_id.clone(),
                card_type: "concept".to_string(),
                title: "复利".to_string(),
                summary: "另一本书的复利知识。".to_string(),
                body_markdown: "不应该跨书命中。".to_string(),
                payload_json: None,
                status: "confirmed".to_string(),
                evidence_chunk_ids: vec![other_chunk_id.clone()],
            },
        )
        .expect("other book card should upsert");

        let hits = search_knowledge_hits(&path, &book_id, "复利", 8)
            .expect("knowledge search hits should work");
        assert!(!hits.is_empty());
        assert!(hits
            .iter()
            .all(|hit| hit.text.contains("复利") || hit.text.contains("时间")));
        assert!(hits.iter().all(|hit| hit.chunk_id == chunk_id));
        assert!(!hits.iter().any(|hit| hit.chunk_id == other_chunk_id));
    }

    #[test]
    fn knowledge_drift_detects_changed_chunk_content_hash() {
        let path = temp_db("drift");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let saved = storage::save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                prefix: "".to_string(),
                suffix: "".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                rects: Vec::new(),
                coordinate_version: 1,
                interpretation: None,
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                evidence_chunk_snapshots: Vec::new(),
            },
        )
        .expect("highlight should save");
        let card_id = source_card_id("highlight", &saved.id);
        let card = get_card(&path, &book_id, &card_id)
            .expect("card should load")
            .expect("card should exist");
        assert_eq!(card.drift_count, 0);

        let conn = storage::open_database(&path).expect("db should open");
        conn.execute(
            "UPDATE chunks SET text = '复利被重解析后的不同文本。' WHERE book_id = ?1",
            params![book_id],
        )
        .expect("chunk should mutate");

        let drift = list_drift(&path, &book_id).expect("drift should list");
        assert!(!drift.is_empty());
        assert!(drift.iter().any(|item| item.card_id == card_id));
    }

    #[tokio::test]
    async fn lazy_summary_respects_user_lock_even_on_force() {
        // A user-locked card must never be overwritten by lazy completion,
        // even with force = true. This path returns before any LLM call, so
        // the test is fully deterministic (no network).
        let path = temp_db("lazy-lock");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let chunk_id = first_chunk_id(&path, &book_id);

        let card = upsert_user_card(
            &path,
            UpsertKnowledgeCardRequest {
                card_id: None,
                book_id: book_id.clone(),
                card_type: "note".to_string(),
                title: "用户笔记".to_string(),
                summary: "用户亲手写的摘要".to_string(),
                body_markdown: "用户正文".to_string(),
                payload_json: None,
                status: "candidate".to_string(),
                evidence_chunk_ids: vec![chunk_id],
            },
        )
        .expect("user card should upsert");
        assert!(card.user_locked);

        let result = get_or_generate_card_summary(&path, &book_id, &card.card_id, true)
            .await
            .expect("locked card should return without error");
        assert_eq!(result.summary, "用户亲手写的摘要");
        assert!(result.user_locked);
    }

    #[tokio::test]
    async fn lazy_summary_returns_cached_field_without_llm() {
        // A non-locked card whose summary is already populated at the current
        // source version is a cache hit: it returns as-is without an LLM call.
        let path = temp_db("lazy-cache");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);

        let card_id = "auto-cache-card";
        let conn = storage::open_database(&path).expect("db should open");
        conn.execute(
            "INSERT INTO kb_cards(
                card_id, book_id, card_type, title, summary, body_markdown,
                payload_json, status, source, confidence, source_version,
                user_locked, created_at, updated_at
             ) VALUES (?1, ?2, 'concept', '复利', '已缓存的一句话摘要', '正文',
                '{}', 'candidate', 'auto', 0.6, ?3, 0, datetime('now'), datetime('now'))",
            params![card_id, book_id, KB_SOURCE_VERSION],
        )
        .expect("seed auto card");

        let result = get_or_generate_card_summary(&path, &book_id, card_id, false)
            .await
            .expect("cache hit should return without error");
        assert_eq!(result.summary, "已缓存的一句话摘要");
        assert!(!result.user_locked);
    }

    #[tokio::test]
    async fn lazy_highlight_note_respects_user_lock_even_on_force() {
        let path = temp_db("lazy-note-lock");
        let _ = fs::remove_file(&path);
        let book_id = save_fixture_book(&path);
        let chunk_id = first_chunk_id(&path, &book_id);

        let card = upsert_user_card(
            &path,
            UpsertKnowledgeCardRequest {
                card_id: None,
                book_id: book_id.clone(),
                card_type: "highlight".to_string(),
                title: "高亮".to_string(),
                summary: "摘要".to_string(),
                body_markdown: "用户写的笔记正文".to_string(),
                payload_json: None,
                status: "candidate".to_string(),
                evidence_chunk_ids: vec![chunk_id],
            },
        )
        .expect("user card should upsert");

        let result = get_or_generate_highlight_note(&path, &book_id, &card.card_id, true)
            .await
            .expect("locked card should return without error");
        assert_eq!(result.body_markdown, "用户写的笔记正文");
        assert!(result.user_locked);
    }
