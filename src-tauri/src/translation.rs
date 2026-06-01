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
const TRANSLATION_PROTOCOL_VERSION: &str = "block-v2";

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
    let book = storage::get_converted_book(db_path, &request.book_id)?;
    let config = config::llm_config()?;
    let provider = provider_label(config.provider).to_string();
    let model = config.model.clone();
    let source_fingerprint = translation_source_fingerprint(&book);

    for page in &book.pages {
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
        match llm::chat(messages, translation_max_tokens(&source, &page.text)).await {
            Ok(answer) => {
                save_translation_page(
                    db_path,
                    TranslationPageRecord {
                        book_id: &book.book_id,
                        page_index: page.page_index,
                        source_fingerprint: &source_fingerprint,
                        provider: &provider,
                        model: &model,
                        source_markdown: &page.markdown,
                        translated_markdown: answer.trim(),
                        status: TranslationPageStatus::Done,
                        error: "",
                    },
                )?;
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
    Ok(())
}

pub fn translation_status(db_path: &std::path::Path, book_id: &str) -> Result<TranslationStatus> {
    let book = storage::get_converted_book(db_path, book_id)?;
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
    let source_fingerprint = translation_source_fingerprint(&book);
    let cached = list_cached_pages(
        db_path,
        &book.book_id,
        &source_fingerprint,
        &provider,
        &model,
    )?;
    let by_page = cached
        .into_iter()
        .map(|page| (page.page_index, page))
        .collect::<HashMap<_, _>>();
    let pages = book
        .pages
        .iter()
        .map(|page| {
            by_page
                .get(&page.page_index)
                .cloned()
                .unwrap_or_else(|| TranslationPage {
                    page_index: page.page_index,
                    source_markdown: page.markdown.clone(),
                    translated_markdown: String::new(),
                    status: TranslationPageStatus::Pending,
                    error: String::new(),
                    provider: provider.clone(),
                    model: model.clone(),
                    updated_at: String::new(),
                })
        })
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

fn build_translation_messages(
    page_index: u32,
    source_markdown: &str,
    source_text: &str,
) -> Vec<llm::ChatMessage> {
    let marked_source = marked_translation_source(source_markdown);
    vec![
        llm::ChatMessage::system(
            "你是专业学术翻译。把用户提供的英文论文页翻译成自然、准确的中文 Markdown。保留标题层级、列表、表格、图片链接、公式占位和关键术语；不要添加解释、不要省略内容。",
        ),
        llm::ChatMessage::user(format!(
            "请翻译第 {} 页。\n\n要求：\n- 原文已经按块编号为 [[B001]]、[[B002]] ...。\n- 输出必须逐块保留同一个编号，按输入顺序排列；每个输入块都必须有一个对应输出块。\n- 不要合并、拆分、重排或跳过块。标题、人名、机构、邮箱、公式、孤立短语也要输出对应编号；无需翻译时可保留原文。\n- 只输出中文译文 Markdown 本身和块编号。\n- 不要输出“中文译文”“已完成”“以下是...”等前言。\n- 不要输出翻译说明、项目符号说明或总结。\n- 不要重复英文原文；人名、术语、引用和公式可按需保留。\n\n输出格式示例：\n[[B001]]\n第一块中文译文。\n\n[[B002]]\n第二块中文译文。\n\n带编号 Markdown 原文块：\n{}\n\n纯文本参考：\n{}",
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

fn translation_source_fingerprint(book: &storage::StoredBookAsset) -> String {
    if !book.source_pdf_fingerprint.trim().is_empty() {
        return format!(
            "{}:{}",
            TRANSLATION_PROTOCOL_VERSION,
            book.source_pdf_fingerprint.trim()
        );
    }
    let mut hasher = DefaultHasher::new();
    TRANSLATION_PROTOCOL_VERSION.hash(&mut hasher);
    book.book_id.hash(&mut hasher);
    book.total_pages.hash(&mut hasher);
    for page in &book.pages {
        page.page_index.hash(&mut hasher);
        page.markdown.hash(&mut hasher);
        page.text.hash(&mut hasher);
    }
    format!("book-source-{:016x}", hasher.finish())
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
    fn translation_status_returns_pending_and_cached_pages() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let _config_dir = isolate_config("status");
        let db_path = temp_db("status");
        let _ = std::fs::remove_file(&db_path);
        let saved = save_translation_fixture(&db_path);
        let asset =
            storage::get_converted_book(&db_path, &saved.book_id).expect("asset should load");
        let source_fingerprint = translation_source_fingerprint(&asset);

        let pending =
            translation_status(&db_path, &saved.book_id).expect("translation status should load");
        assert_eq!(pending.total_pages, 1);
        assert_eq!(pending.completed_pages, 0);
        assert_eq!(pending.pages[0].status, TranslationPageStatus::Pending);

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
        let user = &messages[1].content;
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
        let mut asset =
            storage::get_converted_book(&db_path, &saved.book_id).expect("asset should load");
        asset.source_pdf_fingerprint = "pdf-fingerprint".to_string();
        assert!(
            translation_source_fingerprint(&asset).starts_with("block-v2:pdf-fingerprint"),
            "translation cache key must invalidate pre-block-alignment cache entries"
        );
        let _ = std::fs::remove_file(&db_path);
    }
}
