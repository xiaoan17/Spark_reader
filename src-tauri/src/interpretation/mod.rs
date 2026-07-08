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
    chunk_id, knowledge,
    llm::{self, CancellationToken, ChatMessage, ChatRequest, ToolCall, ToolDefinition},
    storage,
};

static ACTIVE_INTERPRETATIONS: OnceLock<Mutex<BTreeMap<String, CancellationToken>>> =
    OnceLock::new();

const MAX_SYNTHESIS_EVIDENCE_CHUNKS: usize = 6;
const MAX_KNOWLEDGE_CONTEXT_CARDS: usize = 6;
const MAX_KNOWLEDGE_CONTEXT_EDGES: usize = 8;

pub const INTERPRETATION_STREAM_EVENT: &str = "interpretation://stream";

pub async fn interpret(
    db_path: &std::path::Path,
    request: InterpretRequest,
) -> Result<InterpretResponse> {
    let (evidence, mut trace) = run_retrieval_for_request(db_path, &request).await?;
    let knowledge_context = synthesis_knowledge_context(db_path, &request);
    let messages = build_messages(&request, &evidence, knowledge_context.as_deref());
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

    // When the Codex engine is enabled and ready, run the deep_reader agent
    // for retrieval + synthesis. On any failure we fall through to the in-process
    // Rust pipeline below — the user never sees the Codex failure.
    if crate::agent_host::ready() {
        if let Some(book_tools) = crate::agent_host::book_tools_mcp() {
            match codex_session::interpret_via_codex(
                &app,
                &request_id,
                db_path,
                &request,
                book_tools,
                cancellation.clone(),
            )
            .await
            {
                Ok(response) => {
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
                    return Ok(response);
                }
                Err(codex_session::CodexInterpretError::Cancelled) => {
                    emit_stream_event(
                        &app,
                        InterpretationStreamEvent {
                            request_id: request_id.clone(),
                            stage: InterpretationStreamStage::Cancelled,
                            message: "已停止生成".to_string(),
                            delta: None,
                            answer: None,
                            answer_source: None,
                            evidence: Vec::new(),
                            trace: Vec::new(),
                        },
                    );
                    return Err(llm::LlmError::Cancelled.into());
                }
                Err(err) => {
                    eprintln!(
                        "Codex deep_reader path failed, falling back to Rust pipeline: {err}"
                    );
                    // fall through to the Rust pipeline below.
                }
            }
        }
    }

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

    let knowledge_context = synthesis_knowledge_context(db_path, &request);
    let messages = build_messages(&request, &evidence, knowledge_context.as_deref());
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
            query: Some(query.clone()),
            chunk_ids,
            note: "混合检索全书文本 chunk，寻找定义、上下文和呼应证据。".to_string(),
        });

        let knowledge_hits =
            knowledge::search_knowledge_hits(db_path, &request.book_id, &query, 6)?;
        let mut knowledge_chunk_ids = Vec::new();
        for hit in knowledge_hits {
            seed_chunk_ids.push(hit.chunk_id.clone());
            knowledge_chunk_ids.push(hit.chunk_id.clone());
            insert_hit(&mut by_id, hit);
        }
        trace.push(AgentTraceStep {
            phase: AgentTracePhase::Retrieve,
            query: Some(format!("knowledge:{query}")),
            chunk_ids: knowledge_chunk_ids,
            note: "检索已构建知识体系，把相关卡片、实体、事件、章节摘要回落到原文证据 chunk。"
                .to_string(),
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
        let mut knowledge_ids = Vec::new();
        for query in evidence_queries(request).into_iter().take(2) {
            for hit in knowledge::search_knowledge_hits(db_path, &request.book_id, &query, 4)? {
                knowledge_ids.push(hit.chunk_id.clone());
                insert_hit(&mut by_id, hit);
            }
        }
        if !knowledge_ids.is_empty() {
            trace.push(AgentTraceStep {
                phase: AgentTracePhase::Retrieve,
                query: Some("knowledge_lightweight".to_string()),
                chunk_ids: knowledge_ids,
                note: "轻量追问证据不足时，从已构建知识体系补充相关原文证据。".to_string(),
            });
        }
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
                    let result_prompt =
                        format_tool_result_prompt(db_path, request, tool_call, &hits);
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

fn format_tool_result_prompt(
    db_path: &std::path::Path,
    request: &InterpretRequest,
    tool_call: &ToolCall,
    hits: &[storage::SearchHit],
) -> String {
    if hits.is_empty() {
        return format!(
            "{}\n结果：没有找到匹配 chunk。",
            format_tool_call_query(tool_call)
        );
    }
    let knowledge_context_note = if tool_call.name == "get_knowledge_context" {
        let query = string_arg(&tool_call.arguments, "query")
            .filter(|query| !query.trim().is_empty())
            .unwrap_or_else(|| trim_for_query(&request.selection_text, 120));
        match knowledge::knowledge_context_for_query(db_path, &request.book_id, &query, 6) {
            Ok(context) => format_knowledge_context_for_prompt(&context),
            Err(error) => format!("知识体系上下文读取失败：{error}"),
        }
    } else {
        "结果：".to_string()
    };
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
    format!(
        "{}\n{}\n{}",
        format_tool_call_query(tool_call),
        knowledge_context_note,
        rows
    )
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
        "get_knowledge_context" => {
            let query = string_arg(&tool_call.arguments, "query")
                .filter(|query| !query.trim().is_empty())
                .unwrap_or_else(|| trim_for_query(&request.selection_text, 120));
            let limit = u32_arg(&tool_call.arguments, "limit")
                .unwrap_or(6)
                .clamp(1, 10);
            let context =
                knowledge::knowledge_context_for_query(db_path, &request.book_id, &query, limit)?;
            let mut hits = Vec::new();
            for chunk_id in context.evidence_chunk_ids {
                if let Some(hit) = storage::get_chunk(db_path, &request.book_id, &chunk_id)? {
                    hits.push(hit);
                }
            }
            Ok(hits)
        }
        "search_knowledge" => {
            let query = string_arg(&tool_call.arguments, "query")
                .filter(|query| !query.trim().is_empty())
                .unwrap_or_else(|| trim_for_query(&request.selection_text, 120));
            let limit = u32_arg(&tool_call.arguments, "limit")
                .unwrap_or(6)
                .clamp(1, 12);
            knowledge::search_knowledge_hits(db_path, &request.book_id, &query, limit)
        }
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
        InterpretMode::Apply => "应用/迁移解读",
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

mod citations;
mod prompt;
mod retrieval_plan;
mod tldr;
mod types;

/// Codex `deep_reader` execution path for Spark. Runs retrieval + synthesis
/// inside a per-request `codex exec` subprocess (book tools attached via the
/// MCP endpoint), then re-grounds citations in Rust. Any failure returns an
/// error so the caller falls back to the Rust in-process pipeline.
mod codex_session;

#[cfg(test)]
mod tests;

pub use tldr::generate_document_tldr;
pub use types::*;
use citations::*;
use prompt::*;
use retrieval_plan::*;
#[cfg(test)]
use tldr::*;
