use std::{
    collections::hash_map::DefaultHasher,
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{config, llm, storage};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTranslationRequest {
    pub book_id: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPage {
    pub page_index: u32,
    pub source_markdown: String,
    pub translated_markdown: String,
    pub status: TranslationPageStatus,
    pub error: String,
    pub provider: String,
    pub model: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranslationPageStatus {
    Pending,
    Translating,
    Done,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationStatus {
    pub book_id: String,
    pub total_pages: u32,
    pub completed_pages: u32,
    pub failed_pages: u32,
    pub running: bool,
    pub provider: String,
    pub model: String,
    pub pages: Vec<TranslationPage>,
}

static ACTIVE_TRANSLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
const TRANSLATION_PROTOCOL_VERSION: &str = "block-v3-baoyu-normal";
const TRANSLATION_SYSTEM_PROMPT: &str = r#"你是专业学术译者。采用 baoyu-translate normal 模式的工作方式：先理解文章领域、论证结构、关键术语和目标读者，再输出译文。

目标：把英文论文页翻译成自然、准确、可连续阅读的简体中文 Markdown。译文应该像中文学术作者直接写成，而不是逐词硬译。

质量标准：
- 准确第一：事实、数据、引用、逻辑关系、限定条件和不确定性必须与原文一致。
- 自然中文：长句可以按中文习惯拆分或重组，但不能增删论点。
- 学术风格：保持严谨、克制、清晰；不要口语化、营销化或过度文学化。
- 术语一致：同一术语在全书中保持同一译法；关键英文术语首次出现时可在括号中保留英文。
- 格式保真：保留 Markdown 标题层级、列表、表格、图片链接、公式占位、脚注/引用符号和段落边界。
- 对齐优先：输出必须保留输入块编号，不能合并、拆分、重排或跳过块。
- 不要输出译者说明、总结、前言、完成提示或独立注释。"#;

pub async fn start_translation(
    db_path: &std::path::Path,
    request: StartTranslationRequest,
) -> Result<TranslationStatus> {
    let book_id = request.book_id.clone();
    ensure_translation_schema(db_path)?;
    let Some(token) = register_translation(&book_id) else {
        return translation_status(db_path, &book_id);
    };

    let result = run_translation_job(db_path, request, token).await;
    unregister_translation(&book_id);
    result?;
    translation_status(db_path, &book_id)
}

async fn run_translation_job(
    db_path: &std::path::Path,
    request: StartTranslationRequest,
    token: Arc<AtomicBool>,
) -> Result<()> {
    let book = storage::get_converted_book_manifest(db_path, &request.book_id)?;
    let config = config::llm_config()?;
    let provider = provider_label(config.provider).to_string();
    let model = config.model.clone();
    let source_fingerprint = translation_source_fingerprint(db_path, &book)?;

    let mut start_page = 0;
    while start_page < book.total_pages {
        let window = storage::get_converted_book_page_sources(
            db_path,
            &book.book_id,
            start_page,
            storage::MAX_CONVERTED_BOOK_PAGE_WINDOW,
        )?;
        if window.end_page <= start_page {
            break;
        }
        for page in &window.pages {
            if token.load(Ordering::SeqCst) {
                break;
            }
            let source = translation_source_markdown(page);
            if source.is_empty() && page.text.trim().is_empty() {
                save_translation_page(
                    db_path,
                    TranslationPageRecord {
                        book_id: &book.book_id,
                        page_index: page.page_index,
                        source_fingerprint: &source_fingerprint,
                        provider: &provider,
                        model: &model,
                        source_markdown: &page.markdown,
                        translated_markdown: "",
                        status: TranslationPageStatus::Done,
                        error: "",
                    },
                )?;
                continue;
            }
            let existing = get_cached_page(
                db_path,
                &book.book_id,
                page.page_index,
                &source_fingerprint,
                &provider,
                &model,
            )?;
            if !request.force
                && existing
                    .as_ref()
                    .is_some_and(|page| page.status == TranslationPageStatus::Done)
            {
                continue;
            }
            save_translation_page(
                db_path,
                TranslationPageRecord {
                    book_id: &book.book_id,
                    page_index: page.page_index,
                    source_fingerprint: &source_fingerprint,
                    provider: &provider,
                    model: &model,
                    source_markdown: &page.markdown,
                    translated_markdown: existing
                        .as_ref()
                        .map(|page| page.translated_markdown.as_str())
                        .unwrap_or_default(),
                    status: TranslationPageStatus::Translating,
                    error: "",
                },
            )?;

            let messages = build_translation_messages(page.page_index, &source, &page.text);
            let translation_result = translate_one_page(
                page.page_index,
                &source,
                &page.text,
                messages,
                translation_max_tokens(&source, &page.text),
            )
            .await;
            match translation_result {
                Ok(answer) => {
                    let trimmed = answer.trim();
                    // Block-alignment guard: the translation MUST keep every
                    // [[B###]] block from the source, or the bilingual rail
                    // misaligns. A failed guard is recorded as a failed page
                    // (with the raw output preserved for debugging) rather than
                    // silently corrupting alignment.
                    match validate_translation_blocks(&source, trimmed) {
                        Ok(()) => {
                            save_translation_page(
                                db_path,
                                TranslationPageRecord {
                                    book_id: &book.book_id,
                                    page_index: page.page_index,
                                    source_fingerprint: &source_fingerprint,
                                    provider: &provider,
                                    model: &model,
                                    source_markdown: &page.markdown,
                                    translated_markdown: trimmed,
                                    status: TranslationPageStatus::Done,
                                    error: "",
                                },
                            )?;
                        }
                        Err(reason) => {
                            save_translation_page(
                                db_path,
                                TranslationPageRecord {
                                    book_id: &book.book_id,
                                    page_index: page.page_index,
                                    source_fingerprint: &source_fingerprint,
                                    provider: &provider,
                                    model: &model,
                                    source_markdown: &page.markdown,
                                    translated_markdown: trimmed,
                                    status: TranslationPageStatus::Failed,
                                    error: &format!("block alignment check failed: {reason}"),
                                },
                            )?;
                        }
                    }
                }
                Err(error) => {
                    save_translation_page(
                        db_path,
                        TranslationPageRecord {
                            book_id: &book.book_id,
                            page_index: page.page_index,
                            source_fingerprint: &source_fingerprint,
                            provider: &provider,
                            model: &model,
                            source_markdown: &page.markdown,
                            translated_markdown: existing
                                .as_ref()
                                .map(|page| page.translated_markdown.as_str())
                                .unwrap_or_default(),
                            status: TranslationPageStatus::Failed,
                            error: &error.to_string(),
                        },
                    )?;
                }
            }
        }
        if token.load(Ordering::SeqCst) {
            break;
        }
        start_page = window.end_page;
    }
    Ok(())
}

pub fn translation_status(db_path: &std::path::Path, book_id: &str) -> Result<TranslationStatus> {
    let book = storage::get_converted_book_manifest(db_path, book_id)?;
    let config = config::llm_config().ok();
    let provider = config
        .as_ref()
        .map(|config| provider_label(config.provider).to_string())
        .unwrap_or_default();
    let model = config
        .as_ref()
        .map(|config| config.model.clone())
        .unwrap_or_default();
    ensure_translation_schema(db_path)?;
    let source_fingerprint = translation_source_fingerprint(db_path, &book)?;
    let pages = list_cached_pages(
        db_path,
        &book.book_id,
        &source_fingerprint,
        &provider,
        &model,
    )?
    .into_iter()
    .filter(|page| page.page_index < book.total_pages)
    .collect::<Vec<_>>();
    let completed_pages = pages
        .iter()
        .filter(|page| page.status == TranslationPageStatus::Done)
        .count() as u32;
    let failed_pages = pages
        .iter()
        .filter(|page| page.status == TranslationPageStatus::Failed)
        .count() as u32;
    Ok(TranslationStatus {
        book_id: book.book_id,
        total_pages: book.total_pages,
        completed_pages,
        failed_pages,
        running: is_translation_running(book_id),
        provider,
        model,
        pages,
    })
}

pub fn cancel_translation(book_id: &str) -> bool {
    active_translations()
        .lock()
        .ok()
        .and_then(|registry| registry.get(book_id).cloned())
        .map(|token| {
            token.store(true, Ordering::SeqCst);
            true
        })
        .unwrap_or(false)
}

pub fn is_translation_running(book_id: &str) -> bool {
    active_translations()
        .lock()
        .ok()
        .is_some_and(|registry| registry.contains_key(book_id))
}

/// Translate one page, routing through the OpenCode `translator` agent when the
/// sidecar is enabled and ready, otherwise the in-process Rust LLM call. If the
/// OpenCode path errors we fall back to the Rust call so a page never fails just
/// because the sidecar hiccupped.
async fn translate_one_page(
    page_index: u32,
    source_markdown: &str,
    source_text: &str,
    messages: Vec<llm::ChatMessage>,
    max_tokens: u32,
) -> Result<String> {
    if crate::agent_host::ready() {
        if let Some(host_url) = crate::agent_host::host_url() {
            match translate_opencode::translate_page(&host_url, page_index, source_markdown).await {
                Ok(answer) => return Ok(answer),
                Err(err) => {
                    eprintln!(
                        "OpenCode translation failed for page {page_index}, falling back to Rust: {err}"
                    );
                }
            }
        }
    }
    let _ = source_text;
    llm::chat(messages, max_tokens)
        .await
        .map_err(|err| anyhow::anyhow!(err))
}

/// Validate that a translated page keeps every `[[B###]]` block from the source.
/// Returns Err with a human-readable reason when alignment would break, so the
/// caller can mark the page failed instead of corrupting the bilingual rail.
fn validate_translation_blocks(source_markdown: &str, translated: &str) -> Result<(), String> {
    let source_block_count = split_translation_blocks(source_markdown).len();
    if source_block_count == 0 {
        // Nothing to align (e.g. an empty/figure-only page); accept as-is.
        return Ok(());
    }
    let translated_ids = parse_translated_block_ids(translated);
    if translated_ids.is_empty() {
        return Err("no [[B###]] markers in translation".to_string());
    }
    for index in 0..source_block_count {
        let expected = index as u32 + 1;
        if !translated_ids.contains(&expected) {
            return Err(format!("missing block B{expected:03}"));
        }
    }
    Ok(())
}

/// Extract the numeric ids of `[[B###]]` markers present in a translated page.
fn parse_translated_block_ids(translated: &str) -> std::collections::BTreeSet<u32> {
    let mut ids = std::collections::BTreeSet::new();
    let bytes = translated.as_bytes();
    let mut i = 0;
    while i + 4 < bytes.len() {
        if &bytes[i..i + 3] == b"[[B" {
            // read digits until ]]
            let mut j = i + 3;
            let start = j;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > start && j + 1 < bytes.len() && &bytes[j..j + 2] == b"]]" {
                if let Ok(num) = translated[start..j].parse::<u32>() {
                    ids.insert(num);
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    ids
}

/// OpenCode `translator` agent execution for a single page. Materializes the
/// page into a one-shot sandbox workspace, asks the agent to translate it into
/// an output file (preserving block markers), then reads the output back.
mod translate_opencode {
    use anyhow::{anyhow, Context, Result};
    use futures_util::StreamExt;
    use std::path::PathBuf;

    const PAGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

    /// Per-run sandbox root under the agent-host state dir (gitignored).
    fn sandbox_root() -> PathBuf {
        if let Ok(dir) = std::env::var("FOCUSED_READING_AGENT_HOST_DIR") {
            return PathBuf::from(dir).join(".state").join("translate");
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .map(|p| p.join("agent-host").join(".state").join("translate"))
            .unwrap_or_else(|| PathBuf::from(".state/translate"))
    }

    pub async fn translate_page(
        host_url: &str,
        page_index: u32,
        source_markdown: &str,
    ) -> Result<String> {
        let marked = super::marked_translation_source(source_markdown);
        if marked.trim().is_empty() {
            return Ok(String::new());
        }

        // One-shot workspace for this page.
        let workspace = sandbox_root().join(format!("page-{page_index:04}"));
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).context("create translate sandbox")?;
        // Pre-seed EXTEND.md so the skill never triggers first-time setup.
        let extend_dir = workspace.join(".baoyu-skills").join("baoyu-translate");
        std::fs::create_dir_all(&extend_dir).context("create extend dir")?;
        std::fs::write(extend_dir.join("EXTEND.md"), EXTEND_MD).context("write EXTEND.md")?;

        let source_path = workspace.join("source.md");
        let output_path = workspace.join("translation.md");
        std::fs::write(&source_path, &marked).context("write page source")?;

        let prompt = format!(
            "工作目录（沙箱）：{ws}\n\n\
             请翻译这一页。读取源文件，按 [[B###]] 逐块翻译成简体中文，写入输出文件。\n\
             - 源文件：{src}\n\
             - 输出文件：{out}\n\n\
             硬性要求：每个输入块产出且仅产出一个同号输出块，顺序一致，不得合并/拆分/重排/跳过块。\
             只把译文写入输出文件，不要打印到对话。完成后停止。",
            ws = workspace.display(),
            src = source_path.display(),
            out = output_path.display(),
        );

        let client = reqwest::Client::new();
        let session_id = create_session(&client, host_url).await?;
        send_translator_prompt(&client, host_url, &session_id, &prompt).await?;
        wait_until_idle(&client, host_url, &session_id).await?;

        // Read the agent's output file.
        let translated = std::fs::read_to_string(&output_path)
            .with_context(|| format!("translator produced no output at {}", output_path.display()))?;

        // Best-effort cleanup of the one-shot sandbox.
        let _ = std::fs::remove_dir_all(&workspace);

        let translated = translated.trim().to_string();
        if translated.is_empty() {
            return Err(anyhow!("translator output was empty"));
        }
        Ok(translated)
    }

    const EXTEND_MD: &str = "---\n\
target_language: zh-CN\n\
default_mode: normal\n\
audience: academic\n\
style: academic\n\
chunk_threshold: 100000\n\
chunk_max_words: 100000\n\
glossary: []\n\
---\n\
App-owned preset for block-aligned reader translation. Do not run first-time setup.\n";

    async fn create_session(client: &reqwest::Client, host_url: &str) -> Result<String> {
        let url = format!("{}/session", host_url.trim_end_matches('/'));
        let response = client
            .post(&url)
            .json(&serde_json::json!({}))
            .send()
            .await
            .context("create translator session")?;
        if !response.status().is_success() {
            return Err(anyhow!("session create status {}", response.status()));
        }
        let value: serde_json::Value = response.json().await.context("parse session json")?;
        for key in ["id", "sessionID", "sessionId", "session_id"] {
            if let Some(id) = value.get(key).and_then(|v| v.as_str()) {
                return Ok(id.to_string());
            }
        }
        value
            .get("session")
            .and_then(|s| s.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("missing session id"))
    }

    async fn send_translator_prompt(
        client: &reqwest::Client,
        host_url: &str,
        session_id: &str,
        prompt: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/session/{}/message",
            host_url.trim_end_matches('/'),
            session_id
        );
        let body = serde_json::json!({
            "agent": "translator",
            "parts": [{ "type": "text", "text": prompt }],
        });
        let response = client
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("send translator prompt")?;
        if !response.status().is_success() {
            return Err(anyhow!("translator prompt status {}", response.status()));
        }
        Ok(())
    }

    /// Block on the SSE stream until the session reports idle (or times out).
    async fn wait_until_idle(
        client: &reqwest::Client,
        host_url: &str,
        _session_id: &str,
    ) -> Result<()> {
        let event_url = format!("{}/event", host_url.trim_end_matches('/'));
        let response = client
            .get(&event_url)
            .header("accept", "text/event-stream")
            .send()
            .await
            .context("subscribe translator events")?;
        if !response.status().is_success() {
            return Err(anyhow!("event subscribe status {}", response.status()));
        }
        let mut stream = response.bytes_stream();
        let mut pending = String::new();
        let started = std::time::Instant::now();
        loop {
            if started.elapsed() > PAGE_TIMEOUT {
                return Err(anyhow!("translator page timeout"));
            }
            let next =
                tokio::time::timeout(std::time::Duration::from_secs(5), stream.next()).await;
            let chunk = match next {
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(err))) => return Err(anyhow!("event stream error: {err}")),
                Ok(None) => return Ok(()), // stream ended
                Err(_) => continue,
            };
            pending.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(idx) = pending.find("\n\n") {
                let raw = pending[..idx].to_string();
                pending.drain(..idx + 2);
                for line in raw.lines() {
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(data.trim()) else {
                        continue;
                    };
                    match value.get("type").and_then(|v| v.as_str()) {
                        Some("session.idle") => return Ok(()),
                        Some("session.error") => {
                            return Err(anyhow!(
                                "translator session error: {}",
                                value
                                    .get("properties")
                                    .map(|p| p.to_string())
                                    .unwrap_or_default()
                            ))
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

fn build_translation_messages(
    page_index: u32,
    source_markdown: &str,
    source_text: &str,
) -> Vec<llm::ChatMessage> {
    let marked_source = marked_translation_source(source_markdown);
    vec![
        llm::ChatMessage::system(TRANSLATION_SYSTEM_PROMPT),
        llm::ChatMessage::user(format!(
            "请翻译第 {} 页。\n\n工作方式：\n1. 先在内部判断本页所属领域、论证功能、语气和关键术语；不要把分析过程输出。\n2. 按块翻译，保持本页与全书译名一致；遇到标题、摘要、作者、机构、参考文献、图表说明、公式和孤立短语，也必须输出对应块。\n3. 为了让阅读器中英块对齐，块编号是协议，不是正文；编号必须原样保留。\n\n硬性要求：\n- 原文已经按块编号为 [[B001]]、[[B002]] ...。\n- 输出必须逐块保留同一个编号，按输入顺序排列；每个输入块都必须有一个对应输出块。\n- 不要合并、拆分、重排或跳过块。无需翻译的块可保留原文。\n- 只输出中文译文 Markdown 本身和块编号。\n- 不要输出“中文译文”“已完成”“以下是...”等前言。\n- 不要输出翻译说明、项目符号说明或总结。\n- 不要重复英文原文；人名、术语、引用和公式可按需保留。\n\n输出格式示例：\n[[B001]]\n第一块中文译文。\n\n[[B002]]\n第二块中文译文。\n\n带编号 Markdown 原文块：\n{}\n\n纯文本参考：\n{}",
            page_index + 1,
            marked_source,
            source_text
        )),
    ]
}

fn translation_source_markdown(page: &storage::ParsedPageInput) -> String {
    let markdown = strip_page_heading(page.markdown.trim(), page.page_index).trim();
    if !markdown.is_empty() {
        return markdown.to_string();
    }
    clean_translation_text(&page.text)
}

fn strip_page_heading(markdown: &str, page_index: u32) -> &str {
    let trimmed = markdown.trim();
    let Some(first_line_end) = trimmed.find('\n') else {
        let heading = trimmed.trim_start_matches('#').trim();
        return if heading.eq_ignore_ascii_case(&format!("Page {}", page_index + 1)) {
            ""
        } else {
            trimmed
        };
    };
    let (first_line, rest) = trimmed.split_at(first_line_end);
    let heading = first_line.trim().trim_start_matches('#').trim();
    if heading.eq_ignore_ascii_case(&format!("Page {}", page_index + 1)) {
        rest.trim()
    } else {
        trimmed
    }
}

fn marked_translation_source(source_markdown: &str) -> String {
    let blocks = split_translation_blocks(source_markdown);
    if blocks.is_empty() {
        return String::new();
    }
    let mut marked = String::new();
    for (index, block) in blocks.iter().enumerate() {
        if index > 0 {
            marked.push_str("\n\n");
        }
        marked.push_str(&format!("[[B{:03}]]\n{}", index + 1, block));
    }
    marked
}

fn split_translation_blocks(markdown: &str) -> Vec<String> {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for line in normalized.lines() {
        if line.trim().is_empty() {
            push_translation_block(&mut blocks, &mut current);
        } else {
            current.push(line.trim_end().to_string());
        }
    }
    push_translation_block(&mut blocks, &mut current);
    blocks
}

fn push_translation_block(blocks: &mut Vec<String>, current: &mut Vec<String>) {
    if current.is_empty() {
        return;
    }
    let block = current.join("\n").trim().to_string();
    if !block.is_empty() {
        blocks.push(block);
    }
    current.clear();
}

fn clean_translation_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|paragraph| !paragraph.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn translation_max_tokens(source_markdown: &str, source_text: &str) -> u32 {
    let source_chars = source_markdown
        .chars()
        .count()
        .max(source_text.chars().count()) as u32;
    (source_chars.saturating_mul(9) / 10)
        .saturating_add(900)
        .clamp(2200, 6000)
}

fn ensure_translation_schema(db_path: &std::path::Path) -> Result<()> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open SQLite database {}", db_path.display()))?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS page_translations (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          page_index INTEGER NOT NULL,
          source_fingerprint TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          source_markdown TEXT NOT NULL,
          translated_markdown TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY(book_id, page_index, source_fingerprint, provider, model)
        );
        ",
    )
    .context("failed to initialize translation schema")
}

struct TranslationPageRecord<'a> {
    book_id: &'a str,
    page_index: u32,
    source_fingerprint: &'a str,
    provider: &'a str,
    model: &'a str,
    source_markdown: &'a str,
    translated_markdown: &'a str,
    status: TranslationPageStatus,
    error: &'a str,
}

fn save_translation_page(db_path: &std::path::Path, page: TranslationPageRecord<'_>) -> Result<()> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open SQLite database {}", db_path.display()))?;
    conn.execute(
        "INSERT INTO page_translations(
           book_id, page_index, source_fingerprint, provider, model, source_markdown,
           translated_markdown, status, error, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
         ON CONFLICT(book_id, page_index, source_fingerprint, provider, model) DO UPDATE SET
           source_markdown = excluded.source_markdown,
           translated_markdown = excluded.translated_markdown,
           status = excluded.status,
           error = excluded.error,
           updated_at = excluded.updated_at",
        params![
            page.book_id,
            page.page_index,
            page.source_fingerprint,
            page.provider,
            page.model,
            page.source_markdown,
            page.translated_markdown,
            status_label(page.status),
            page.error,
        ],
    )
    .with_context(|| format!("failed to save translation page {}", page.page_index + 1))?;
    Ok(())
}

fn get_cached_page(
    db_path: &std::path::Path,
    book_id: &str,
    page_index: u32,
    source_fingerprint: &str,
    provider: &str,
    model: &str,
) -> Result<Option<TranslationPage>> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open SQLite database {}", db_path.display()))?;
    conn.query_row(
        "SELECT page_index, source_markdown, translated_markdown, status, error, provider, model, updated_at
         FROM page_translations
         WHERE book_id = ?1 AND page_index = ?2 AND source_fingerprint = ?3 AND provider = ?4 AND model = ?5",
        params![book_id, page_index, source_fingerprint, provider, model],
        translation_page_from_row,
    )
    .optional()
    .context("failed to fetch cached translation page")
}

fn list_cached_pages(
    db_path: &std::path::Path,
    book_id: &str,
    source_fingerprint: &str,
    provider: &str,
    model: &str,
) -> Result<Vec<TranslationPage>> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open SQLite database {}", db_path.display()))?;
    let mut stmt = conn
        .prepare(
            "SELECT page_index, source_markdown, translated_markdown, status, error, provider, model, updated_at
             FROM page_translations
             WHERE book_id = ?1 AND source_fingerprint = ?2 AND provider = ?3 AND model = ?4
             ORDER BY page_index",
        )
        .context("failed to prepare translation page list")?;
    let pages = stmt
        .query_map(
            params![book_id, source_fingerprint, provider, model],
            translation_page_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read translation pages")?;
    Ok(pages)
}

fn translation_page_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranslationPage> {
    let status: String = row.get(3)?;
    Ok(TranslationPage {
        page_index: row.get(0)?,
        source_markdown: row.get(1)?,
        translated_markdown: row.get(2)?,
        status: parse_status(&status),
        error: row.get(4)?,
        provider: row.get(5)?,
        model: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn status_label(status: TranslationPageStatus) -> &'static str {
    match status {
        TranslationPageStatus::Pending => "pending",
        TranslationPageStatus::Translating => "translating",
        TranslationPageStatus::Done => "done",
        TranslationPageStatus::Failed => "failed",
    }
}

fn parse_status(value: &str) -> TranslationPageStatus {
    match value {
        "translating" => TranslationPageStatus::Translating,
        "done" => TranslationPageStatus::Done,
        "failed" => TranslationPageStatus::Failed,
        _ => TranslationPageStatus::Pending,
    }
}

fn provider_label(provider: config::LlmProviderKind) -> &'static str {
    match provider {
        config::LlmProviderKind::DeepSeek => "deep_seek",
        config::LlmProviderKind::OpenAi => "open_ai",
        config::LlmProviderKind::Anthropic => "anthropic",
    }
}

fn translation_source_fingerprint(
    db_path: &std::path::Path,
    book: &storage::StoredBookSummary,
) -> Result<String> {
    // The engine tag (rust vs opencode-baoyu) is folded into the fingerprint so
    // switching engines (or upgrading the translator workflow) naturally
    // invalidates stale cached pages instead of mixing formats.
    let engine = translation_engine_tag();
    if !book.source_pdf_fingerprint.trim().is_empty() {
        return Ok(format!(
            "{}:{}:{}",
            TRANSLATION_PROTOCOL_VERSION,
            engine,
            book.source_pdf_fingerprint.trim()
        ));
    }
    let mut hasher = DefaultHasher::new();
    TRANSLATION_PROTOCOL_VERSION.hash(&mut hasher);
    engine.hash(&mut hasher);
    book.book_id.hash(&mut hasher);
    book.total_pages.hash(&mut hasher);
    let mut start_page = 0;
    while start_page < book.total_pages {
        let window = storage::get_converted_book_page_sources(
            db_path,
            &book.book_id,
            start_page,
            storage::MAX_CONVERTED_BOOK_PAGE_WINDOW,
        )?;
        if window.end_page <= start_page {
            break;
        }
        for page in &window.pages {
            page.page_index.hash(&mut hasher);
            page.markdown.hash(&mut hasher);
            page.text.hash(&mut hasher);
        }
        start_page = window.end_page;
    }
    Ok(format!("book-source-{:016x}", hasher.finish()))
}

/// Identifies which translation engine produced a cached page, so caches are
/// isolated across engines. Bumps the baoyu version string when the translator
/// workflow/prompt changes materially.
///
/// Gated on `opencode_enabled()` (a process-stable env flag) rather than
/// `ready()` (which depends on the transient sidecar host URL). This keeps the
/// fingerprint identical between job start and status polling — otherwise a
/// sidecar that becomes ready mid-job would make the status query compute a
/// different key and report 0% progress for already-translated pages.
fn translation_engine_tag() -> &'static str {
    if crate::agent_host::opencode_enabled() {
        "opencode-baoyu-1.59-aligned"
    } else {
        "rust-inline"
    }
}

fn active_translations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_TRANSLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_translation(book_id: &str) -> Option<Arc<AtomicBool>> {
    let token = Arc::new(AtomicBool::new(false));
    if let Ok(mut registry) = active_translations().lock() {
        if registry.contains_key(book_id) {
            return None;
        }
        registry.insert(book_id.to_string(), token.clone());
        return Some(token);
    }
    None
}

fn unregister_translation(book_id: &str) {
    if let Ok(mut registry) = active_translations().lock() {
        registry.remove(book_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        coordinates::COORDINATE_VERSION,
        storage::{
            self, ParsedChunkInput, ParsedPageInput, SaveBookOptions, SaveBookRequest, TextQuality,
        },
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn validate_blocks_accepts_complete_alignment() {
        let source = "First block.\n\nSecond block.";
        let translated = "[[B001]]\n第一块。\n\n[[B002]]\n第二块。";
        assert!(validate_translation_blocks(source, translated).is_ok());
    }

    #[test]
    fn validate_blocks_rejects_missing_block() {
        let source = "First block.\n\nSecond block.";
        let translated = "[[B001]]\n第一块。"; // B002 dropped (baoyu merge)
        let err = validate_translation_blocks(source, translated).unwrap_err();
        assert!(err.contains("B002"));
    }

    #[test]
    fn validate_blocks_rejects_no_markers() {
        let source = "First block.\n\nSecond block.";
        let translated = "第一块。第二块。"; // markers stripped
        assert!(validate_translation_blocks(source, translated).is_err());
    }

    #[test]
    fn validate_blocks_accepts_empty_source() {
        assert!(validate_translation_blocks("", "anything").is_ok());
    }

    #[test]
    fn validate_blocks_allows_extra_blocks_if_all_source_present() {
        // A spurious B003 is tolerated as long as B001/B002 are present; the
        // frontend simply renders the extra as an orphan row.
        let source = "First.\n\nSecond.";
        let translated = "[[B001]]\n一。\n\n[[B002]]\n二。\n\n[[B003]]\n注释。";
        assert!(validate_translation_blocks(source, translated).is_ok());
    }

    #[test]
    fn parse_block_ids_extracts_numbers() {
        let ids = parse_translated_block_ids("[[B001]]\nx\n\n[[B012]]\ny");
        assert!(ids.contains(&1));
        assert!(ids.contains(&12));
        assert_eq!(ids.len(), 2);
    }

    fn temp_db(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!(
            "focused-reading-translation-{name}-{}-{nonce}.sqlite3",
            std::process::id()
        ))
    }

    fn isolate_config(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "focused-reading-translation-config-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("config dir");
        std::env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        std::env::set_var("FOCUSED_READING_ENV_PATH", dir.join(".env"));
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
        std::env::remove_var("DEEPSEEK_API_KEY");
        std::env::remove_var("OPENAI_API_KEY");
        std::env::remove_var("ANTHROPIC_API_KEY");
        dir
    }

    fn save_translation_fixture(db_path: &std::path::Path) -> storage::SaveBookResponse {
        storage::save_book_with_options(
            db_path,
            SaveBookRequest {
                title: "Translation Fixture".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 21,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "Compounding needs time.".to_string(),
                    markdown: "## Page 1\n\nCompounding needs time.".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "Compounding needs time.".to_string(),
                    markdown: "### [p1-c1] Page 1\n\nCompounding needs time.".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
            SaveBookOptions {
                skip_embedding_rebuild: true,
            },
        )
        .expect("fixture book should save")
    }

    #[test]
    fn translation_status_returns_sparse_cached_pages() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let _config_dir = isolate_config("status");
        let db_path = temp_db("status");
        let _ = std::fs::remove_file(&db_path);
        let saved = save_translation_fixture(&db_path);
        let manifest = storage::get_converted_book_manifest(&db_path, &saved.book_id)
            .expect("asset should load");
        let source_fingerprint =
            translation_source_fingerprint(&db_path, &manifest).expect("fingerprint should build");

        let pending =
            translation_status(&db_path, &saved.book_id).expect("translation status should load");
        assert_eq!(pending.total_pages, 1);
        assert_eq!(pending.completed_pages, 0);
        assert!(
            pending.pages.is_empty(),
            "status polling should not return synthetic pending pages with full source markdown"
        );

        ensure_translation_schema(&db_path).expect("schema should initialize");
        save_translation_page(
            &db_path,
            TranslationPageRecord {
                book_id: &saved.book_id,
                page_index: 0,
                source_fingerprint: &source_fingerprint,
                provider: "",
                model: "",
                source_markdown: "## Page 1\n\nCompounding needs time.",
                translated_markdown: "## 第 1 页\n\n复利需要时间。",
                status: TranslationPageStatus::Done,
                error: "",
            },
        )
        .expect("translation page should save");

        let cached =
            translation_status(&db_path, &saved.book_id).expect("translation status should load");
        assert_eq!(cached.completed_pages, 1);
        assert_eq!(cached.pages[0].status, TranslationPageStatus::Done);
        assert_eq!(
            cached.pages[0].translated_markdown,
            "## 第 1 页\n\n复利需要时间。"
        );
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn translation_prompt_marks_source_blocks_for_stable_alignment() {
        let messages = build_translation_messages(
            0,
            "Title\n\nAuthors\n\nABSTRACT\n\nFirst paragraph.",
            "Title\n\nAuthors\n\nABSTRACT\n\nFirst paragraph.",
        );
        let system = &messages[0].content;
        let user = &messages[1].content;
        assert!(system.contains("baoyu-translate normal"));
        assert!(system.contains("术语一致"));
        assert!(user.contains("先在内部判断本页所属领域"));
        assert!(user.contains("[[B001]]\nTitle"));
        assert!(user.contains("[[B002]]\nAuthors"));
        assert!(user.contains("[[B003]]\nABSTRACT"));
        assert!(user.contains("[[B004]]\nFirst paragraph."));
        assert!(user.contains("每个输入块都必须有一个对应输出块"));
    }

    #[test]
    fn source_fingerprint_includes_translation_protocol_version() {
        let db_path = temp_db("fingerprint");
        let _ = std::fs::remove_file(&db_path);
        let saved = save_translation_fixture(&db_path);
        let mut manifest = storage::get_converted_book_manifest(&db_path, &saved.book_id)
            .expect("manifest should load");
        manifest.source_pdf_fingerprint = "pdf-fingerprint".to_string();
        let fingerprint = translation_source_fingerprint(&db_path, &manifest)
            .expect("fingerprint should build");
        // Protocol version prefix + engine tag fold into the key so old caches
        // and cross-engine caches are naturally invalidated.
        assert!(
            fingerprint.starts_with("block-v3-baoyu-normal:"),
            "translation cache key must invalidate pre-block-alignment cache entries"
        );
        assert!(
            fingerprint.ends_with(":pdf-fingerprint"),
            "fingerprint must still bind to the source pdf fingerprint"
        );
        assert!(
            fingerprint.contains(translation_engine_tag()),
            "fingerprint must isolate caches by translation engine"
        );
        let _ = std::fs::remove_file(&db_path);
    }
}
