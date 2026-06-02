use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    path::Path,
    sync::{Mutex, OnceLock},
};

use anyhow::Result;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    chunk_id,
    llm::{self, CancellationToken, ChatMessage, ChatRequest, ToolCall, ToolDefinition},
    storage,
};

static ACTIVE_INTERPRETATIONS: OnceLock<Mutex<BTreeMap<String, CancellationToken>>> =
    OnceLock::new();

const MAX_SYNTHESIS_EVIDENCE_CHUNKS: usize = 6;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretRequest {
    pub book_id: String,
    pub selection_text: String,
    pub page_indexes: Vec<u32>,
    #[serde(default)]
    pub selection_rects: Vec<storage::NormalizedRectInput>,
    #[serde(default)]
    pub focus_chunk_ids: Vec<String>,
    pub question: Option<String>,
    #[serde(default)]
    pub prior_answer: Option<String>,
    #[serde(default)]
    pub prior_evidence_chunk_ids: Vec<String>,
    #[serde(default)]
    pub follow_up_history: Vec<FollowUpContext>,
    #[serde(default)]
    pub lightweight: bool,
    pub mode: InterpretMode,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpContext {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum InterpretMode {
    Deep,
    Plain,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretResponse {
    pub answer: String,
    pub answer_source: AnswerSource,
    pub evidence: Vec<EvidenceItem>,
    pub trace: Vec<AgentTraceStep>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnswerSource {
    Llm,
    LocalFallback,
}

impl From<AnswerSource> for storage::AnswerSource {
    fn from(value: AnswerSource) -> Self {
        match value {
            AnswerSource::Llm => storage::AnswerSource::Llm,
            AnswerSource::LocalFallback => storage::AnswerSource::LocalFallback,
        }
    }
}

pub const INTERPRETATION_STREAM_EVENT: &str = "interpretation://stream";
const TLDR_STRUCTURE_CHAR_BUDGET: usize = 8_000;
const TLDR_MAX_TOKENS: u32 = 1_600;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceItem {
    pub chunk_id: String,
    pub title: String,
    pub page_index: u32,
    pub text: String,
    #[serde(skip_serializing)]
    pub score: f64,
    #[serde(skip_serializing)]
    pub rects: Vec<storage::NormalizedRectInput>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceStep {
    pub phase: AgentTracePhase,
    pub query: Option<String>,
    pub chunk_ids: Vec<String>,
    pub note: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InterpretationStreamEvent {
    pub request_id: String,
    pub stage: InterpretationStreamStage,
    pub message: String,
    pub delta: Option<String>,
    pub answer: Option<String>,
    pub answer_source: Option<AnswerSource>,
    pub evidence: Vec<EvidenceItem>,
    pub trace: Vec<AgentTraceStep>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterpretationStreamStage {
    Planning,
    Retrieving,
    Synthesizing,
    Delta,
    Done,
    Cancelled,
    Failed,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentTracePhase {
    Plan,
    Retrieve,
    Iterate,
    Synthesize,
}

pub async fn generate_document_tldr(
    db_path: &Path,
    book_id: &str,
) -> Result<String, llm::LlmError> {
    let structure =
        storage::list_structure(db_path, book_id).map_err(|err| llm::LlmError::Provider {
            status: 500,
            body: format!("failed to read document structure: {err:#}"),
        })?;
    let prompt_context = tldr_structure_context(&structure);
    let messages = vec![
        ChatMessage::system(
            "你是一位精读助手。只输出 TLDR 正文本身，不要标题、不要列表、不要“本文/这篇文章”以外的客套。信息完整优先，不要人为压缩到固定字数。",
        ),
        ChatMessage::user(format!(
            "请写一段帮助读者快速了解这篇文章/论文的 TLDR：它在讲什么核心问题、给出的关键结论或主张、为什么值得读。根据内容自然展开，写完整，不要截断。\n\n文档结构与代表片段：\n{}",
            prompt_context
        )),
    ];
    let output = llm::chat(messages, TLDR_MAX_TOKENS).await?;
    Ok(clean_tldr_text(&output))
}

fn tldr_structure_context(structure: &[storage::SearchHit]) -> String {
    let mut output = String::new();
    for hit in representative_tldr_hits(structure) {
        let text = trim_for_prompt(&hit.text, 700);
        if text.trim().is_empty() {
            continue;
        }
        let row = format!(
            "[{}] page {}\n{}\n\n",
            hit.chunk_id,
            hit.page_index + 1,
            text.trim()
        );
        if output.chars().count() + row.chars().count() > TLDR_STRUCTURE_CHAR_BUDGET {
            break;
        }
        output.push_str(&row);
    }
    if output.trim().is_empty() {
        "没有可用的文档结构片段。".to_string()
    } else {
        output
    }
}

fn representative_tldr_hits(structure: &[storage::SearchHit]) -> Vec<&storage::SearchHit> {
    if structure.len() <= 24 {
        return structure.iter().collect();
    }
    let mut selected = Vec::new();
    selected.extend(structure.iter().take(12));
    let middle_start = structure.len().saturating_div(2).saturating_sub(3);
    selected.extend(structure.iter().skip(middle_start).take(6));
    selected.extend(structure.iter().rev().take(8));
    selected.sort_by(|left, right| {
        left.page_index
            .cmp(&right.page_index)
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    selected.dedup_by(|left, right| left.chunk_id == right.chunk_id);
    selected
}

fn clean_tldr_text(text: &str) -> String {
    text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch: char| ch == '"' || ch == '“' || ch == '”')
        .trim()
        .to_string()
}

pub async fn interpret(
    db_path: &std::path::Path,
    request: InterpretRequest,
) -> Result<InterpretResponse> {
    let (evidence, mut trace) = run_retrieval_for_request(db_path, &request).await?;
    let messages = build_messages(&request, &evidence);
    let (answer, answer_source) = match llm::chat(messages, 1400).await {
        Ok(answer) => (
            enforce_grounded_citations(&answer, &request, &evidence),
            AnswerSource::Llm,
        ),
        Err(error) => {
            trace.push(AgentTraceStep {
                phase: AgentTracePhase::Synthesize,
                query: None,
                chunk_ids: evidence.iter().map(|item| item.chunk_id.clone()).collect(),
                note: format!(
                    "LLM 调用不可用，后端改用已检索的书内证据生成可引用兜底回答：{}",
                    error
                ),
            });
            (
                fallback_grounded_answer(&request, &evidence, Some(&error.to_string())),
                AnswerSource::LocalFallback,
            )
        }
    };

    Ok(InterpretResponse {
        answer,
        answer_source,
        evidence,
        trace,
    })
}

pub fn interpret_offline(
    db_path: &std::path::Path,
    request: InterpretRequest,
) -> Result<InterpretResponse> {
    let (evidence, mut trace) = run_agentic_retrieval(db_path, &request)?;
    trace.push(AgentTraceStep {
        phase: AgentTracePhase::Synthesize,
        query: None,
        chunk_ids: evidence.iter().map(|item| item.chunk_id.clone()).collect(),
        note: "离线自检模式：不调用外部 LLM，直接用本地检索证据生成可点击引用回答。".to_string(),
    });
    let answer = fallback_grounded_answer(&request, &evidence, Some("offline self-check"));

    Ok(InterpretResponse {
        answer,
        answer_source: AnswerSource::LocalFallback,
        evidence,
        trace,
    })
}

pub async fn interpret_with_progress(
    app: AppHandle,
    request_id: String,
    db_path: &std::path::Path,
    request: InterpretRequest,
) -> Result<InterpretResponse> {
    let cancellation = register_active_interpretation(&request_id);
    let _guard = ActiveInterpretationGuard::new(request_id.clone());
    emit_stream_event(
        &app,
        InterpretationStreamEvent {
            request_id: request_id.clone(),
            stage: InterpretationStreamStage::Planning,
            message: "正在规划检索问题".to_string(),
            delta: None,
            answer: None,
            answer_source: None,
            evidence: Vec::new(),
            trace: Vec::new(),
        },
    );
    let (evidence, mut trace) = match run_retrieval_for_request(db_path, &request).await {
        Ok(result) => result,
        Err(error) => {
            emit_stream_event(
                &app,
                InterpretationStreamEvent {
                    request_id: request_id.clone(),
                    stage: InterpretationStreamStage::Failed,
                    message: error.to_string(),
                    delta: None,
                    answer: None,
                    answer_source: None,
                    evidence: Vec::new(),
                    trace: Vec::new(),
                },
            );
            return Err(error);
        }
    };
    emit_stream_event(
        &app,
        InterpretationStreamEvent {
            request_id: request_id.clone(),
            stage: InterpretationStreamStage::Retrieving,
            message: format!("已找到 {} 条书内证据", evidence.len()),
            delta: None,
            answer: None,
            answer_source: None,
            evidence: evidence.clone(),
            trace: trace.clone(),
        },
    );

    let messages = build_messages(&request, &evidence);
    emit_stream_event(
        &app,
        InterpretationStreamEvent {
            request_id: request_id.clone(),
            stage: InterpretationStreamStage::Synthesizing,
            message: "正在生成解读".to_string(),
            delta: None,
            answer: None,
            answer_source: None,
            evidence: evidence.clone(),
            trace: trace.clone(),
        },
    );

    let (answer, answer_source) =
        match llm::chat_stream_with_cancellation(messages, 1400, Some(cancellation), {
            let app = app.clone();
            let request_id = request_id.clone();
            let evidence = evidence.clone();
            let trace = trace.clone();
            move |delta| {
                emit_stream_event(
                    &app,
                    InterpretationStreamEvent {
                        request_id: request_id.clone(),
                        stage: InterpretationStreamStage::Delta,
                        message: "正在接收模型输出".to_string(),
                        delta: Some(delta.to_string()),
                        answer: None,
                        answer_source: None,
                        evidence: evidence.clone(),
                        trace: trace.clone(),
                    },
                );
            }
        })
        .await
        {
            Ok(answer) => (
                enforce_grounded_citations(&answer, &request, &evidence),
                AnswerSource::Llm,
            ),
            Err(llm::LlmError::Cancelled) => {
                emit_stream_event(
                    &app,
                    InterpretationStreamEvent {
                        request_id: request_id.clone(),
                        stage: InterpretationStreamStage::Cancelled,
                        message: "已停止生成".to_string(),
                        delta: None,
                        answer: None,
                        answer_source: None,
                        evidence,
                        trace,
                    },
                );
                return Err(llm::LlmError::Cancelled.into());
            }
            Err(error) => {
                trace.push(AgentTraceStep {
                    phase: AgentTracePhase::Synthesize,
                    query: None,
                    chunk_ids: evidence.iter().map(|item| item.chunk_id.clone()).collect(),
                    note: format!(
                        "LLM 调用不可用，后端改用已检索的书内证据生成可引用兜底回答：{}",
                        error
                    ),
                });
                (
                    fallback_grounded_answer(&request, &evidence, Some(&error.to_string())),
                    AnswerSource::LocalFallback,
                )
            }
        };

    let response = InterpretResponse {
        answer,
        answer_source,
        evidence,
        trace,
    };
    emit_stream_event(
        &app,
        InterpretationStreamEvent {
            request_id: request_id.clone(),
            stage: InterpretationStreamStage::Done,
            message: "解读生成完成".to_string(),
            delta: None,
            answer: Some(response.answer.clone()),
            answer_source: Some(response.answer_source),
            evidence: response.evidence.clone(),
            trace: response.trace.clone(),
        },
    );

    Ok(response)
}

fn emit_stream_event(app: &AppHandle, event: InterpretationStreamEvent) {
    let _ = app.emit(INTERPRETATION_STREAM_EVENT, event);
}

pub fn cancel_interpretation(request_id: &str) -> bool {
    let Some(token) = with_active_interpretations(|active| active.get(request_id).cloned()) else {
        return false;
    };
    llm::cancel(&token);
    true
}

fn register_active_interpretation(request_id: &str) -> CancellationToken {
    let token = llm::cancellation_token();
    with_active_interpretations(|active| {
        active.insert(request_id.to_string(), token.clone());
    });
    token
}

fn unregister_active_interpretation(request_id: &str) {
    with_active_interpretations(|active| {
        active.remove(request_id);
    });
}

fn active_interpretations() -> &'static Mutex<BTreeMap<String, CancellationToken>> {
    ACTIVE_INTERPRETATIONS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn with_active_interpretations<T>(
    action: impl FnOnce(&mut BTreeMap<String, CancellationToken>) -> T,
) -> T {
    let mut guard = active_interpretations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

struct ActiveInterpretationGuard {
    request_id: String,
}

impl ActiveInterpretationGuard {
    fn new(request_id: String) -> Self {
        Self { request_id }
    }
}

impl Drop for ActiveInterpretationGuard {
    fn drop(&mut self) {
        unregister_active_interpretation(&self.request_id);
    }
}

fn run_agentic_retrieval(
    db_path: &std::path::Path,
    request: &InterpretRequest,
) -> Result<(Vec<EvidenceItem>, Vec<AgentTraceStep>)> {
    let mut by_id = BTreeMap::new();
    let mut seed_chunk_ids = Vec::new();
    let plan = build_retrieval_plan(request);
    let mut trace = vec![AgentTraceStep {
        phase: AgentTracePhase::Plan,
        query: None,
        chunk_ids: Vec::new(),
        note: plan.note.clone(),
    }];

    let mut focus_ids = Vec::new();
    for chunk_id in request.focus_chunk_ids.iter().take(8) {
        if let Some(hit) = storage::get_chunk(db_path, &request.book_id, chunk_id)? {
            focus_ids.push(hit.chunk_id.clone());
            seed_chunk_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
    }
    if !focus_ids.is_empty() {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some("focus_chunk_ids".to_string()),
            chunk_ids: focus_ids,
            note: "优先读取框选文本直接命中的 chunk，避免只按页取前几个 chunk。".to_string(),
        });
    }

    for hit in storage::chunks_for_pages(db_path, &request.book_id, &request.page_indexes, 4)? {
        seed_chunk_ids.push(hit.chunk_id.clone());
        insert_hit(&mut by_id, hit);
    }
    if !request.page_indexes.is_empty() {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some(format!("page_indexes={:?}", request.page_indexes)),
            chunk_ids: seed_chunk_ids.clone(),
            note: "先取框选所在页 chunk，重新钉住用户焦点。".to_string(),
        });
    }

    let mut prior_ids = Vec::new();
    for chunk_id in request.prior_evidence_chunk_ids.iter().take(8) {
        if let Some(hit) = storage::get_chunk(db_path, &request.book_id, chunk_id)? {
            prior_ids.push(hit.chunk_id.clone());
            seed_chunk_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
    }
    if !prior_ids.is_empty() {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some("prior_evidence".to_string()),
            chunk_ids: prior_ids,
            note: "追问会继承上一轮已用证据，避免把同一段对话当成孤立问题。".to_string(),
        });
    }

    for query in plan.queries {
        let hits = storage::hybrid_search_book(db_path, &request.book_id, &query, 6)?;
        let mut chunk_ids = Vec::new();
        for hit in hits {
            seed_chunk_ids.push(hit.chunk_id.clone());
            chunk_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some(query),
            chunk_ids,
            note: "混合检索全书文本 chunk，寻找定义、上下文和呼应证据。".to_string(),
        });
    }

    let mut seen_neighbor_seeds = BTreeSet::new();
    for chunk_id in seed_chunk_ids
        .into_iter()
        .filter(|chunk_id| seen_neighbor_seeds.insert(chunk_id.clone()))
        .take(4)
    {
        let mut neighbor_ids = Vec::new();
        for hit in storage::get_neighbors(db_path, &request.book_id, &chunk_id, 1)? {
            neighbor_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Iterate,
            query: Some(chunk_id),
            chunk_ids: neighbor_ids,
            note: "读取命中 chunk 的前后文，避免孤立引用。".to_string(),
        });
    }

    if by_id.len() < 4 {
        let mut structure_ids = Vec::new();
        for hit in storage::list_structure(db_path, &request.book_id)?
            .into_iter()
            .take(4)
        {
            structure_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Iterate,
            query: Some("list_structure".to_string()),
            chunk_ids: structure_ids,
            note: "证据不足时读取章节结构，补齐书内定位。".to_string(),
        });
    }

    let evidence = rank_evidence(by_id.into_values().collect(), request)
        .into_iter()
        .take(MAX_SYNTHESIS_EVIDENCE_CHUNKS)
        .collect::<Vec<_>>();
    trace.push(AgentTraceStep {
        phase: AgentTracePhase::Synthesize,
        query: None,
        chunk_ids: evidence.iter().map(|item| item.chunk_id.clone()).collect(),
        note: "将证据交给 LLM 合成，要求所有关键判断使用 [chunk_id]。".to_string(),
    });

    Ok((evidence, trace))
}

async fn run_retrieval_for_request(
    db_path: &std::path::Path,
    request: &InterpretRequest,
) -> Result<(Vec<EvidenceItem>, Vec<AgentTraceStep>)> {
    if request.lightweight {
        run_lightweight_retrieval(db_path, request)
    } else {
        run_agentic_retrieval_with_model_tools(db_path, request).await
    }
}

fn run_lightweight_retrieval(
    db_path: &std::path::Path,
    request: &InterpretRequest,
) -> Result<(Vec<EvidenceItem>, Vec<AgentTraceStep>)> {
    let mut by_id = BTreeMap::new();
    let mut trace = vec![AgentTraceStep {
        phase: AgentTracePhase::Plan,
        query: None,
        chunk_ids: Vec::new(),
        note: "轻量 Spark 追问：复用首轮证据和当前选区，不运行完整 agentic 检索循环。".to_string(),
    }];

    let mut focus_ids = Vec::new();
    for chunk_id in request.focus_chunk_ids.iter().take(6) {
        if let Some(hit) = storage::get_chunk(db_path, &request.book_id, chunk_id)? {
            focus_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
    }
    if !focus_ids.is_empty() {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some("focus_chunk_ids".to_string()),
            chunk_ids: focus_ids,
            note: "读取当前选区直接命中的 chunk。".to_string(),
        });
    }

    let mut prior_ids = Vec::new();
    for chunk_id in request.prior_evidence_chunk_ids.iter().take(8) {
        if let Some(hit) = storage::get_chunk(db_path, &request.book_id, chunk_id)? {
            prior_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
    }
    if !prior_ids.is_empty() {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some("prior_evidence".to_string()),
            chunk_ids: prior_ids,
            note: "复用首轮证据，避免 Spark 追问重新展开重检索。".to_string(),
        });
    }

    if by_id.len() < 2 {
        let mut page_ids = Vec::new();
        for hit in storage::chunks_for_pages(db_path, &request.book_id, &request.page_indexes, 3)? {
            page_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some(format!("page_indexes={:?}", request.page_indexes)),
            chunk_ids: page_ids,
            note: "证据不足时只补当前页少量 chunk。".to_string(),
        });
    }

    let evidence = rank_evidence(by_id.into_values().collect(), request)
        .into_iter()
        .take(MAX_SYNTHESIS_EVIDENCE_CHUNKS)
        .collect::<Vec<_>>();
    trace.push(AgentTraceStep {
        phase: AgentTracePhase::Synthesize,
        query: None,
        chunk_ids: evidence.iter().map(|item| item.chunk_id.clone()).collect(),
        note: format!("轻量证据复用完成：{} 条候选证据进入合成。", evidence.len()),
    });
    Ok((evidence, trace))
}

async fn run_agentic_retrieval_with_model_tools(
    db_path: &std::path::Path,
    request: &InterpretRequest,
) -> Result<(Vec<EvidenceItem>, Vec<AgentTraceStep>)> {
    let mut by_id = BTreeMap::new();
    let mut trace = Vec::new();
    let mut history = Vec::new();
    let mut tool_loop_status = None;
    let mut tool_loop_failed = false;

    match run_model_tool_loop(db_path, request, &mut by_id, &mut history, &mut trace).await {
        Ok(status @ ModelToolLoopStatus::Completed) => {
            tool_loop_status = Some(status);
        }
        Ok(status @ ModelToolLoopStatus::NoToolCalls { .. }) => {
            if let ModelToolLoopStatus::NoToolCalls { note } = &status {
                trace.push(AgentTraceStep {
                    phase: AgentTracePhase::Plan,
                    query: Some("llm_tools".to_string()),
                    chunk_ids: Vec::new(),
                    note: note.clone(),
                });
            }
            tool_loop_status = Some(status);
        }
        Ok(status @ ModelToolLoopStatus::NoNewEvidence { .. }) => {
            if let ModelToolLoopStatus::NoNewEvidence { note } = &status {
                trace.push(AgentTraceStep {
                    phase: AgentTracePhase::Iterate,
                    query: Some("llm_tools".to_string()),
                    chunk_ids: Vec::new(),
                    note: note.clone(),
                });
            }
            tool_loop_status = Some(status);
        }
        Err(error) => {
            tool_loop_failed = true;
            trace.push(AgentTraceStep {
                phase: AgentTracePhase::Plan,
                query: Some("llm_tools".to_string()),
                chunk_ids: Vec::new(),
                note: format!("LLM 工具循环不可用：{error}"),
            });
        }
    }

    if let Some(reason) =
        deterministic_fallback_reason(tool_loop_status.as_ref(), tool_loop_failed, by_id.len())
    {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Plan,
            query: Some("deterministic_fallback".to_string()),
            chunk_ids: Vec::new(),
            note: deterministic_fallback_note(reason).to_string(),
        });
        let (fallback_evidence, fallback_trace) = run_agentic_retrieval(db_path, request)?;
        for item in fallback_evidence {
            by_id.entry(item.chunk_id.clone()).or_insert(item);
        }
        trace.extend(fallback_trace);
    } else {
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Synthesize,
            query: None,
            chunk_ids: by_id.keys().cloned().collect(),
            note: "LLM 工具检索已取得足够证据，跳过后端确定性补检索。".to_string(),
        });
    }

    let evidence = rank_evidence(by_id.into_values().collect(), request)
        .into_iter()
        .take(MAX_SYNTHESIS_EVIDENCE_CHUNKS)
        .collect::<Vec<_>>();
    Ok((evidence, trace))
}

#[derive(Debug, Clone)]
struct ToolLoopRound {
    model_note: String,
    tool_calls: Vec<ToolCall>,
    executions: Vec<ToolExecutionRecord>,
}

#[derive(Debug, Clone)]
struct ToolExecutionRecord {
    tool_call_id: String,
    chunk_ids: Vec<String>,
    result_prompt: String,
}

enum ModelToolLoopStatus {
    Completed,
    NoToolCalls { note: String },
    NoNewEvidence { note: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeterministicFallbackReason {
    ToolLoopUnavailable,
    NoToolCalls,
    NoNewEvidence,
    InsufficientEvidence,
}

fn deterministic_fallback_reason(
    status: Option<&ModelToolLoopStatus>,
    tool_loop_failed: bool,
    evidence_count: usize,
) -> Option<DeterministicFallbackReason> {
    if tool_loop_failed {
        return Some(DeterministicFallbackReason::ToolLoopUnavailable);
    }
    match status {
        Some(ModelToolLoopStatus::NoToolCalls { .. }) if evidence_count == 0 => {
            Some(DeterministicFallbackReason::NoToolCalls)
        }
        Some(ModelToolLoopStatus::NoNewEvidence { .. }) => {
            Some(DeterministicFallbackReason::NoNewEvidence)
        }
        _ if evidence_count < MAX_SYNTHESIS_EVIDENCE_CHUNKS / 2 => {
            Some(DeterministicFallbackReason::InsufficientEvidence)
        }
        _ => None,
    }
}

fn deterministic_fallback_note(reason: DeterministicFallbackReason) -> &'static str {
    match reason {
        DeterministicFallbackReason::ToolLoopUnavailable => {
            "LLM 工具循环不可用，启用后端确定性检索作为最后防线。"
        }
        DeterministicFallbackReason::NoToolCalls => {
            "LLM 未调用工具且没有可用证据，启用后端确定性检索作为最后防线。"
        }
        DeterministicFallbackReason::NoNewEvidence => {
            "LLM 工具结果遇到瓶颈，启用后端确定性检索补足证据。"
        }
        DeterministicFallbackReason::InsufficientEvidence => {
            "LLM 工具证据不足，启用后端确定性检索补足合成依据。"
        }
    }
}

async fn run_model_tool_loop(
    db_path: &std::path::Path,
    request: &InterpretRequest,
    by_id: &mut BTreeMap<String, EvidenceItem>,
    history: &mut Vec<ToolLoopRound>,
    trace: &mut Vec<AgentTraceStep>,
) -> Result<ModelToolLoopStatus, llm::LlmError> {
    const MAX_TOOL_ROUNDS: usize = 3;
    const MAX_TOOL_CALLS_PER_ROUND: usize = 4;

    for round_index in 0..MAX_TOOL_ROUNDS {
        let response = llm::chat_with_tools(ChatRequest {
            messages: build_tool_loop_messages(request, history, round_index),
            tools: retrieval_tool_definitions(),
            max_tokens: 700,
            temperature: 0.1,
        })
        .await?;
        let model_note = response.content.trim().to_string();
        let tool_calls = response.tool_calls;
        if tool_calls.is_empty() {
            return Ok(ModelToolLoopStatus::NoToolCalls {
                note: if model_note.is_empty() {
                    format!(
                        "LLM 第 {} 轮未继续调用工具，改用后端确定性检索补足证据。",
                        round_index + 1
                    )
                } else {
                    format!(
                        "LLM 第 {} 轮未继续调用工具：{}",
                        round_index + 1,
                        trim_for_prompt(&model_note, 240)
                    )
                },
            });
        }

        trace.push(AgentTraceStep {
            phase: if round_index == 0 {
                AgentTracePhase::Plan
            } else {
                AgentTracePhase::Iterate
            },
            query: Some(format!("llm_tool_round_{}", round_index + 1)),
            chunk_ids: Vec::new(),
            note: if model_note.is_empty() {
                format!("LLM 第 {} 轮请求调用书内检索工具。", round_index + 1)
            } else {
                format!(
                    "LLM 第 {} 轮规划：{}",
                    round_index + 1,
                    trim_for_prompt(&model_note, 240)
                )
            },
        });

        let mut executions = Vec::new();
        let mut round_new_ids = 0usize;
        for tool_call in tool_calls.iter().take(MAX_TOOL_CALLS_PER_ROUND) {
            match execute_retrieval_tool_call(db_path, request, tool_call) {
                Ok(hits) => {
                    let result_prompt = format_tool_result_prompt(tool_call, &hits);
                    let chunk_ids = hits
                        .iter()
                        .map(|hit| hit.chunk_id.clone())
                        .collect::<Vec<_>>();
                    for hit in hits {
                        if !by_id.contains_key(&hit.chunk_id) {
                            round_new_ids += 1;
                        }
                        insert_hit(by_id, hit);
                    }
                    trace.push(AgentTraceStep {
                        phase: if round_index == 0 {
                            AgentTracePhase::Retrieve
                        } else {
                            AgentTracePhase::Iterate
                        },
                        query: Some(format_tool_call_query(tool_call)),
                        chunk_ids: chunk_ids.clone(),
                        note: format!(
                            "LLM 第 {} 轮调用书内工具，后端执行后把结果回灌给下一轮。",
                            round_index + 1
                        ),
                    });
                    executions.push(ToolExecutionRecord {
                        tool_call_id: tool_call.id.clone(),
                        chunk_ids,
                        result_prompt,
                    });
                }
                Err(error) => {
                    trace.push(AgentTraceStep {
                        phase: AgentTracePhase::Iterate,
                        query: Some(format_tool_call_query(tool_call)),
                        chunk_ids: Vec::new(),
                        note: format!("工具调用执行失败，跳过该工具结果：{error}"),
                    });
                    executions.push(ToolExecutionRecord {
                        tool_call_id: tool_call.id.clone(),
                        chunk_ids: Vec::new(),
                        result_prompt: format!(
                            "工具调用 {} 执行失败：{}",
                            format_tool_call_query(tool_call),
                            error
                        ),
                    });
                }
            }
        }

        history.push(ToolLoopRound {
            model_note,
            tool_calls: tool_calls
                .into_iter()
                .take(MAX_TOOL_CALLS_PER_ROUND)
                .collect(),
            executions,
        });

        if should_stop_for_no_new_evidence(round_index, MAX_TOOL_ROUNDS, round_new_ids) {
            return Ok(ModelToolLoopStatus::NoNewEvidence {
                note: format!(
                    "LLM 已完成 {} 轮检索；最后一轮工具结果没有带来新 chunk，进入确定性补证据。",
                    round_index + 1
                ),
            });
        }
    }

    Ok(ModelToolLoopStatus::Completed)
}

fn should_stop_for_no_new_evidence(
    round_index: usize,
    max_tool_rounds: usize,
    round_new_ids: usize,
) -> bool {
    round_new_ids == 0 && round_index + 1 == max_tool_rounds
}

fn format_tool_result_prompt(tool_call: &ToolCall, hits: &[storage::SearchHit]) -> String {
    if hits.is_empty() {
        return format!(
            "{}\n结果：没有找到匹配 chunk。",
            format_tool_call_query(tool_call)
        );
    }
    let rows = hits
        .iter()
        .take(8)
        .map(|hit| {
            format!(
                "[{}] page {}\n{}",
                hit.chunk_id,
                hit.page_index + 1,
                trim_for_prompt(&hit.text, 260)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!("{}\n结果：\n{}", format_tool_call_query(tool_call), rows)
}

fn format_tool_execution_result_for_model(
    execution: &ToolExecutionRecord,
    include_text_snippets: bool,
) -> String {
    let chunk_ids = if execution.chunk_ids.is_empty() {
        "chunks: []".to_string()
    } else {
        format!("chunks: [{}]", execution.chunk_ids.join(", "))
    };
    if !include_text_snippets {
        let query = execution
            .result_prompt
            .lines()
            .next()
            .map(|line| trim_for_prompt(line, 160))
            .unwrap_or_else(|| "tool_result".to_string());
        return format!("{chunk_ids}\n已检索：{query}\n旧轮证据正文已压缩，只保留 chunk id；如仍需原文请调用 get_chunk。");
    }
    format!("{}\n{}", chunk_ids, execution.result_prompt)
}

fn execute_retrieval_tool_call(
    db_path: &std::path::Path,
    request: &InterpretRequest,
    tool_call: &ToolCall,
) -> Result<Vec<storage::SearchHit>> {
    match tool_call.name.as_str() {
        "search_book" => {
            let query = string_arg(&tool_call.arguments, "query")
                .filter(|query| !query.trim().is_empty())
                .unwrap_or_else(|| trim_for_query(&request.selection_text, 120));
            let limit = u32_arg(&tool_call.arguments, "limit")
                .unwrap_or(6)
                .clamp(1, 12);
            storage::hybrid_search_book(db_path, &request.book_id, &query, limit)
        }
        "get_chunk" => {
            let Some(chunk_id) = string_arg(&tool_call.arguments, "chunk_id") else {
                return Ok(Vec::new());
            };
            Ok(storage::get_chunk(db_path, &request.book_id, &chunk_id)?
                .into_iter()
                .collect())
        }
        "get_neighbors" => {
            let Some(chunk_id) = string_arg(&tool_call.arguments, "chunk_id") else {
                return Ok(Vec::new());
            };
            let radius = u32_arg(&tool_call.arguments, "radius")
                .unwrap_or(1)
                .clamp(1, 3);
            storage::get_neighbors(db_path, &request.book_id, &chunk_id, radius)
        }
        "list_structure" => storage::list_structure(db_path, &request.book_id),
        _ => Ok(Vec::new()),
    }
}

fn format_tool_call_query(tool_call: &ToolCall) -> String {
    if tool_call.arguments.is_null() {
        return tool_call.name.clone();
    }
    format!(
        "{} {}",
        tool_call.name,
        trim_for_prompt(&tool_call.arguments.to_string(), 180)
    )
}

fn string_arg(arguments: &Value, name: &str) -> Option<String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn u32_arg(arguments: &Value, name: &str) -> Option<u32> {
    arguments
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn evidence_queries(request: &InterpretRequest) -> Vec<String> {
    let mut queries = vec![trim_for_query(&request.selection_text, 120)];
    queries.extend(focus_phrase_queries(&request.selection_text));
    queries.extend(query_rewrite_expansions(&request.selection_text));
    if let Some(question) = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
    {
        queries.push(trim_for_query(question, 120));
        queries.extend(query_rewrite_expansions(question));
        queries.push(trim_for_query(
            &format!("{} {}", request.selection_text, question),
            180,
        ));
    }
    if let Some(prior_answer) = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
    {
        queries.push(trim_for_query(prior_answer, 140));
    }
    for turn in request.follow_up_history.iter().rev().take(3) {
        queries.push(trim_for_query(&turn.question, 100));
        queries.push(trim_for_query(&turn.answer, 120));
    }

    queries.sort();
    queries.dedup();
    queries
        .into_iter()
        .filter(|query| !query.trim().is_empty())
        .collect()
}

fn focus_phrase_queries(text: &str) -> Vec<String> {
    let compact = trim_for_query(text, 220);
    let mut queries = compact
        .split(|ch: char| {
            matches!(
                ch,
                '，' | '。' | '；' | '：' | '！' | '？' | ',' | '.' | ';' | ':' | '!' | '?'
            )
        })
        .map(|part| trim_for_query(part, 80))
        .filter(|part| part.chars().count() >= 4)
        .take(4)
        .collect::<Vec<_>>();

    let chars = compact.chars().collect::<Vec<_>>();
    if chars.len() > 80 {
        queries.push(chars.iter().take(60).collect());
        queries.push(
            chars
                .iter()
                .rev()
                .take(60)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
        );
    }
    queries
}

fn query_rewrite_expansions(text: &str) -> Vec<String> {
    query_rewrite_expansions_with_pairs(text, &configurable_concept_pairs())
}

fn query_rewrite_expansions_with_pairs(
    text: &str,
    concept_pairs: &[(String, String)],
) -> Vec<String> {
    let mut expansions = Vec::new();
    let terms = lexical_terms(text);
    let chinese_terms = terms
        .iter()
        .filter(|term| contains_cjk(term) && term.chars().count() >= 2)
        .take(10)
        .cloned()
        .collect::<Vec<_>>();
    if !chinese_terms.is_empty() {
        expansions.push(chinese_terms.join(" "));
    }
    let compact_cjk = compact_cjk_text(text);
    if compact_cjk.chars().count() >= 4 {
        let topic_terms = cjk_topic_terms(&compact_cjk);
        if !topic_terms.is_empty() {
            expansions.push(topic_terms.join(" "));
        }
    }

    let compact = trim_for_query(text, 180);
    for (needle, rewrite) in concept_pairs {
        if compact.contains(needle.as_str()) {
            expansions.push(format!("{needle} {rewrite}"));
        }
    }
    expansions
}

struct RetrievalPlan {
    note: String,
    queries: Vec<String>,
}

fn build_retrieval_plan(request: &InterpretRequest) -> RetrievalPlan {
    let mut queries = evidence_queries(request);
    match request.mode {
        InterpretMode::Deep => {
            queries.push(trim_for_query(
                &format!("定义 背景 上下文 {}", request.selection_text),
                160,
            ));
            queries.push(trim_for_query(
                &format!("呼应 对照 结论 {}", request.selection_text),
                160,
            ));
        }
        InterpretMode::Plain => {
            queries.push(trim_for_query(
                &format!("上下文 {}", request.selection_text),
                140,
            ));
        }
    }
    queries.sort();
    queries.dedup();
    queries.retain(|query| !query.trim().is_empty());

    RetrievalPlan {
        note: format!(
            "Plan: 以框选文本为焦点，生成 {} 条检索查询；每轮都回到原文，不做泛化总结。",
            queries.len()
        ),
        queries,
    }
}

fn insert_hit(by_id: &mut BTreeMap<String, EvidenceItem>, hit: storage::SearchHit) {
    by_id.entry(hit.chunk_id.clone()).or_insert(EvidenceItem {
        title: format!("Chunk {}", hit.chunk_id),
        chunk_id: hit.chunk_id,
        page_index: hit.page_index,
        text: hit.text,
        score: hit.score,
        rects: hit.rects,
    });
}

fn rank_evidence(mut evidence: Vec<EvidenceItem>, request: &InterpretRequest) -> Vec<EvidenceItem> {
    let page_indexes = &request.page_indexes;
    let terms = ranking_terms(request);
    let focus_rank = request
        .focus_chunk_ids
        .iter()
        .enumerate()
        .map(|(index, chunk_id)| (chunk_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let prior_rank = request
        .prior_evidence_chunk_ids
        .iter()
        .enumerate()
        .map(|(index, chunk_id)| (chunk_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    evidence.sort_by(|a, b| {
        let a_focus = focus_rank.get(a.chunk_id.as_str()).copied();
        let b_focus = focus_rank.get(b.chunk_id.as_str()).copied();
        let a_prior = prior_rank.get(a.chunk_id.as_str()).copied();
        let b_prior = prior_rank.get(b.chunk_id.as_str()).copied();
        let a_same_page = page_indexes.contains(&a.page_index);
        let b_same_page = page_indexes.contains(&b.page_index);
        let a_geometry = selection_rect_score(a, &request.selection_rects);
        let b_geometry = selection_rect_score(b, &request.selection_rects);
        let a_overlap = lexical_match_score(&a.text, &terms);
        let b_overlap = lexical_match_score(&b.text, &terms);
        let score_order = b
            .score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal);
        a_focus
            .is_none()
            .cmp(&b_focus.is_none())
            .then_with(|| {
                a_focus
                    .unwrap_or(usize::MAX)
                    .cmp(&b_focus.unwrap_or(usize::MAX))
            })
            .then_with(|| b_same_page.cmp(&a_same_page))
            .then_with(|| b_geometry.cmp(&a_geometry))
            .then_with(|| a_prior.is_none().cmp(&b_prior.is_none()))
            .then_with(|| {
                a_prior
                    .unwrap_or(usize::MAX)
                    .cmp(&b_prior.unwrap_or(usize::MAX))
            })
            .then(score_order)
            .then_with(|| b_overlap.cmp(&a_overlap))
            .then_with(|| a.page_index.cmp(&b.page_index))
            .then_with(|| a.chunk_id.cmp(&b.chunk_id))
    });
    evidence
}

fn selection_rect_score(
    evidence: &EvidenceItem,
    selection_rects: &[storage::NormalizedRectInput],
) -> u32 {
    if selection_rects.is_empty() || evidence.rects.is_empty() {
        return 0;
    }
    let mut score = 0.0;
    for selection_rect in selection_rects {
        for evidence_rect in &evidence.rects {
            if selection_rect.page_index != evidence_rect.page_index
                || evidence.page_index != evidence_rect.page_index
            {
                continue;
            }
            score += rect_intersection_area(selection_rect, evidence_rect);
        }
    }
    (score * 1_000_000.0).round() as u32
}

fn rect_intersection_area(
    left: &storage::NormalizedRectInput,
    right: &storage::NormalizedRectInput,
) -> f64 {
    let width = (left.x1.min(right.x1) - left.x0.max(right.x0)).max(0.0);
    let height = (left.y1.min(right.y1) - left.y0.max(right.y0)).max(0.0);
    width * height
}

fn ranking_terms(request: &InterpretRequest) -> Vec<String> {
    let mut terms = lexical_terms(&request.selection_text);
    if let Some(question) = &request.question {
        terms.extend(lexical_terms(question));
    }
    terms.sort();
    terms.dedup();
    terms
}

fn lexical_terms(text: &str) -> Vec<String> {
    let compact = text
        .to_lowercase()
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>();
    let mut terms = compact
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let chars = compact
        .chars()
        .filter(|ch| !ch.is_whitespace() && !is_punctuation(*ch))
        .collect::<Vec<_>>();
    for window in chars.windows(2).take(80) {
        terms.push(window.iter().collect());
    }
    for window in chars.windows(3).take(80) {
        terms.push(window.iter().collect());
    }
    if contains_cjk(&compact) {
        terms.extend(cjk_topic_terms(&compact));
    }
    terms
}

fn cjk_topic_terms(text: &str) -> Vec<String> {
    let chars = compact_cjk_text(text).chars().collect::<Vec<_>>();
    if chars.len() < 2 {
        return Vec::new();
    }
    let mut scores = BTreeMap::<String, usize>::new();
    for size in [2, 3, 4] {
        for window in chars.windows(size).take(120) {
            if window.iter().all(|ch| cjk_stop_char(*ch)) {
                continue;
            }
            let term = window.iter().collect::<String>();
            *scores.entry(term).or_insert(0) += size;
        }
    }
    let mut ranked = scores.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|(left_term, left_score), (right_term, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| right_term.chars().count().cmp(&left_term.chars().count()))
            .then_with(|| left_term.cmp(right_term))
    });
    ranked.into_iter().map(|(term, _)| term).take(24).collect()
}

fn compact_cjk_text(text: &str) -> String {
    text.chars()
        .filter(|ch| contains_cjk_char(*ch))
        .collect::<String>()
}

fn contains_cjk_char(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
        || ('\u{3400}'..='\u{4dbf}').contains(&ch)
        || ('\u{f900}'..='\u{faff}').contains(&ch)
}

fn cjk_stop_char(ch: char) -> bool {
    matches!(
        ch,
        '的' | '了'
            | '和'
            | '与'
            | '及'
            | '或'
            | '在'
            | '是'
            | '有'
            | '为'
            | '对'
            | '中'
            | '上'
            | '下'
            | '这'
            | '那'
            | '把'
            | '被'
            | '而'
            | '并'
            | '就'
            | '都'
            | '也'
            | '更'
            | '从'
            | '到'
    )
}

fn contains_cjk(text: &str) -> bool {
    text.chars().any(contains_cjk_char)
}

fn lexical_match_score(text: &str, terms: &[String]) -> usize {
    if terms.is_empty() {
        return 0;
    }
    let haystack = text.to_lowercase();
    terms
        .iter()
        .filter(|term| !term.trim().is_empty() && haystack.contains(term.as_str()))
        .map(|term| term.chars().count().clamp(1, 8))
        .sum()
}

fn configurable_concept_pairs() -> Vec<(String, String)> {
    #[cfg(not(test))]
    crate::config::load_dotenv();
    if let Ok(raw) = env::var("FOCUSED_READING_CONCEPT_PAIRS") {
        return parse_concept_pairs(&raw);
    }
    default_concept_pairs()
        .into_iter()
        .map(|(needle, rewrite)| (needle.to_string(), rewrite.to_string()))
        .collect()
}

fn parse_concept_pairs(raw: &str) -> Vec<(String, String)> {
    raw.split(';')
        .filter_map(|entry| {
            let (needle, rewrite) = entry.split_once('=')?;
            let needle = needle.trim();
            let rewrite = rewrite.trim();
            (!needle.is_empty() && !rewrite.is_empty())
                .then(|| (needle.to_string(), rewrite.to_string()))
        })
        .collect()
}

fn default_concept_pairs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("复利", "长期 时间 耐心 增长"),
        ("风险", "波动 控制 安全边际"),
        ("现金流", "流动性 持续 投入"),
        ("认知", "理解 判断 决策"),
        ("模型", "框架 机制 结构"),
        ("历史", "背景 演变 原因"),
        ("市场", "价格 竞争 供需"),
        ("制度", "规则 激励 约束"),
        ("技术", "工具 系统 效率"),
        ("学习", "反馈 迁移 练习"),
        ("组织", "协作 流程 治理"),
        ("数据", "指标 样本 趋势"),
    ]
}

fn is_punctuation(ch: char) -> bool {
    matches!(
        ch,
        '，' | '。'
            | '；'
            | '：'
            | '！'
            | '？'
            | '、'
            | ','
            | '.'
            | ';'
            | ':'
            | '!'
            | '?'
            | '"'
            | '\''
            | '“'
            | '”'
            | '‘'
            | '’'
            | '('
            | ')'
            | '（'
            | '）'
            | '['
            | ']'
    )
}

fn enforce_grounded_citations(
    answer: &str,
    request: &InterpretRequest,
    evidence: &[EvidenceItem],
) -> String {
    if evidence.is_empty() {
        return fallback_grounded_answer(request, evidence, None);
    }
    let allowed = evidence
        .iter()
        .map(|item| item.chunk_id.as_str())
        .collect::<BTreeSet<_>>();
    let (mut cleaned, valid_count) = rewrite_chunk_citations(answer, &allowed);
    cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        return fallback_grounded_answer(request, evidence, None);
    }
    if valid_count == 0 {
        cleaned.push_str("\n\n可核对证据：");
        cleaned.push_str(&evidence_citation_footer(evidence, 3));
    }
    cleaned
}

fn rewrite_chunk_citations(answer: &str, allowed: &BTreeSet<&str>) -> (String, usize) {
    let chars = answer.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut valid_count = 0;
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '[' || chars[index] == '【' {
            let closing = if chars[index] == '[' { ']' } else { '】' };
            if let Some(close_offset) = chars[index + 1..]
                .iter()
                .take(160)
                .position(|ch| *ch == closing)
            {
                let close_index = index + 1 + close_offset;
                let candidate = chars[index + 1..close_index].iter().collect::<String>();
                let valid_ids = chunk_ids_in_citation(&candidate)
                    .into_iter()
                    .filter(|chunk_id| allowed.contains(chunk_id.as_str()))
                    .collect::<Vec<_>>();
                if !valid_ids.is_empty() || citation_contains_chunk_id_like(&candidate) {
                    for chunk_id in valid_ids {
                        output.push('[');
                        output.push_str(&chunk_id);
                        output.push(']');
                        valid_count += 1;
                    }
                    index = close_index + 1;
                    continue;
                }
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    (output, valid_count)
}

fn chunk_ids_in_citation(value: &str) -> Vec<String> {
    value
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | '，' | ';' | '；' | '、' | '|'))
        .map(|part| part.trim_matches(|ch: char| matches!(ch, '[' | ']' | '【' | '】')))
        .filter(|part| is_chunk_id_like(part))
        .map(ToString::to_string)
        .collect()
}

fn citation_contains_chunk_id_like(value: &str) -> bool {
    !chunk_ids_in_citation(value).is_empty()
}

fn is_chunk_id_like(value: &str) -> bool {
    chunk_id::is_namespaced_chunk_id(value)
}

fn fallback_grounded_answer(
    request: &InterpretRequest,
    evidence: &[EvidenceItem],
    llm_error: Option<&str>,
) -> String {
    let focus = trim_for_prompt(&request.selection_text, 220);
    if evidence.is_empty() {
        return format!(
            "这段文字的焦点是：“{}”。\n\n本地文本索引没有检索到可用的书内证据，所以现在不能给出全书范围的深度解读。请确认这本书已经完成文本转换和索引，或换一个更具体的问题。",
            focus
        );
    }

    let mut sections = Vec::new();
    let mode_label = match request.mode {
        InterpretMode::Deep => "深度解读",
        InterpretMode::Plain => "直白解释",
    };
    let error_hint = if llm_error.is_some() {
        format!(
            "LLM 暂不可用，以下是基于本地书库检索证据生成的可核对{mode_label}。请在设置中检查 LLM API Key、Base URL 和网络连接后重试深度解读。"
        )
    } else {
        format!("以下是基于本地检索证据生成的可核对{mode_label}。")
    };
    sections.push(error_hint);
    sections.push(format!("框选文本：{}", focus));
    if let Some(prior_answer) = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
    {
        sections.push(format!(
            "上一轮解读要点：{}",
            trim_for_prompt(prior_answer, 220)
        ));
    }
    if let Some(question) = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
    {
        sections.push(format!(
            "针对追问“{}”，先回到框选原文，再看书内证据。",
            question.trim()
        ));
    }
    if !request.follow_up_history.is_empty() {
        let history = request
            .follow_up_history
            .iter()
            .rev()
            .take(2)
            .map(|turn| {
                format!(
                    "Q: {} / A: {}",
                    trim_for_prompt(&turn.question, 80),
                    trim_for_prompt(&turn.answer, 120)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!("已有追问上下文：\n{history}"));
    }

    let top = evidence.iter().take(4).collect::<Vec<_>>();
    let evidence_summary = top
        .iter()
        .map(|item| {
            format!(
                "第 {} 页 [{}]：{}",
                item.page_index + 1,
                item.chunk_id,
                trim_for_prompt(&item.text, 180)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    sections.push(format!("书内证据：\n{}", evidence_summary));

    let first = top[0];
    let second = top.get(1).copied().unwrap_or(first);
    sections.push(format!(
        "可先把这段理解为：它在当前上下文中提出一个需要结合前后文判断的重点。最近的证据是第 {} 页 [{}]，它给出了同页或近邻语境；另一个可互相校验的证据是第 {} 页 [{}]。",
        first.page_index + 1,
        first.chunk_id,
        second.page_index + 1,
        second.chunk_id
    ));
    sections.push(format!(
        "可核对证据：{}",
        evidence_citation_footer(evidence, 4)
    ));
    sections.join("\n\n")
}

fn evidence_citation_footer(evidence: &[EvidenceItem], limit: usize) -> String {
    evidence
        .iter()
        .take(limit)
        .map(|item| format!("[{}] 第 {} 页", item.chunk_id, item.page_index + 1))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_messages(request: &InterpretRequest, evidence: &[EvidenceItem]) -> Vec<ChatMessage> {
    let system = [
        "你是“框选精读”的阅读助理。",
        "用户会框选一段转换后的书中文字。你必须始终以这段原文为不可动摇的焦点，不能漂移到泛泛总结整本书。",
        "你只能使用给出的 evidence chunks 作为书内依据。每个关键判断后都用对应的 [chunk_id] 标注依据。",
        "如果证据不足，明确说证据不足，并说明还需要什么证据。不要编造引用。",
        "回答使用中文，结构清楚，避免空泛鸡汤。",
    ]
    .join("\n");
    let evidence_text = if evidence.is_empty() {
        "没有检索到可用 evidence chunks。".to_string()
    } else {
        evidence
            .iter()
            .map(|item| {
                format!(
                    "[{}] page {}\n{}",
                    item.chunk_id,
                    item.page_index + 1,
                    trim_for_prompt(&item.text, 900)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let mode_instruction = match request.mode {
        InterpretMode::Deep => {
            "请给出深度解读：先解释这段话在说什么，再说明它在上下文中的作用、可能的隐含前提、与证据 chunk 的关联。至少使用 2 条引用，除非证据不足。"
        }
        InterpretMode::Plain => "请用更直白的话解释这段话，并给出必要的上下文依据。",
    };
    let question = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
        .map(|question| format!("\n用户追问：{question}"))
        .unwrap_or_default();
    let prior_answer = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
        .map(|answer| format!("\n上一轮解读摘要：\n{}", trim_for_prompt(answer, 700)))
        .unwrap_or_default();
    let follow_up_context = if request.follow_up_history.is_empty() {
        String::new()
    } else {
        let turns = request
            .follow_up_history
            .iter()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|turn| {
                format!(
                    "Q: {}\nA: {}",
                    trim_for_prompt(&turn.question, 180),
                    trim_for_prompt(&turn.answer, 360)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        format!("\n已有追问上下文：\n{turns}")
    };
    let user = format!(
        "框选文本：\n{}\n{}{}{}\n\nEvidence chunks:\n{}\n\n{}",
        request.selection_text.trim(),
        question,
        prior_answer,
        follow_up_context,
        evidence_text,
        mode_instruction
    );

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

#[cfg(test)]
fn build_tool_planning_messages(request: &InterpretRequest) -> Vec<ChatMessage> {
    let question = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
        .unwrap_or("请为这段话做深度解读。");
    let prior = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
        .map(|answer| format!("\n上一轮解读：{}", trim_for_prompt(answer, 400)))
        .unwrap_or_default();
    let system = [
        "你是“框选精读”的检索规划器。",
        "你只能为当前书籍调用提供的检索工具，不能直接回答。",
        "必须始终围绕用户逐字框选的文本规划检索，不要泛化成整本书摘要。",
        "优先调用 search_book；如果已有 chunk_id，可调用 get_chunk 或 get_neighbors；证据不足时调用 list_structure。",
    ]
    .join("\n");
    let user = format!(
        "框选文本：\n{}\n\n用户问题：{}\n当前页索引：{:?}\n焦点 chunk：{:?}{}",
        request.selection_text.trim(),
        question,
        request.page_indexes,
        request.focus_chunk_ids,
        prior
    );

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

fn build_tool_loop_messages(
    request: &InterpretRequest,
    history: &[ToolLoopRound],
    round_index: usize,
) -> Vec<ChatMessage> {
    let question = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
        .unwrap_or("请为这段话做深度解读。");
    let prior = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
        .map(|answer| format!("\n上一轮解读：{}", trim_for_prompt(answer, 420)))
        .unwrap_or_default();
    let follow_up_context = if request.follow_up_history.is_empty() {
        String::new()
    } else {
        let turns = request
            .follow_up_history
            .iter()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|turn| {
                format!(
                    "Q: {}\nA: {}",
                    trim_for_prompt(&turn.question, 160),
                    trim_for_prompt(&turn.answer, 260)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        format!("\n已有追问上下文：\n{turns}")
    };
    let system = [
        "你是“框选精读”的 agentic RAG 检索器。",
        "你只能为当前书籍调用提供的检索工具，不能直接给最终解读。",
        "必须逐轮围绕用户逐字框选的文本和追问检索证据，不要泛化成整本书摘要。",
        "每一轮读取上一轮工具结果后，判断还缺什么证据；如果还缺定义、上下文、呼应、反例或追问相关证据，就继续调用工具。",
        "如果已有足够证据，可以不调用工具；后端会进入合成阶段。",
        "可用工具：search_book / get_chunk / get_neighbors / list_structure。",
    ]
    .join("\n");
    let user = format!(
        "第 {} 轮检索。\n\n{}",
        round_index + 1,
        if round_index == 0 {
            format!(
                "框选文本：\n{}\n\n用户问题：{}\n当前页索引：{:?}\n焦点 chunk：{:?}{}{}\n\n请只通过工具继续检索需要的书内证据；如证据已经足够，可以不调用工具。",
                request.selection_text.trim(),
                question,
                request.page_indexes,
                request.focus_chunk_ids,
                prior,
                follow_up_context
            )
        } else {
            format!(
                "检索目标保持不变。\n框选文本摘要：{}\n用户问题：{}\n焦点 chunk：{:?}\n\n请读取上一轮工具结果，只针对仍缺的定义、上下文、呼应、反例或追问相关证据继续调用工具；如证据已经足够，可以不调用工具。",
                trim_for_prompt(request.selection_text.trim(), 180),
                trim_for_prompt(question, 120),
                request.focus_chunk_ids
            )
        }
    );

    let mut messages = vec![ChatMessage::system(system), ChatMessage::user(user)];
    for (history_index, round) in history.iter().enumerate() {
        let include_text_snippets = history_index + 1 == history.len();
        messages.push(ChatMessage::assistant(
            round.model_note.clone(),
            round.tool_calls.clone(),
        ));
        for execution in &round.executions {
            messages.push(ChatMessage::tool_result(
                execution.tool_call_id.clone(),
                format_tool_execution_result_for_model(execution, include_text_snippets),
            ));
        }
    }
    messages
}

fn retrieval_tool_definitions() -> Vec<ToolDefinition> {
    llm::book_retrieval_tools()
}

fn trim_for_prompt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let hard_limit = trimmed.chars().take(max_chars).collect::<String>();
    let min_sentence_chars = max_chars.saturating_mul(2) / 3;
    let mut best_boundary = None;
    for (byte_index, ch) in hard_limit.char_indices() {
        if is_sentence_boundary(ch)
            && hard_limit[..byte_index].chars().count() >= min_sentence_chars
        {
            best_boundary = Some(byte_index + ch.len_utf8());
        }
    }
    let mut output = best_boundary
        .map(|byte_index| hard_limit[..byte_index].trim_end().to_string())
        .unwrap_or(hard_limit);
    output.push('…');
    output
}

fn is_sentence_boundary(ch: char) -> bool {
    matches!(ch, '。' | '！' | '？' | '.' | '!' | '?')
}

fn trim_for_query(text: &str, max_chars: usize) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
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

        let messages = build_messages(&request, &evidence);
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

        let messages = build_messages(&request, &evidence);
        assert!(messages[1].content.contains("上一轮解读摘要"));
        assert!(messages[1].content.contains("长期是复利成立的时间条件"));
        assert!(messages[1].content.contains("已有追问上下文"));
        assert!(messages[1].content.contains("为什么强调长期"));
        assert!(messages[1].content.contains("风险控制"));
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

        assert_eq!(cleaned, "第一段。 第二段继续展开。");
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
}
