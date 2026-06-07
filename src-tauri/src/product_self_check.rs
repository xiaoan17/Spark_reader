use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;

use crate::{
    coordinates::COORDINATE_VERSION,
    interpretation::{self, AgentTracePhase, FollowUpContext, InterpretMode, InterpretRequest},
    knowledge,
    storage::{self, SaveBookOptions},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSelfCheckResponse {
    pub ok: bool,
    pub run_id: String,
    pub checked_at: String,
    pub steps: Vec<ProductSelfCheckStep>,
    pub summary: ProductSelfCheckSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSelfCheckStep {
    pub id: &'static str,
    pub label: &'static str,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSelfCheckSummary {
    pub book_id: String,
    pub page_count: usize,
    pub chunk_count: usize,
    pub text_char_count: usize,
    pub markdown_char_count: usize,
    pub search_hit_count: usize,
    pub evidence_count: usize,
    pub citation_count: usize,
    pub highlight_count: usize,
    pub interpretation_count: usize,
    pub knowledge_card_count: usize,
    pub knowledge_evidence_count: usize,
    pub knowledge_edge_count: usize,
    pub knowledge_export_bytes: usize,
    pub temp_dir: String,
}

struct StepRecorder {
    steps: Vec<ProductSelfCheckStep>,
}

impl StepRecorder {
    fn new() -> Self {
        Self { steps: Vec::new() }
    }

    fn pass(&mut self, id: &'static str, label: &'static str, detail: impl Into<String>) {
        self.steps.push(ProductSelfCheckStep {
            id,
            label,
            ok: true,
            detail: detail.into(),
        });
    }

    fn into_steps(self) -> Vec<ProductSelfCheckStep> {
        self.steps
    }
}

#[cfg(test)]
pub async fn run_product_self_check(base_dir: Option<PathBuf>) -> Result<ProductSelfCheckResponse> {
    run_product_self_check_with_resource_dir(base_dir, None).await
}

pub async fn run_product_self_check_with_resource_dir(
    base_dir: Option<PathBuf>,
    _resource_dir: Option<PathBuf>,
) -> Result<ProductSelfCheckResponse> {
    let run_id = make_run_id();
    let temp_dir = base_dir
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("focused-reading-self-check-{run_id}"));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .with_context(|| format!("failed to reset {}", temp_dir.display()))?;
    }
    fs::create_dir_all(&temp_dir)
        .with_context(|| format!("failed to create {}", temp_dir.display()))?;

    let response =
        run_product_self_check_in_dir(&temp_dir, &run_id, _resource_dir.as_deref()).await;
    if response.is_ok() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    response
}

async fn run_product_self_check_in_dir(
    temp_dir: &Path,
    run_id: &str,
    _resource_dir: Option<&Path>,
) -> Result<ProductSelfCheckResponse> {
    let mut steps = StepRecorder::new();
    let pdf_path = temp_dir.join("self-check.pdf");
    write_minimal_text_pdf(&pdf_path, "Focused Reading unique sentinel risk cashflow")
        .with_context(|| format!("failed to write self-check PDF {}", pdf_path.display()))?;
    steps.pass(
        "fixture",
        "生成临时 PDF",
        "已生成本地验收 PDF，不读取真实书库文件",
    );

    let parsed = self_check_parsed_document();
    ensure(
        !parsed.pages.is_empty() && !parsed.chunks.is_empty() && parsed.text.contains("cashflow"),
        "自检转换稿没有产出可检索正文段落",
    )?;
    steps.pass(
        "convert",
        "Markdown 转换稿",
        format!(
            "{} 页、{} 段正文、{} 字",
            parsed.pages.len(),
            parsed.chunks.len(),
            parsed.quality.char_count
        ),
    );

    let db_path = temp_dir.join("library.sqlite3");
    let saved = storage::save_book_with_options(
        &db_path,
        storage::SaveBookRequest {
            title: "Focused Reading Product Self Check".to_string(),
            total_pages: parsed.pages.len() as u32,
            parser_engine: parsed.engine,
            coordinate_mode: parsed.coordinate_mode,
            quality: Some(parsed.quality),
            source_pdf_path: Some(pdf_path.to_string_lossy().to_string()),
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: parsed.pages,
            chunks: parsed.chunks,
        },
        SaveBookOptions {
            skip_embedding_rebuild: true,
        },
    )?;
    ensure(Path::new(&saved.text_path).exists(), "正文资产没有写入磁盘")?;
    ensure(
        Path::new(&saved.markdown_path).exists(),
        "Markdown 资产没有写入磁盘",
    )?;
    ensure(
        Path::new(&saved.original_pdf_path).exists(),
        "原 PDF 副本没有写入资产目录",
    )?;
    steps.pass(
        "persist",
        "保存本地文本资产",
        format!(
            "Markdown/PDF 资产已写入；book_id={}",
            compact_book_id(&saved.book_id)
        ),
    );

    let asset = storage::get_converted_book(&db_path, &saved.book_id)?;
    ensure(
        asset.text.contains("cashflow") && asset.markdown.contains("Page 1"),
        "无法读取 Markdown 转换稿内容",
    )?;
    steps.pass(
        "open_asset",
        "读取转换稿",
        format!(
            "{} 页、{} 段正文、解析引擎 {}",
            asset.pages.len(),
            asset.chunks.len(),
            asset.parser_engine
        ),
    );

    let index = storage::search_index_summary(&db_path, &saved.book_id)?;
    ensure(index.fts_ready, "FTS 文本索引未就绪")?;
    steps.pass(
        "index",
        "FTS 文本索引",
        format!(
            "{} chunks 已建索引；自检跳过 provider embedding",
            index.chunk_count
        ),
    );

    let hits = storage::search_book(&db_path, &saved.book_id, "cashflow risk", 6)?;
    ensure(!hits.is_empty(), "搜索没有命中导入后的文本 chunk")?;
    let focus_chunk_id = hits[0].chunk_id.clone();
    steps.pass(
        "search",
        "搜索转换文本",
        format!("命中 {} 条，首条 {}", hits.len(), focus_chunk_id),
    );

    let interpretation = interpretation::interpret_offline(
        &db_path,
        InterpretRequest {
            book_id: saved.book_id.clone(),
            selection_text: "unique sentinel risk".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec![focus_chunk_id.clone()],
            question: None,
            prior_answer: None,
            prior_evidence_chunk_ids: Vec::new(),
            follow_up_history: Vec::new(),
            lightweight: false,
            mode: InterpretMode::Deep,
        },
    )?;
    ensure(
        interpretation
            .evidence
            .iter()
            .any(|item| item.chunk_id == focus_chunk_id),
        "解读没有保留选区焦点 chunk",
    )?;
    ensure(
        interpretation
            .answer
            .contains(&format!("[{focus_chunk_id}]")),
        "解读回答没有生成可点击 chunk_id 引用",
    )?;
    ensure(
        interpretation
            .trace
            .iter()
            .any(|step| step.phase == AgentTracePhase::Synthesize),
        "解读链路缺少 synthesize 阶段",
    )?;
    steps.pass(
        "interpret",
        "深度解读与引用",
        format!(
            "{} 条证据，回答包含 [{}]",
            interpretation.evidence.len(),
            focus_chunk_id
        ),
    );

    let follow_up = interpretation::interpret_offline(
        &db_path,
        InterpretRequest {
            book_id: saved.book_id.clone(),
            selection_text: "unique sentinel risk".to_string(),
            page_indexes: vec![0],
            selection_rects: Vec::new(),
            focus_chunk_ids: vec![focus_chunk_id.clone()],
            question: Some("How does the follow-up keep the same anchor?".to_string()),
            prior_answer: Some(interpretation.answer.clone()),
            prior_evidence_chunk_ids: interpretation
                .evidence
                .iter()
                .map(|item| item.chunk_id.clone())
                .collect(),
            follow_up_history: vec![FollowUpContext {
                question: "What is the key claim?".to_string(),
                answer: interpretation.answer.clone(),
            }],
            lightweight: false,
            mode: InterpretMode::Deep,
        },
    )?;
    ensure(
        follow_up.answer.contains(&format!("[{focus_chunk_id}]")),
        "追问回答没有继承原始证据锚点",
    )?;
    steps.pass(
        "follow_up",
        "追问继承锚点",
        format!("追问回答继续引用 [{}]", focus_chunk_id),
    );

    let saved_initial = storage::save_interpretation(
        &db_path,
        storage::SaveInterpretationRequest {
            book_id: saved.book_id.clone(),
            selection_text: "unique sentinel risk".to_string(),
            session_id: Some("self-check-session".to_string()),
            turn_index: Some(0),
            prefix: "Focused Reading ".to_string(),
            suffix: " cashflow".to_string(),
            page_index: Some(0),
            position_start: Some(16),
            position_end: Some(36),
            page_indexes: vec![0],
            evidence_chunk_ids: interpretation
                .evidence
                .iter()
                .map(|item| item.chunk_id.clone())
                .collect(),
            question: None,
            answer: interpretation.answer.clone(),
            answer_source: interpretation.answer_source.into(),
            kind: None,
            evidence_chunk_snapshots: Vec::new(),
        },
    )?;
    let saved_follow_up = storage::save_interpretation(
        &db_path,
        storage::SaveInterpretationRequest {
            book_id: saved.book_id.clone(),
            selection_text: "unique sentinel risk".to_string(),
            session_id: Some(saved_initial.session_id.clone()),
            turn_index: Some(1),
            prefix: "Focused Reading ".to_string(),
            suffix: " cashflow".to_string(),
            page_index: Some(0),
            position_start: Some(16),
            position_end: Some(36),
            page_indexes: vec![0],
            evidence_chunk_ids: follow_up
                .evidence
                .iter()
                .map(|item| item.chunk_id.clone())
                .collect(),
            question: Some("How does the follow-up keep the same anchor?".to_string()),
            answer: follow_up.answer.clone(),
            answer_source: follow_up.answer_source.into(),
            kind: None,
            evidence_chunk_snapshots: Vec::new(),
        },
    )?;
    let history = storage::list_interpretations(&db_path, &saved.book_id)?;
    ensure(history.len() == 2, "解读/追问历史没有完整恢复")?;
    ensure(
        history
            .iter()
            .all(|item| item.session_id == saved_initial.session_id),
        "解读历史 session_id 不一致",
    )?;
    ensure(
        history.iter().any(|item| item.id == saved_follow_up.id),
        "追问历史未保存",
    )?;
    steps.pass(
        "history",
        "解读/追问历史",
        format!("已恢复 {} 条同 session 历史", history.len()),
    );

    let highlight = storage::save_highlight(
        &db_path,
        storage::SaveHighlightRequest {
            book_id: saved.book_id.clone(),
            selection_text: "unique sentinel risk".to_string(),
            prefix: "Focused Reading ".to_string(),
            suffix: " cashflow".to_string(),
            page_index: Some(0),
            position_start: Some(16),
            position_end: Some(36),
            rects: hits[0].rects.first().cloned().into_iter().collect(),
            coordinate_version: COORDINATE_VERSION,
            interpretation: Some(interpretation.answer.clone()),
            evidence_chunk_ids: vec![focus_chunk_id.clone()],
            evidence_chunk_snapshots: Vec::new(),
        },
    )?;
    let highlights = storage::list_highlights(&db_path, &saved.book_id)?;
    ensure(
        highlights.iter().any(|item| item.id == highlight.id),
        "高亮保存后无法恢复",
    )?;
    steps.pass(
        "highlight",
        "高亮保存/恢复",
        format!("已恢复 {} 条高亮", highlights.len()),
    );

    let knowledge_cards = knowledge::list_cards(&db_path, &saved.book_id)?;
    ensure(
        knowledge_cards.iter().any(|card| {
            card.card_type == "highlight"
                && card
                    .evidence
                    .iter()
                    .any(|item| item.chunk_id == focus_chunk_id)
        }),
        "高亮没有沉淀为带 evidence 的知识卡片",
    )?;
    ensure(
        knowledge_cards.iter().any(|card| {
            card.card_type == "interpretation"
                && card.body_markdown.contains("unique sentinel risk")
                && card
                    .evidence
                    .iter()
                    .any(|item| item.chunk_id == focus_chunk_id)
        }),
        "解读没有沉淀为带 evidence 的知识卡片",
    )?;
    let knowledge_evidence_count = knowledge_cards
        .iter()
        .map(|card| card.evidence.len())
        .sum::<usize>();
    steps.pass(
        "knowledge_cards",
        "知识卡片沉淀",
        format!(
            "{} 张卡片、{} 条 evidence",
            knowledge_cards.len(),
            knowledge_evidence_count
        ),
    );

    let graph_build = knowledge::build_knowledge_graph(&db_path, &saved.book_id)?;
    let graph = knowledge::get_knowledge_graph(&db_path, &saved.book_id)?;
    ensure(
        graph.nodes.iter().any(|node| {
            node.card_type == "concept" || node.card_type == "entity" || node.card_type == "event"
        }),
        "知识图谱没有生成候选节点",
    )?;
    steps.pass(
        "knowledge_graph",
        "知识图谱构建",
        format!(
            "{} 节点、{} 关系、{} 候选",
            graph.nodes.len(),
            graph.edges.len(),
            graph_build.candidate_count
        ),
    );

    let export = knowledge::export_book_knowledge_markdown(&db_path, &saved.book_id)?;
    ensure(
        export.markdown.contains("阅读知识册") && export.markdown.contains(&focus_chunk_id),
        "知识册导出没有包含标题或 evidence chunk",
    )?;
    let json_export = knowledge::export_book_knowledge_json(&db_path, &saved.book_id)?;
    ensure(!json_export.cards.is_empty(), "知识 JSON 导出没有包含卡片")?;
    steps.pass(
        "knowledge_export",
        "知识册导出",
        format!(
            "Markdown {} bytes，JSON {} cards",
            export.markdown.len(),
            json_export.cards.len()
        ),
    );

    let editable = knowledge_cards
        .iter()
        .find(|card| card.card_type == "highlight")
        .cloned()
        .ok_or_else(|| anyhow!("缺少可锁定的高亮知识卡片"))?;
    let conn = storage::open_database(&db_path)?;
    conn.execute(
        "UPDATE kb_cards
         SET title = 'Self-check locked title',
             summary = 'Self-check locked summary',
             body_markdown = 'Self-check locked body',
             user_locked = 1
         WHERE card_id = ?1",
        rusqlite::params![editable.card_id],
    )
    .context("failed to lock self-check knowledge card")?;
    knowledge::create_card_for_highlight(
        &conn,
        &storage::SavedHighlight {
            id: highlight.id.clone(),
            book_id: highlight.book_id.clone(),
            selection_text: "automatic rewrite should not overwrite".to_string(),
            prefix: highlight.prefix.clone(),
            suffix: highlight.suffix.clone(),
            page_index: highlight.page_index,
            position_start: highlight.position_start,
            position_end: highlight.position_end,
            rects: Vec::new(),
            coordinate_version: highlight.coordinate_version,
            interpretation: Some("automatic rewrite".to_string()),
            evidence_chunk_ids: vec![focus_chunk_id.clone()],
            evidence_chunk_snapshots: Vec::new(),
            created_at: highlight.created_at.clone(),
        },
        knowledge::HighlightKnowledgeInput {
            evidence_chunk_ids: &[focus_chunk_id.clone()],
            evidence_chunk_snapshots: &[],
        },
    )?;
    let locked_card = knowledge::get_card(&db_path, &saved.book_id, &editable.card_id)?
        .ok_or_else(|| anyhow!("locked knowledge card disappeared"))?;
    ensure(
        locked_card.title == "Self-check locked title"
            && locked_card.summary == "Self-check locked summary"
            && locked_card.body_markdown == "Self-check locked body",
        "用户锁定知识卡片被自动流程覆盖",
    )?;
    steps.pass(
        "knowledge_append_only",
        "知识 append-only",
        "用户锁定卡片没有被自动流程覆盖",
    );

    let reopened_cards = knowledge::list_cards(&db_path, &saved.book_id)?;
    ensure(
        reopened_cards
            .iter()
            .any(|card| card.card_id == locked_card.card_id),
        "重新打开 DB 后知识卡片没有恢复",
    )?;
    steps.pass(
        "knowledge_reopen",
        "知识重开恢复",
        format!("重开后恢复 {} 张知识卡片", reopened_cards.len()),
    );

    let citation_count = count_chunk_citations(&interpretation.answer, &focus_chunk_id)
        + count_chunk_citations(&follow_up.answer, &focus_chunk_id);
    let ok = steps.steps.iter().all(|step| step.ok);
    Ok(ProductSelfCheckResponse {
        ok,
        run_id: run_id.to_string(),
        checked_at: checked_at_seconds(),
        summary: ProductSelfCheckSummary {
            book_id: saved.book_id,
            page_count: saved.page_count,
            chunk_count: saved.chunk_count,
            text_char_count: saved.text_char_count,
            markdown_char_count: saved.markdown_char_count,
            search_hit_count: hits.len(),
            evidence_count: interpretation.evidence.len() + follow_up.evidence.len(),
            citation_count,
            highlight_count: highlights.len(),
            interpretation_count: history.len(),
            knowledge_card_count: reopened_cards.len(),
            knowledge_evidence_count,
            knowledge_edge_count: graph.edges.len(),
            knowledge_export_bytes: export.markdown.len(),
            temp_dir: temp_dir.to_string_lossy().to_string(),
        },
        steps: steps.into_steps(),
    })
}

fn ensure(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(anyhow!(message))
    }
}

fn make_run_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{}-{millis}", std::process::id())
}

fn checked_at_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn compact_book_id(book_id: &str) -> String {
    if book_id.chars().count() <= 18 {
        return book_id.to_string();
    }
    let prefix = book_id.chars().take(14).collect::<String>();
    format!("{prefix}...")
}

fn count_chunk_citations(answer: &str, chunk_id: &str) -> usize {
    answer.matches(&format!("[{chunk_id}]")).count()
}

fn write_minimal_text_pdf(path: &Path, text: &str) -> std::io::Result<()> {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)");
    let stream = format!("BT /F1 18 Tf 72 720 Td ({escaped}) Tj ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            stream.len(),
            stream
        ),
    ];
    let mut bytes = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0_usize];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref_offset = bytes.len();
    bytes.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    bytes.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    bytes.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_offset
        )
        .as_bytes(),
    );
    fs::write(path, bytes)
}

struct SelfCheckParsedDocument {
    engine: String,
    coordinate_mode: String,
    quality: storage::TextQuality,
    pages: Vec<storage::ParsedPageInput>,
    chunks: Vec<storage::ParsedChunkInput>,
    text: String,
}

fn self_check_parsed_document() -> SelfCheckParsedDocument {
    let text = "Focused Reading unique sentinel risk cashflow".to_string();
    let markdown = "## Page 1\n\nFocused Reading unique sentinel risk cashflow".to_string();
    SelfCheckParsedDocument {
        engine: "self-check-fixture".to_string(),
        coordinate_mode: "normalized-page-rects".to_string(),
        quality: storage::TextQuality {
            char_count: text.chars().count() as u32,
            replacement_char_ratio: 0.0,
            control_char_ratio: 0.0,
            looks_usable: true,
        },
        pages: vec![storage::ParsedPageInput {
            page_index: 0,
            text: text.clone(),
            markdown: markdown.clone(),
        }],
        chunks: vec![storage::ParsedChunkInput {
            chunk_id: "p1-c1".to_string(),
            page_index: 0,
            text: text.clone(),
            markdown: format!("### [p1-c1] Page 1\n\n{text}"),
            rects: vec![storage::NormalizedRectInput {
                page_index: 0,
                x0: 0.1,
                y0: 0.1,
                x1: 0.7,
                y1: 0.15,
            }],
            coordinate_version: COORDINATE_VERSION,
        }],
        text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn product_self_check_covers_core_reading_chain_without_provider_embeddings() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        std::env::remove_var("DEEPSEEK_API_KEY");
        let base_dir = std::env::temp_dir().join(format!(
            "focused-reading-product-self-check-base-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base_dir);
        fs::create_dir_all(&base_dir).expect("base dir");

        let result = run_product_self_check(Some(base_dir.clone()))
            .await
            .expect("self check should pass");

        assert!(result.ok);
        assert!(result.steps.iter().all(|step| step.ok));
        assert!(result.steps.iter().any(|step| step.id == "interpret"));
        assert!(result.summary.chunk_count >= 1);
        assert!(result.summary.search_hit_count >= 1);
        assert!(result.summary.citation_count >= 2);
        assert_eq!(result.summary.highlight_count, 1);
        assert_eq!(result.summary.interpretation_count, 2);

        let _ = fs::remove_dir_all(&base_dir);
        std::env::remove_var("EMBEDDING_PROVIDER");
    }
}
