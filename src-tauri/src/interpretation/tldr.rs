use super::*;
use crate::codex_exec::{self, CodexEvent, CodexExecError};

const TLDR_STRUCTURE_CHAR_BUDGET: usize = 8_000;
const TLDR_CHUNK_MAX_TOKENS: u32 = 4_000;
const TLDR_MAX_CONTINUATIONS: usize = 3;

/// Generous cap for the agentic Codex TLDR turn: it maps the document structure,
/// samples several chapters, then synthesizes — a multi-step, multi-tool turn.
const TLDR_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// Whole-book overview agent instructions, compiled in so the packaged app needs
/// no external prompt asset.
const TLDR_READER_INSTRUCTIONS: &str = include_str!("../../prompts/tldr-reader.md");

/// Tauri event channel for TLDR generation progress. Keyed by `book_id`.
pub const TLDR_STREAM_EVENT: &str = "tldr://stream";

static ACTIVE_TLDR: OnceLock<Mutex<BTreeMap<String, CancellationToken>>> = OnceLock::new();

/// Engine + model-source + model-name signature the cache binds to. Switching the
/// agent engine or the app model changes this tag, so an overview produced by a
/// different engine is naturally not reused. Gated on `codex_enabled()` (a
/// process-stable flag) rather than `ready()` for the same reason translation
/// does it: the tag stays stable across a single install even if the async codex
/// binary probe flips mid-session.
pub fn tldr_engine_tag() -> String {
    if !crate::agent_host::codex_enabled() {
        return "rust-inline-1".to_string();
    }
    match crate::config::agent_model_source() {
        crate::config::AgentModelSource::App => {
            let model = crate::config::llm_config()
                .map(|c| c.model)
                .unwrap_or_else(|_| "app".to_string());
            format!("codex-app-1-{model}")
        }
        crate::config::AgentModelSource::CodexLocal => "codex-local-1".to_string(),
    }
}

/// Entry point used by the command: generate a document TLDR, preferring the
/// agentic Codex path (structure → sampling → synthesis) and falling back to the
/// in-process Rust single-shot pipeline. Emits `tldr://stream` progress events
/// throughout and is cancellable via [`cancel_document_tldr`].
pub async fn generate_document_tldr_with_progress(
    app: &AppHandle,
    db_path: &Path,
    book_id: &str,
) -> Result<String, llm::LlmError> {
    let cancellation = register_active_tldr(book_id);
    let _guard = ActiveTldrGuard::new(book_id.to_string());

    let result = generate_document_tldr_inner(app, db_path, book_id, &cancellation).await;

    match &result {
        Ok(_) => emit_tldr_event(
            app,
            book_id,
            TldrStreamStage::Done,
            "速览生成完成".to_string(),
            None,
            None,
            None,
        ),
        Err(llm::LlmError::Cancelled) => emit_tldr_event(
            app,
            book_id,
            TldrStreamStage::Cancelled,
            "已停止生成".to_string(),
            None,
            None,
            None,
        ),
        Err(error) => emit_tldr_event(
            app,
            book_id,
            TldrStreamStage::Failed,
            error.to_string(),
            None,
            None,
            None,
        ),
    }

    result
}

async fn generate_document_tldr_inner(
    app: &AppHandle,
    db_path: &Path,
    book_id: &str,
    cancellation: &CancellationToken,
) -> Result<String, llm::LlmError> {
    if crate::agent_host::ready() {
        if let Some(book_tools) = crate::agent_host::book_tools_mcp() {
            match generate_tldr_via_codex(app, book_id, book_tools, cancellation).await {
                Ok(text) => return Ok(text),
                Err(CodexTldrError::Cancelled) => return Err(llm::LlmError::Cancelled),
                Err(err) => {
                    eprintln!("Codex TLDR path failed, falling back to Rust single-shot: {err}");
                    // fall through to the Rust pipeline below.
                }
            }
        }
    }
    generate_document_tldr_rust(app, db_path, book_id, cancellation).await
}

/// Agentic Codex TLDR: the model maps the book with `book_structure`, samples
/// representative chapters via the book tools, then writes the overview. Progress
/// is surfaced as structure-analysis → sampling(n) → synthesizing.
async fn generate_tldr_via_codex(
    app: &AppHandle,
    book_id: &str,
    book_tools: codex_exec::BookToolsMcp,
    cancellation: &CancellationToken,
) -> Result<String, CodexTldrError> {
    emit_tldr_event(
        app,
        book_id,
        TldrStreamStage::StructureAnalysis,
        "Codex 正在分析文档结构".to_string(),
        None,
        None,
        Some("codex"),
    );

    let prompt = build_tldr_codex_prompt(book_id);
    let invocation = codex_exec::CodexInvocation {
        prompt,
        book_tools: Some(book_tools),
        provider: crate::agent_host::bridge_provider(),
        timeout: TLDR_SESSION_TIMEOUT,
    };

    let mut sampled: u32 = 0;
    let mut synth_emitted = false;
    let outcome = codex_exec::run(
        invocation,
        |event| match tldr_codex_progress(event) {
            Some(TldrCodexProgress::Sampling) => {
                sampled += 1;
                emit_tldr_event(
                    app,
                    book_id,
                    TldrStreamStage::Sampling,
                    format!("Codex 正在抽样阅读第 {sampled} 处章节"),
                    Some(sampled),
                    None,
                    Some("codex"),
                );
            }
            Some(TldrCodexProgress::Synthesizing) if !synth_emitted => {
                synth_emitted = true;
                emit_tldr_event(
                    app,
                    book_id,
                    TldrStreamStage::Synthesizing,
                    "Codex 正在综合生成整书速览".to_string(),
                    Some(sampled),
                    None,
                    Some("codex"),
                );
            }
            _ => {}
        },
        || llm::is_cancelled(cancellation),
    )
    .await;

    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(CodexExecError::Cancelled) => return Err(CodexTldrError::Cancelled),
        Err(CodexExecError::Empty) => return Err(CodexTldrError::Empty),
        Err(err) => return Err(CodexTldrError::Engine(err.to_string())),
    };

    let text = clean_tldr_text(&outcome.final_message);
    if text.trim().is_empty() {
        return Err(CodexTldrError::Empty);
    }
    Ok(text)
}

/// In-process Rust single-shot TLDR (fallback). Two visible stages: preparing
/// (read structure + pick representative chunks) and synthesizing (one LLM call
/// with continuations).
async fn generate_document_tldr_rust(
    app: &AppHandle,
    db_path: &Path,
    book_id: &str,
    cancellation: &CancellationToken,
) -> Result<String, llm::LlmError> {
    emit_tldr_event(
        app,
        book_id,
        TldrStreamStage::StructureAnalysis,
        "正在分析文档结构与代表段落".to_string(),
        None,
        None,
        Some("rust"),
    );
    let structure =
        storage::list_structure(db_path, book_id).map_err(|err| llm::LlmError::Provider {
            status: 500,
            body: format!("failed to read document structure: {err:#}"),
        })?;
    if llm::is_cancelled(cancellation) {
        return Err(llm::LlmError::Cancelled);
    }
    let prompt_context = tldr_structure_context(&structure);

    emit_tldr_event(
        app,
        book_id,
        TldrStreamStage::Synthesizing,
        "正在综合生成整书速览".to_string(),
        None,
        None,
        Some("rust"),
    );
    run_rust_tldr_synthesis(&prompt_context).await
}

/// The single-shot LLM synthesis (chat + continuation loop), shared by the pure
/// [`generate_document_tldr`] and the progress-emitting Rust fallback.
async fn run_rust_tldr_synthesis(prompt_context: &str) -> Result<String, llm::LlmError> {
    let messages = build_tldr_messages(prompt_context);
    let mut response = llm::chat_text(messages.clone(), TLDR_CHUNK_MAX_TOKENS).await?;
    let mut output = response.content.clone();
    let mut continuation_count = 0;
    while response.stopped_by_token_limit() && continuation_count < TLDR_MAX_CONTINUATIONS {
        continuation_count += 1;
        let mut continuation_messages = messages.clone();
        continuation_messages.push(ChatMessage::assistant(output.clone(), Vec::new()));
        continuation_messages.push(ChatMessage::user(
            "刚才的 TLDR 因输出上限中断了。请从最后一句之后自然续写，继续补完剩余内容。不要重复已经写过的内容，不要写标题、道歉或说明，只输出续写正文。",
        ));
        response = llm::chat_text(continuation_messages, TLDR_CHUNK_MAX_TOKENS).await?;
        append_tldr_continuation(&mut output, &response.content);
    }
    Ok(clean_tldr_text(&output))
}

/// Build the agentic TLDR prompt: whole-book overview instructions plus the
/// bookId and the structure-first workflow nudge. Shared by production and the
/// live smoke so they exercise the same prompt.
pub(super) fn build_tldr_codex_prompt(book_id: &str) -> String {
    format!(
        "{TLDR_READER_INSTRUCTIONS}\n\n---\n\n本书 bookId = \"{book_id}\"。\
         请先用 book_structure 查看这本书的结构，再抽样阅读开头、中间、结尾的关键章节，\
         最后写出帮助读者快速了解整本书的 TLDR。"
    )
}

/// Whether a cached TLDR may be reused: both the format version and the
/// producing engine tag must still match the current run. Pure so the cache
/// decision is unit-tested without an `AppHandle`.
pub fn tldr_cache_is_fresh(
    cached_version: u32,
    cached_engine_tag: Option<&str>,
    current_engine_tag: &str,
) -> bool {
    cached_version == crate::storage::TLDR_SOURCE_VERSION
        && cached_engine_tag == Some(current_engine_tag)
}

/// Progress classification for a Codex event during agentic TLDR generation.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum TldrCodexProgress {
    /// A book tool started — the agent is sampling a chapter/section.
    Sampling,
    /// The agent's composed message arrived — it is synthesizing the overview.
    Synthesizing,
}

pub(super) fn tldr_codex_progress(event: &CodexEvent) -> Option<TldrCodexProgress> {
    match event {
        CodexEvent::ToolStarted => Some(TldrCodexProgress::Sampling),
        CodexEvent::AgentMessage(_) => Some(TldrCodexProgress::Synthesizing),
        _ => None,
    }
}

#[derive(Debug)]
enum CodexTldrError {
    Cancelled,
    Engine(String),
    Empty,
}

impl std::fmt::Display for CodexTldrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CodexTldrError::Cancelled => write!(f, "cancelled"),
            CodexTldrError::Engine(msg) => write!(f, "engine: {msg}"),
            CodexTldrError::Empty => write!(f, "empty TLDR from codex"),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_tldr_event(
    app: &AppHandle,
    book_id: &str,
    stage: TldrStreamStage,
    message: String,
    sampled: Option<u32>,
    total: Option<u32>,
    engine: Option<&str>,
) {
    let _ = app.emit(
        TLDR_STREAM_EVENT,
        TldrStreamEvent {
            book_id: book_id.to_string(),
            stage,
            message,
            sampled,
            total,
            engine: engine.map(ToString::to_string),
        },
    );
}

/// Signal cancellation for an in-flight TLDR generation on `book_id`.
pub fn cancel_document_tldr(book_id: &str) -> bool {
    let Some(token) = with_active_tldr(|active| active.get(book_id).cloned()) else {
        return false;
    };
    llm::cancel(&token);
    true
}

pub(super) fn register_active_tldr(book_id: &str) -> CancellationToken {
    let token = llm::cancellation_token();
    with_active_tldr(|active| {
        active.insert(book_id.to_string(), token.clone());
    });
    token
}

pub(super) fn unregister_active_tldr(book_id: &str) {
    with_active_tldr(|active| {
        active.remove(book_id);
    });
}

fn active_tldr() -> &'static Mutex<BTreeMap<String, CancellationToken>> {
    ACTIVE_TLDR.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn with_active_tldr<T>(action: impl FnOnce(&mut BTreeMap<String, CancellationToken>) -> T) -> T {
    let mut guard = active_tldr()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

struct ActiveTldrGuard {
    book_id: String,
}

impl ActiveTldrGuard {
    fn new(book_id: String) -> Self {
        Self { book_id }
    }
}

impl Drop for ActiveTldrGuard {
    fn drop(&mut self) {
        unregister_active_tldr(&self.book_id);
    }
}

pub(super) fn build_tldr_messages(prompt_context: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage::system(
            "你是一位精读助手。只输出读者可见的 TLDR 正文，不输出任何关于任务、提示词、片段来源、资料类型或写作限制的说明。不要写“需要先说明”“你提供的片段”“这些片段并非”“以下 TLDR”这类元话语。信息完整优先，不要人为压缩到固定字数；如果内容很多，就自然分成多个段落写完整。",
        ),
        ChatMessage::user(format!(
            "请基于下面的文档结构与代表内容，写一份帮助读者快速了解整本文档的 TLDR。先判断材料类型，再直接概括其核心内容、主线/问题、重要推进、关键人物或概念、结论/价值。不要套用不符合材料类型的体裁标签；不要解释你如何写摘要；不要提到“片段”“提示”“上下文”。根据内容自然展开，写完整，不要截断。\n\n文档结构与代表内容：\n{}",
            prompt_context
        )),
    ]
}

pub(super) fn tldr_structure_context(structure: &[storage::SearchHit]) -> String {
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

pub(super) fn representative_tldr_hits(structure: &[storage::SearchHit]) -> Vec<&storage::SearchHit> {
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

pub(super) fn clean_tldr_text(text: &str) -> String {
    let compact = text.lines().map(str::trim).collect::<Vec<_>>().join("\n");
    let normalized = compact
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .lines()
                .filter(|line| !line.trim().is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|paragraph| !paragraph.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    normalized
        .trim_matches(|ch: char| ch == '"' || ch == '“' || ch == '”')
        .trim()
        .to_string()
}

pub(super) fn append_tldr_continuation(output: &mut String, continuation: &str) {
    let continuation = continuation.trim();
    if continuation.is_empty() {
        return;
    }
    if !output.trim().is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(continuation);
}
