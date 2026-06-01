use std::{
    cmp::Ordering,
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{chunk_id, config, coordinates::COORDINATE_VERSION, embeddings};

#[derive(Debug, Deserialize)]
pub struct SaveBookRequest {
    pub title: String,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    #[serde(rename = "parserEngine", default = "default_parser_engine")]
    pub parser_engine: String,
    #[serde(rename = "coordinateMode", default = "default_coordinate_mode")]
    pub coordinate_mode: String,
    #[serde(default)]
    pub quality: Option<TextQuality>,
    #[serde(rename = "sourcePdfPath", default)]
    pub source_pdf_path: Option<String>,
    #[serde(rename = "sourceAssetDir", default)]
    pub source_asset_dir: Option<String>,
    #[serde(rename = "sourceAssetDirs", default)]
    pub source_asset_dirs: Vec<String>,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

fn default_parser_engine() -> String {
    "unknown".to_string()
}

fn default_coordinate_mode() -> String {
    "text-only".to_string()
}

fn default_coordinate_version() -> u32 {
    COORDINATE_VERSION
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextQuality {
    pub char_count: u32,
    pub replacement_char_ratio: f64,
    pub control_char_ratio: f64,
    pub looks_usable: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ParsedPageInput {
    #[serde(rename = "pageIndex")]
    pub page_index: u32,
    pub text: String,
    pub markdown: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ParsedChunkInput {
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    #[serde(rename = "pageIndex")]
    pub page_index: u32,
    pub text: String,
    pub markdown: String,
    #[serde(default)]
    pub rects: Vec<NormalizedRectInput>,
    #[serde(rename = "coordinateVersion", default = "default_coordinate_version")]
    pub coordinate_version: u32,
}

#[derive(Debug, Serialize)]
pub struct SaveBookResponse {
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(rename = "pageCount")]
    pub page_count: usize,
    #[serde(rename = "chunkCount")]
    pub chunk_count: usize,
    #[serde(rename = "textCharCount")]
    pub text_char_count: usize,
    #[serde(rename = "markdownCharCount")]
    pub markdown_char_count: usize,
    #[serde(rename = "textPath")]
    pub text_path: String,
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    #[serde(rename = "originalPdfPath")]
    pub original_pdf_path: String,
    #[serde(rename = "sourcePdfPath")]
    pub source_pdf_path: String,
    #[serde(rename = "sourcePdfFingerprint")]
    pub source_pdf_fingerprint: String,
}

impl SaveBookResponse {
    pub fn from_cached_book(book: StoredBookSummary) -> Self {
        Self {
            book_id: book.book_id,
            page_count: book.total_pages as usize,
            chunk_count: book.chunk_count as usize,
            text_char_count: book.text_char_count as usize,
            markdown_char_count: book.markdown_char_count as usize,
            text_path: book.text_path,
            markdown_path: book.markdown_path,
            original_pdf_path: book.original_pdf_path,
            source_pdf_path: book.source_pdf_path,
            source_pdf_fingerprint: book.source_pdf_fingerprint,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBookResponse {
    pub book_id: String,
    pub removed_asset_dir: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    #[serde(rename = "pageIndex")]
    pub page_index: u32,
    pub text: String,
    pub markdown: String,
    pub rects: Vec<NormalizedRectInput>,
    #[serde(rename = "coordinateVersion")]
    pub coordinate_version: u32,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct StoredBookSummary {
    #[serde(rename = "bookId")]
    pub book_id: String,
    pub title: String,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    #[serde(rename = "chunkCount")]
    pub chunk_count: u32,
    #[serde(rename = "textCharCount")]
    pub text_char_count: u32,
    #[serde(rename = "markdownCharCount")]
    pub markdown_char_count: u32,
    #[serde(rename = "textPath")]
    pub text_path: String,
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    #[serde(rename = "originalPdfPath")]
    pub original_pdf_path: String,
    #[serde(rename = "sourcePdfPath")]
    pub source_pdf_path: String,
    #[serde(rename = "sourcePdfFingerprint")]
    pub source_pdf_fingerprint: String,
    #[serde(rename = "parserEngine")]
    pub parser_engine: String,
    #[serde(rename = "coordinateMode")]
    pub coordinate_mode: String,
    pub quality: Option<TextQuality>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBookAsset {
    pub book_id: String,
    pub title: String,
    pub total_pages: u32,
    pub text: String,
    pub markdown: String,
    pub text_path: String,
    pub markdown_path: String,
    pub original_pdf_path: String,
    pub source_pdf_path: String,
    pub source_pdf_fingerprint: String,
    pub parser_engine: String,
    pub coordinate_mode: String,
    pub quality: Option<TextQuality>,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexSummary {
    pub book_id: String,
    pub embedding_provider: String,
    pub embedding_base_url: String,
    pub embedding_model: String,
    pub embedding_dim: u32,
    pub embedding_last_error: String,
    pub embedding_enabled: bool,
    pub embedding_key_configured: bool,
    pub embedding_matches_config: bool,
    pub chunk_count: u32,
    pub vector_count: u32,
    pub fts_ready: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHighlightRequest {
    pub book_id: String,
    pub selection_text: String,
    pub prefix: String,
    pub suffix: String,
    #[serde(rename = "pageIndex")]
    pub page_index: Option<u32>,
    #[serde(rename = "positionStart")]
    pub position_start: Option<u32>,
    #[serde(rename = "positionEnd")]
    pub position_end: Option<u32>,
    pub rects: Vec<NormalizedRectInput>,
    #[serde(rename = "coordinateVersion", default = "default_coordinate_version")]
    pub coordinate_version: u32,
    pub interpretation: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRectInput {
    pub page_index: u32,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedHighlight {
    pub id: String,
    pub book_id: String,
    pub selection_text: String,
    pub prefix: String,
    pub suffix: String,
    pub page_index: Option<u32>,
    pub position_start: Option<u32>,
    pub position_end: Option<u32>,
    pub rects: Vec<NormalizedRectInput>,
    pub coordinate_version: u32,
    pub interpretation: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInterpretationRequest {
    pub book_id: String,
    pub selection_text: String,
    pub session_id: Option<String>,
    pub turn_index: Option<u32>,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    pub page_index: Option<u32>,
    pub position_start: Option<u32>,
    pub position_end: Option<u32>,
    pub page_indexes: Vec<u32>,
    pub evidence_chunk_ids: Vec<String>,
    pub question: Option<String>,
    pub answer: String,
    #[serde(default = "default_answer_source")]
    pub answer_source: AnswerSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedInterpretation {
    pub id: String,
    pub book_id: String,
    pub selection_text: String,
    pub session_id: String,
    pub turn_index: u32,
    pub prefix: String,
    pub suffix: String,
    pub page_index: Option<u32>,
    pub position_start: Option<u32>,
    pub position_end: Option<u32>,
    pub page_indexes: Vec<u32>,
    pub evidence_chunk_ids: Vec<String>,
    pub question: Option<String>,
    pub answer: String,
    pub answer_source: AnswerSource,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AnswerSource {
    Llm,
    LocalFallback,
}

fn default_answer_source() -> AnswerSource {
    AnswerSource::Llm
}

impl AnswerSource {
    fn as_str(self) -> &'static str {
        match self {
            AnswerSource::Llm => "llm",
            AnswerSource::LocalFallback => "local_fallback",
        }
    }

    fn from_db(value: &str) -> Self {
        match value {
            "local_fallback" => AnswerSource::LocalFallback,
            _ => AnswerSource::Llm,
        }
    }
}

pub fn default_db_path(app_data_dir: Option<PathBuf>) -> Result<PathBuf> {
    let base_dir = match app_data_dir {
        Some(path) => path,
        None => std::env::current_dir()
            .context("failed to resolve current directory")?
            .join("data"),
    };

    Ok(base_dir.join("library.sqlite3"))
}

#[cfg(test)]
pub fn save_book(db_path: &Path, request: SaveBookRequest) -> Result<SaveBookResponse> {
    save_book_with_options(db_path, request, SaveBookOptions::default())
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SaveBookOptions {
    pub skip_embedding_rebuild: bool,
}

pub fn save_book_with_options(
    db_path: &Path,
    request: SaveBookRequest,
    options: SaveBookOptions,
) -> Result<SaveBookResponse> {
    let mut conn = open_database(db_path)?;
    let book_id = stable_book_id(&request);
    let existing_chunk_aliases = existing_chunk_id_aliases(&conn, &book_id)
        .context("failed to read existing chunk aliases before save")?;
    let (request, aliases) = normalize_book_chunk_ids(request, &book_id);
    let mut request = request;
    let full_text = request
        .pages
        .iter()
        .map(|page| page.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let source_pdf_metadata = source_pdf_metadata(request.source_pdf_path.as_deref())?;
    let source_asset_dirs = normalized_source_asset_dirs(&request);
    let asset_paths = write_book_assets(
        db_path,
        &book_id,
        &request.title,
        &full_text,
        &source_asset_dirs,
        request.source_pdf_path.as_deref(),
    )?;
    rewrite_book_markdown_asset_paths(&mut request, &source_asset_dirs, &asset_paths.asset_dir);
    let full_markdown = request
        .pages
        .iter()
        .map(|page| page.markdown.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    fs::write(&asset_paths.markdown_path, &full_markdown).with_context(|| {
        format!(
            "failed to write rewritten markdown asset {}",
            asset_paths.markdown_path.display()
        )
    })?;
    let text_char_count = full_text.chars().count();
    let markdown_char_count = full_markdown.chars().count();
    let quality_json = request
        .quality
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .context("failed to serialize text quality")?;
    let tx = conn
        .transaction()
        .context("failed to start save transaction")?;

    tx.execute(
        "INSERT INTO books(
           id,
           title,
           total_pages,
           parser_engine,
           coordinate_mode,
           quality_json,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           total_pages = excluded.total_pages,
           parser_engine = excluded.parser_engine,
           coordinate_mode = excluded.coordinate_mode,
           quality_json = excluded.quality_json",
        params![
            book_id,
            request.title.trim(),
            request.total_pages,
            request.parser_engine.trim(),
            request.coordinate_mode.trim(),
            quality_json
        ],
    )
    .context("failed to upsert book")?;

    tx.execute("DELETE FROM pages WHERE book_id = ?1", params![book_id])
        .context("failed to delete old pages")?;
    clear_fts_for_book(&tx, &book_id).context("failed to clear old text index")?;
    tx.execute(
        "DELETE FROM chunk_embeddings WHERE book_id = ?1",
        params![book_id],
    )
    .context("failed to delete old embeddings")?;
    tx.execute(
        "DELETE FROM embedding_indexes WHERE book_id = ?1",
        params![book_id],
    )
    .context("failed to delete old embedding metadata")?;
    tx.execute("DELETE FROM chunks WHERE book_id = ?1", params![book_id])
        .context("failed to delete old chunks")?;
    tx.execute(
        "INSERT INTO book_assets(
           book_id,
           text,
           markdown,
           text_path,
           markdown_path,
           original_pdf_path,
           source_pdf_path,
           source_pdf_fingerprint,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET
           text = excluded.text,
           markdown = excluded.markdown,
           text_path = excluded.text_path,
           markdown_path = excluded.markdown_path,
           original_pdf_path = excluded.original_pdf_path,
           source_pdf_path = excluded.source_pdf_path,
           source_pdf_fingerprint = excluded.source_pdf_fingerprint",
        params![
            book_id,
            full_text,
            full_markdown,
            asset_paths.text_path.to_string_lossy(),
            asset_paths.markdown_path.to_string_lossy(),
            asset_paths
                .original_pdf_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
            source_pdf_metadata
                .as_ref()
                .map(|metadata| metadata.path.clone())
                .unwrap_or_default(),
            source_pdf_metadata
                .as_ref()
                .map(|metadata| metadata.fingerprint.clone())
                .unwrap_or_default()
        ],
    )
    .context("failed to upsert converted book asset")?;

    {
        let mut page_stmt = tx
            .prepare(
                "INSERT INTO pages(book_id, page_index, text, markdown)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .context("failed to prepare page insert")?;
        for page in &request.pages {
            page_stmt
                .execute(params![book_id, page.page_index, page.text, page.markdown])
                .with_context(|| format!("failed to insert page {}", page.page_index + 1))?;
        }
    }

    {
        let mut chunk_stmt = tx
            .prepare(
                "INSERT INTO chunks(book_id, chunk_id, page_index, text, markdown, rects_json, coordinate_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .context("failed to prepare chunk insert")?;
        for chunk in &request.chunks {
            let rects_json =
                serde_json::to_string(&chunk.rects).context("failed to serialize chunk rects")?;
            chunk_stmt
                .execute(params![
                    book_id,
                    chunk.chunk_id,
                    chunk.page_index,
                    chunk.text,
                    chunk.markdown,
                    rects_json,
                    chunk.coordinate_version
                ])
                .with_context(|| format!("failed to insert chunk {}", chunk.chunk_id))?;
        }
    }

    {
        let mut alias_stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO chunk_id_aliases(book_id, legacy_chunk_id, chunk_id)
                 VALUES (?1, ?2, ?3)",
            )
            .context("failed to prepare chunk id alias insert")?;
        for (legacy_chunk_id, chunk_id) in &aliases {
            alias_stmt
                .execute(params![book_id, legacy_chunk_id, chunk_id])
                .with_context(|| format!("failed to insert chunk id alias {legacy_chunk_id}"))?;
        }
        for (legacy_chunk_id, chunk_id) in
            rebind_existing_chunk_aliases(&existing_chunk_aliases, &request.chunks)
        {
            alias_stmt
                .execute(params![book_id, legacy_chunk_id, chunk_id])
                .with_context(|| format!("failed to rebind chunk id alias {legacy_chunk_id}"))?;
        }
    }

    tx.commit().context("failed to commit parsed book")?;
    rebuild_fts(&conn, &book_id).context("failed to rebuild text search index")?;
    if !options.skip_embedding_rebuild {
        if let Err(err) = rebuild_embeddings(&conn, &book_id) {
            record_embedding_error(&conn, &book_id, &format!("{err:#}"))?;
            eprintln!("failed to rebuild provider embedding index for {book_id}: {err:#}");
        }
    }

    Ok(SaveBookResponse {
        book_id,
        page_count: request.pages.len(),
        chunk_count: request.chunks.len(),
        text_char_count,
        markdown_char_count,
        text_path: asset_paths.text_path.to_string_lossy().to_string(),
        markdown_path: asset_paths.markdown_path.to_string_lossy().to_string(),
        original_pdf_path: asset_paths
            .original_pdf_path
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        source_pdf_path: source_pdf_metadata
            .as_ref()
            .map(|metadata| metadata.path.clone())
            .unwrap_or_default(),
        source_pdf_fingerprint: source_pdf_metadata
            .map(|metadata| metadata.fingerprint)
            .unwrap_or_default(),
    })
}

pub fn delete_book(db_path: &Path, book_id: &str) -> Result<DeleteBookResponse> {
    let conn = open_database(db_path)?;
    let asset_dir = converted_book_asset_dir(db_path, book_id);
    let tx = conn
        .unchecked_transaction()
        .context("failed to start delete book transaction")?;
    clear_fts_for_book(&tx, book_id).context("failed to clear deleted book text index")?;
    let deleted = tx
        .execute("DELETE FROM books WHERE id = ?1", params![book_id])
        .context("failed to delete book")?;
    tx.commit().context("failed to commit book deletion")?;

    let mut removed_asset_dir = false;
    if deleted > 0 && asset_dir.exists() {
        match fs::remove_dir_all(&asset_dir) {
            Ok(()) => {
                removed_asset_dir = true;
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                removed_asset_dir = true;
            }
            Err(err) => {
                return Err(err).with_context(|| {
                    format!(
                        "deleted database rows but failed to remove asset directory {}",
                        asset_dir.display()
                    )
                });
            }
        }
    }

    Ok(DeleteBookResponse {
        book_id: book_id.to_string(),
        removed_asset_dir,
    })
}

pub fn search_book(
    db_path: &Path,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let conn = open_database(db_path)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    if has_fts_table(&conn)? {
        let fts_query = to_fts_query(trimmed_query);
        let mut stmt = conn
            .prepare(
                "SELECT c.chunk_id,
                        c.page_index,
                        c.text,
                        c.markdown,
                        c.rects_json,
                        c.coordinate_version,
                        snippet(chunks_fts, 2, '<mark>', '</mark>', '...', 12) AS snippet,
                        bm25(chunks_fts) AS score
                 FROM chunks_fts
                 JOIN chunks c ON c.id = chunks_fts.rowid
                 WHERE chunks_fts MATCH ?1 AND c.book_id = ?2
                 ORDER BY score
                 LIMIT ?3",
            )
            .context("failed to prepare FTS search")?;

        let hits = stmt
            .query_map(params![fts_query, book_id, limit.max(1)], row_to_search_hit)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to map FTS search hits")?;

        if !hits.is_empty() {
            return Ok(hits);
        }
    }

    fallback_search(&conn, book_id, trimmed_query, limit)
}

pub fn hybrid_search_book(
    db_path: &Path,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let conn = open_database(db_path)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit.max(1);
    let fts_hits = search_book(db_path, book_id, trimmed_query, limit.saturating_mul(2))?;
    let vector_hits =
        vector_search(&conn, book_id, trimmed_query, limit.saturating_mul(2)).unwrap_or_default();
    Ok(fuse_search_hits(fts_hits, vector_hits, limit))
}

pub fn rebuild_search_index(db_path: &Path, book_id: &str) -> Result<SearchIndexSummary> {
    let conn = open_database(db_path)?;
    rebuild_fts(&conn, book_id)?;
    if let Err(err) = rebuild_embeddings(&conn, book_id) {
        record_embedding_error(&conn, book_id, &format!("{err:#}"))?;
        eprintln!("failed to rebuild provider embedding index for {book_id}: {err:#}");
    }
    search_index_summary(db_path, book_id)
}

pub fn search_index_summary(db_path: &Path, book_id: &str) -> Result<SearchIndexSummary> {
    let conn = open_database(db_path)?;
    let chunk_count = conn
        .query_row(
            "SELECT COUNT(*) FROM chunks WHERE book_id = ?1",
            params![book_id],
            |row| row.get::<_, u32>(0),
        )
        .context("failed to count chunks")?;
    let vector_count = conn
        .query_row(
            "SELECT COUNT(*) FROM chunk_embeddings WHERE book_id = ?1",
            params![book_id],
            |row| row.get::<_, u32>(0),
        )
        .context("failed to count chunk embeddings")?;
    let (
        embedding_provider,
        embedding_base_url,
        embedding_model,
        embedding_dim,
        embedding_last_error,
    ) = conn
        .query_row(
            "SELECT provider, base_url, model, dimension, last_error
             FROM embedding_indexes
             WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                ))
            },
        )
        .optional()
        .context("failed to fetch embedding index metadata")?
        .unwrap_or_else(|| {
            (
                "".to_string(),
                "".to_string(),
                "".to_string(),
                0,
                "".to_string(),
            )
        });
    let embedding_settings = config::get_embedding_settings().ok();
    let embedding_enabled = embedding_settings.as_ref().is_some_and(|settings| {
        settings.enabled && settings.provider != "disabled" && settings.provider != "none"
    });
    let embedding_key_configured = embedding_settings
        .as_ref()
        .is_some_and(|settings| settings.api_key_configured);
    let embedding_matches_config = embedding_settings.as_ref().is_some_and(|settings| {
        let dimension_matches = settings
            .expected_dimension
            .map(|dimension| embedding_dim == dimension as u32)
            .unwrap_or(embedding_dim > 0);
        chunk_count > 0
            && vector_count == chunk_count
            && embedding_enabled
            && embedding_provider == settings.provider
            && embedding_base_url == settings.base_url
            && embedding_model == settings.model
            && dimension_matches
    });
    let fts_ready = if has_fts_table(&conn)? {
        let fts_count = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks_fts WHERE book_id = ?1",
                params![book_id],
                |row| row.get::<_, u32>(0),
            )
            .context("failed to count FTS rows")?;
        fts_count == chunk_count
    } else {
        false
    };

    Ok(SearchIndexSummary {
        book_id: book_id.to_string(),
        embedding_provider,
        embedding_base_url,
        embedding_model,
        embedding_dim,
        embedding_last_error,
        embedding_enabled,
        embedding_key_configured,
        embedding_matches_config,
        chunk_count,
        vector_count,
        fts_ready,
    })
}

pub fn chunks_for_pages(
    db_path: &Path,
    book_id: &str,
    page_indexes: &[u32],
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let conn = open_database(db_path)?;
    if page_indexes.is_empty() {
        return Ok(Vec::new());
    }

    let mut hits = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
             FROM chunks
             WHERE book_id = ?1 AND page_index = ?2
             ORDER BY chunk_id
             LIMIT ?3",
        )
        .context("failed to prepare page chunk query")?;

    for page_index in page_indexes {
        let rows = stmt
            .query_map(params![book_id, page_index, limit.max(1)], |row| {
                let text: String = row.get(2)?;
                let rects = parse_rects_for_row(row.get(4)?, 4)?;
                Ok(SearchHit {
                    chunk_id: row.get(0)?,
                    page_index: row.get(1)?,
                    snippet: text.chars().take(180).collect(),
                    text,
                    markdown: row.get(3)?,
                    rects,
                    coordinate_version: row.get(5)?,
                    score: 0.0,
                })
            })
            .with_context(|| format!("failed to query chunks for page {}", page_index + 1))?;

        for hit in rows {
            hits.push(hit.context("failed to map page chunk")?);
            if hits.len() >= limit.max(1) as usize {
                return Ok(hits);
            }
        }
    }

    Ok(hits)
}

pub fn get_chunk(db_path: &Path, book_id: &str, chunk_id: &str) -> Result<Option<SearchHit>> {
    let conn = open_database(db_path)?;
    let resolved_chunk_id = resolve_chunk_id(&conn, book_id, chunk_id)?;
    conn.query_row(
        "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
         FROM chunks
         WHERE book_id = ?1 AND chunk_id = ?2",
        params![book_id, resolved_chunk_id],
        |row| {
            let text: String = row.get(2)?;
            let rects = parse_rects_for_row(row.get(4)?, 4)?;
            Ok(SearchHit {
                chunk_id: row.get(0)?,
                page_index: row.get(1)?,
                snippet: text.chars().take(180).collect(),
                text,
                markdown: row.get(3)?,
                rects,
                coordinate_version: row.get(5)?,
                score: 0.0,
            })
        },
    )
    .optional()
    .context("failed to fetch chunk")
}

pub fn get_neighbors(
    db_path: &Path,
    book_id: &str,
    chunk_id: &str,
    radius: u32,
) -> Result<Vec<SearchHit>> {
    let conn = open_database(db_path)?;
    let resolved_chunk_id = resolve_chunk_id(&conn, book_id, chunk_id)?;
    let (page_index, ordinal) = conn
        .query_row(
            "WITH ordered AS (
               SELECT chunk_id,
                      page_index,
                      ROW_NUMBER() OVER (ORDER BY page_index, id) AS ordinal
               FROM chunks
               WHERE book_id = ?1
             )
             SELECT page_index, ordinal
             FROM ordered
             WHERE chunk_id = ?2",
            params![book_id, resolved_chunk_id],
            |row| Ok((row.get::<_, u32>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .context("failed to locate chunk neighbors")?
        .ok_or_else(|| anyhow::anyhow!("chunk not found: {chunk_id}"))?;

    let mut stmt = conn
        .prepare(
            "WITH ordered AS (
               SELECT chunk_id,
                      page_index,
                      text,
                      markdown,
                      rects_json,
                      coordinate_version,
                      ROW_NUMBER() OVER (ORDER BY page_index, id) AS ordinal
               FROM chunks
               WHERE book_id = ?1
             )
             SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
             FROM ordered
             WHERE ordinal BETWEEN ?2 AND ?3
             ORDER BY ordinal",
        )
        .context("failed to prepare chunk neighbors query")?;
    let radius = i64::from(radius.min(8));
    let hits = stmt
        .query_map(
            params![book_id, ordinal - radius, ordinal + radius],
            |row| {
                let text: String = row.get(2)?;
                let rects = parse_rects_for_row(row.get(4)?, 4)?;
                Ok(SearchHit {
                    chunk_id: row.get(0)?,
                    page_index: row.get(1)?,
                    snippet: text.chars().take(180).collect(),
                    text,
                    markdown: row.get(3)?,
                    rects,
                    coordinate_version: row.get(5)?,
                    score: if row.get::<_, u32>(1)? == page_index {
                        0.0
                    } else {
                        0.1
                    },
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map chunk neighbors")?;
    Ok(hits)
}

pub fn list_structure(db_path: &Path, book_id: &str) -> Result<Vec<SearchHit>> {
    let conn = open_database(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
             FROM chunks
             WHERE book_id = ?1
             GROUP BY page_index
             ORDER BY page_index",
        )
        .context("failed to prepare structure query")?;
    let hits = stmt
        .query_map(params![book_id], |row| {
            let text: String = row.get(2)?;
            let rects = parse_rects_for_row(row.get(4)?, 4)?;
            Ok(SearchHit {
                chunk_id: row.get(0)?,
                page_index: row.get(1)?,
                snippet: text.chars().take(120).collect(),
                text,
                markdown: row.get(3)?,
                rects,
                coordinate_version: row.get(5)?,
                score: 0.0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map structure chunks")?;
    Ok(hits)
}

pub fn list_books(db_path: &Path) -> Result<Vec<StoredBookSummary>> {
    let conn = open_database(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT b.id,
                    b.title,
                    b.total_pages,
                    COUNT(DISTINCT c.id) AS chunk_count,
                    COALESCE(LENGTH(a.text), 0) AS text_char_count,
                    COALESCE(LENGTH(a.markdown), 0) AS markdown_char_count,
                    a.text_path,
                    a.markdown_path,
                    a.original_pdf_path,
                    a.source_pdf_path,
                    a.source_pdf_fingerprint,
                    b.parser_engine,
                    b.coordinate_mode,
                    b.quality_json,
                    strftime('%Y-%m-%dT%H:%M:%SZ', b.created_at) AS created_at
             FROM books b
             LEFT JOIN book_assets a ON a.book_id = b.id
             LEFT JOIN chunks c ON c.book_id = b.id
             GROUP BY b.id,
                      b.title,
                      b.total_pages,
                      b.parser_engine,
                      b.coordinate_mode,
                      b.created_at,
                      b.quality_json,
                      a.text_path,
                      a.markdown_path,
                      a.original_pdf_path,
                      a.source_pdf_path,
                      a.source_pdf_fingerprint
             ORDER BY b.created_at DESC",
        )
        .context("failed to prepare book list")?;

    let books = stmt
        .query_map([], |row| {
            Ok(StoredBookSummary {
                book_id: row.get(0)?,
                title: row.get(1)?,
                total_pages: row.get(2)?,
                chunk_count: row.get(3)?,
                text_char_count: row.get(4)?,
                markdown_char_count: row.get(5)?,
                text_path: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                markdown_path: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                original_pdf_path: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                source_pdf_path: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                source_pdf_fingerprint: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                parser_engine: row.get(11)?,
                coordinate_mode: row.get(12)?,
                quality: parse_quality(row.get(13)?).map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(
                        13,
                        rusqlite::types::Type::Text,
                        Box::new(err),
                    )
                })?,
                created_at: row.get(14)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map stored books")?;
    Ok(books)
}

pub fn get_converted_book(db_path: &Path, book_id: &str) -> Result<StoredBookAsset> {
    let conn = open_database(db_path)?;
    let (
        title,
        total_pages,
        parser_engine,
        coordinate_mode,
        quality,
        asset_text,
        asset_markdown,
        asset_text_path,
        asset_markdown_path,
        asset_original_pdf_path,
        asset_source_pdf_path,
        asset_source_pdf_fingerprint,
    ) = conn
        .query_row(
            "SELECT b.title,
                    b.total_pages,
                    b.parser_engine,
                    b.coordinate_mode,
                    b.quality_json,
                    a.text,
                    a.markdown,
                    a.text_path,
                    a.markdown_path,
                    a.original_pdf_path,
                    a.source_pdf_path,
                    a.source_pdf_fingerprint
             FROM books b
             LEFT JOIN book_assets a ON a.book_id = b.id
             WHERE b.id = ?1",
            params![book_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    parse_quality(row.get(4)?).map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(err),
                        )
                    })?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            },
        )
        .optional()
        .context("failed to fetch converted book asset")?
        .ok_or_else(|| anyhow::anyhow!("book not found: {book_id}"))?;

    let pages = fetch_pages(&conn, book_id)?;
    let chunks = fetch_chunks(&conn, book_id)?;
    let text = asset_text.unwrap_or_else(|| {
        pages
            .iter()
            .map(|page| page.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    });
    let markdown = asset_markdown.unwrap_or_else(|| {
        pages
            .iter()
            .map(|page| page.markdown.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    });

    Ok(StoredBookAsset {
        book_id: book_id.to_string(),
        title,
        total_pages,
        text,
        markdown,
        text_path: asset_text_path.unwrap_or_default(),
        markdown_path: asset_markdown_path.unwrap_or_default(),
        original_pdf_path: asset_original_pdf_path.unwrap_or_default(),
        source_pdf_path: asset_source_pdf_path.unwrap_or_default(),
        source_pdf_fingerprint: asset_source_pdf_fingerprint.unwrap_or_default(),
        parser_engine,
        coordinate_mode,
        quality,
        pages,
        chunks,
    })
}

pub fn find_book_by_source_pdf(
    db_path: &Path,
    source_pdf_path: &Path,
) -> Result<Option<StoredBookSummary>> {
    let Some(source) = source_pdf_metadata_for_path(source_pdf_path)? else {
        return Ok(None);
    };

    let books = list_books(db_path)?;
    for book in books {
        if !book.source_pdf_fingerprint.is_empty()
            && (book.source_pdf_fingerprint == source.fingerprint
                || book.source_pdf_fingerprint == source.legacy_fingerprint)
        {
            return Ok(Some(book));
        }

        if !book.source_pdf_path.is_empty() && same_source_path(&book.source_pdf_path, &source.path)
        {
            return Ok(Some(book));
        }

        if book.source_pdf_fingerprint.is_empty() && !book.original_pdf_path.is_empty() {
            if let Some(original_copy) =
                source_pdf_metadata_for_path(Path::new(&book.original_pdf_path))?
            {
                if original_copy.fingerprint == source.fingerprint {
                    return Ok(Some(book));
                }
            }
        }
    }

    Ok(None)
}

pub fn save_highlight(db_path: &Path, request: SaveHighlightRequest) -> Result<SavedHighlight> {
    let conn = open_database(db_path)?;
    let id = stable_highlight_id(&request);
    let rects_json = serde_json::to_string(&request.rects).context("failed to serialize rects")?;

    conn.execute(
        "INSERT INTO highlights(
           id,
           book_id,
           selection_text,
           prefix,
           suffix,
           page_index,
           position_start,
           position_end,
           rects_json,
           coordinate_version,
           interpretation,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           selection_text = excluded.selection_text,
           prefix = excluded.prefix,
           suffix = excluded.suffix,
           page_index = excluded.page_index,
           position_start = excluded.position_start,
           position_end = excluded.position_end,
           rects_json = excluded.rects_json,
           coordinate_version = excluded.coordinate_version,
           interpretation = excluded.interpretation",
        params![
            id,
            request.book_id,
            request.selection_text,
            request.prefix,
            request.suffix,
            request.page_index,
            request.position_start,
            request.position_end,
            rects_json,
            request.coordinate_version,
            request.interpretation
        ],
    )
    .context("failed to save highlight")?;

    get_highlight(&conn, &id)
}

pub fn list_highlights(db_path: &Path, book_id: &str) -> Result<Vec<SavedHighlight>> {
    let conn = open_database(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id,
                    book_id,
                    selection_text,
                    prefix,
                    suffix,
                    page_index,
                    position_start,
                    position_end,
                    rects_json,
                    coordinate_version,
                    interpretation,
                    created_at
             FROM highlights
             WHERE book_id = ?1
             ORDER BY created_at DESC",
        )
        .context("failed to prepare highlight list")?;

    let highlights = stmt
        .query_map(params![book_id], row_to_highlight)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map highlights")?;
    Ok(highlights)
}

pub fn delete_highlight(db_path: &Path, highlight_id: &str) -> Result<()> {
    let conn = open_database(db_path)?;
    conn.execute(
        "DELETE FROM highlights WHERE id = ?1",
        params![highlight_id],
    )
    .context("failed to delete highlight")?;
    Ok(())
}

pub fn save_interpretation(
    db_path: &Path,
    mut request: SaveInterpretationRequest,
) -> Result<SavedInterpretation> {
    let conn = open_database(db_path)?;
    request.evidence_chunk_ids = request
        .evidence_chunk_ids
        .iter()
        .map(|chunk_id| resolve_chunk_id(&conn, &request.book_id, chunk_id))
        .collect::<Result<Vec<_>>>()
        .context("failed to normalize interpretation evidence chunk ids")?;
    let id = stable_interpretation_id(&request);
    let session_id = request
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id.clone());
    let turn_index = request.turn_index.unwrap_or_else(|| {
        if request
            .question
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            1
        } else {
            0
        }
    });
    let page_indexes_json =
        serde_json::to_string(&request.page_indexes).context("failed to serialize page indexes")?;
    let evidence_json = serde_json::to_string(&request.evidence_chunk_ids)
        .context("failed to serialize evidence chunk ids")?;

    conn.execute(
        "INSERT INTO interpretations(
           id,
           book_id,
           selection_text,
           session_id,
           turn_index,
           prefix,
           suffix,
           page_index,
           position_start,
           position_end,
           page_indexes_json,
           evidence_chunk_ids_json,
           question,
           answer,
           answer_source,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, datetime('now'))",
        params![
            id,
            request.book_id,
            request.selection_text,
            session_id,
            turn_index,
            request.prefix,
            request.suffix,
            request.page_index,
            request.position_start,
            request.position_end,
            page_indexes_json,
            evidence_json,
            request.question,
            request.answer,
            request.answer_source.as_str()
        ],
    )
    .context("failed to save interpretation")?;

    get_interpretation(&conn, &id)
}

pub fn list_interpretations(db_path: &Path, book_id: &str) -> Result<Vec<SavedInterpretation>> {
    let conn = open_database(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id,
                    book_id,
                    selection_text,
                    session_id,
                    turn_index,
                    prefix,
                    suffix,
                    page_index,
                    position_start,
                    position_end,
                    page_indexes_json,
                    evidence_chunk_ids_json,
                    question,
                    answer,
                    answer_source,
                    created_at
             FROM interpretations
             WHERE book_id = ?1
             ORDER BY session_id DESC, turn_index ASC, created_at ASC",
        )
        .context("failed to prepare interpretation list")?;
    let interpretations = stmt
        .query_map(params![book_id], row_to_interpretation)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map interpretations")?;
    Ok(interpretations)
}

pub fn delete_interpretation(db_path: &Path, interpretation_id: &str) -> Result<()> {
    let conn = open_database(db_path)?;
    let session_id = conn
        .query_row(
            "SELECT COALESCE(NULLIF(session_id, ''), id) FROM interpretations WHERE id = ?1",
            params![interpretation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to find interpretation session")?;
    if let Some(session_id) = session_id {
        conn.execute(
            "DELETE FROM interpretations WHERE session_id = ?1 OR id = ?2",
            params![session_id, interpretation_id],
        )
        .context("failed to delete interpretation session")?;
        return Ok(());
    }
    conn.execute(
        "DELETE FROM interpretations WHERE id = ?1",
        params![interpretation_id],
    )
    .context("failed to delete interpretation")?;
    Ok(())
}

fn open_database(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create database directory {}", parent.display()))?;
    }

    let conn = Connection::open(path)
        .with_context(|| format!("failed to open SQLite database {}", path.display()))?;
    register_sqlite_functions(&conn)?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          total_pages INTEGER NOT NULL,
          parser_engine TEXT NOT NULL DEFAULT 'unknown',
          coordinate_mode TEXT NOT NULL DEFAULT 'text-only',
          quality_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pages (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          page_index INTEGER NOT NULL,
          text TEXT NOT NULL,
          markdown TEXT NOT NULL,
          PRIMARY KEY(book_id, page_index)
        );
        CREATE TABLE IF NOT EXISTS chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chunk_id TEXT NOT NULL,
          page_index INTEGER NOT NULL,
          text TEXT NOT NULL,
          markdown TEXT NOT NULL,
          rects_json TEXT NOT NULL DEFAULT '[]',
          coordinate_version INTEGER NOT NULL DEFAULT 1,
          UNIQUE(book_id, chunk_id)
        );
        CREATE TABLE IF NOT EXISTS book_assets (
          book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          markdown TEXT NOT NULL,
          text_path TEXT,
          markdown_path TEXT,
          original_pdf_path TEXT,
          source_pdf_path TEXT,
          source_pdf_fingerprint TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS embedding_indexes (
          book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          provider TEXT NOT NULL DEFAULT '',
          base_url TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL,
          dimension INTEGER NOT NULL,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunk_embeddings (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chunk_id TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          base_url TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL,
          dimension INTEGER NOT NULL,
          embedding_json TEXT NOT NULL,
          PRIMARY KEY(book_id, chunk_id, provider, model),
          FOREIGN KEY(book_id, chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS highlights (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          selection_text TEXT NOT NULL,
          prefix TEXT NOT NULL,
          suffix TEXT NOT NULL,
          page_index INTEGER,
          position_start INTEGER,
          position_end INTEGER,
          rects_json TEXT NOT NULL,
          coordinate_version INTEGER NOT NULL DEFAULT 1,
          interpretation TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS interpretations (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          selection_text TEXT NOT NULL,
          session_id TEXT NOT NULL DEFAULT '',
          turn_index INTEGER NOT NULL DEFAULT 0,
          prefix TEXT NOT NULL DEFAULT '',
          suffix TEXT NOT NULL DEFAULT '',
          page_index INTEGER,
          position_start INTEGER,
          position_end INTEGER,
          page_indexes_json TEXT NOT NULL,
          evidence_chunk_ids_json TEXT NOT NULL,
          question TEXT,
          answer TEXT NOT NULL,
          answer_source TEXT NOT NULL DEFAULT 'llm',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunk_id_aliases (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          legacy_chunk_id TEXT NOT NULL,
          chunk_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(book_id, legacy_chunk_id),
          FOREIGN KEY(book_id, chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
        USING fts5(chunk_id, book_id UNINDEXED, text, markdown);
        ",
    )
    .context("failed to initialize library schema")?;
    ensure_column(
        &conn,
        "highlights",
        "page_index",
        "ALTER TABLE highlights ADD COLUMN page_index INTEGER",
    )?;
    ensure_column(
        &conn,
        "highlights",
        "position_start",
        "ALTER TABLE highlights ADD COLUMN position_start INTEGER",
    )?;
    ensure_column(
        &conn,
        "highlights",
        "position_end",
        "ALTER TABLE highlights ADD COLUMN position_end INTEGER",
    )?;
    ensure_column(
        &conn,
        "books",
        "parser_engine",
        "ALTER TABLE books ADD COLUMN parser_engine TEXT NOT NULL DEFAULT 'unknown'",
    )?;
    ensure_column(
        &conn,
        "books",
        "coordinate_mode",
        "ALTER TABLE books ADD COLUMN coordinate_mode TEXT NOT NULL DEFAULT 'text-only'",
    )?;
    ensure_column(
        &conn,
        "books",
        "quality_json",
        "ALTER TABLE books ADD COLUMN quality_json TEXT",
    )?;
    ensure_column(
        &conn,
        "book_assets",
        "text_path",
        "ALTER TABLE book_assets ADD COLUMN text_path TEXT",
    )?;
    ensure_column(
        &conn,
        "book_assets",
        "markdown_path",
        "ALTER TABLE book_assets ADD COLUMN markdown_path TEXT",
    )?;
    ensure_column(
        &conn,
        "book_assets",
        "original_pdf_path",
        "ALTER TABLE book_assets ADD COLUMN original_pdf_path TEXT",
    )?;
    ensure_column(
        &conn,
        "book_assets",
        "source_pdf_path",
        "ALTER TABLE book_assets ADD COLUMN source_pdf_path TEXT",
    )?;
    ensure_column(
        &conn,
        "book_assets",
        "source_pdf_fingerprint",
        "ALTER TABLE book_assets ADD COLUMN source_pdf_fingerprint TEXT",
    )?;
    ensure_column(
        &conn,
        "chunks",
        "rects_json",
        "ALTER TABLE chunks ADD COLUMN rects_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        &conn,
        "chunks",
        "coordinate_version",
        "ALTER TABLE chunks ADD COLUMN coordinate_version INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        &conn,
        "highlights",
        "coordinate_version",
        "ALTER TABLE highlights ADD COLUMN coordinate_version INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        &conn,
        "embedding_indexes",
        "provider",
        "ALTER TABLE embedding_indexes ADD COLUMN provider TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "embedding_indexes",
        "base_url",
        "ALTER TABLE embedding_indexes ADD COLUMN base_url TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "embedding_indexes",
        "last_error",
        "ALTER TABLE embedding_indexes ADD COLUMN last_error TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "chunk_embeddings",
        "provider",
        "ALTER TABLE chunk_embeddings ADD COLUMN provider TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "chunk_embeddings",
        "base_url",
        "ALTER TABLE chunk_embeddings ADD COLUMN base_url TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "session_id",
        "ALTER TABLE interpretations ADD COLUMN session_id TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "turn_index",
        "ALTER TABLE interpretations ADD COLUMN turn_index INTEGER NOT NULL DEFAULT 0",
    )?;
    conn.execute(
        "UPDATE interpretations SET session_id = id WHERE session_id = ''",
        [],
    )
    .context("failed to backfill interpretation session ids")?;
    ensure_column(
        &conn,
        "interpretations",
        "prefix",
        "ALTER TABLE interpretations ADD COLUMN prefix TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "suffix",
        "ALTER TABLE interpretations ADD COLUMN suffix TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "page_index",
        "ALTER TABLE interpretations ADD COLUMN page_index INTEGER",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "position_start",
        "ALTER TABLE interpretations ADD COLUMN position_start INTEGER",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "position_end",
        "ALTER TABLE interpretations ADD COLUMN position_end INTEGER",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "answer_source",
        "ALTER TABLE interpretations ADD COLUMN answer_source TEXT NOT NULL DEFAULT 'llm'",
    )?;
    apply_schema_migrations(&conn)?;

    Ok(conn)
}

fn register_sqlite_functions(conn: &Connection) -> Result<()> {
    conn.create_scalar_function(
        "strip_legacy_chunk_citations",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let value: String = ctx.get(0)?;
            Ok(strip_legacy_chunk_citations(&value))
        },
    )
    .context("failed to register SQLite strip_legacy_chunk_citations function")
}

fn strip_legacy_chunk_citations(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let chars = value.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '[' || chars[index] == '【' {
            let closing = if chars[index] == '[' { ']' } else { '】' };
            if let Some(close_offset) = chars[index + 1..]
                .iter()
                .take(80)
                .position(|ch| *ch == closing)
            {
                let close_index = index + 1 + close_offset;
                let candidate = chars[index + 1..close_index].iter().collect::<String>();
                if chunk_id::is_legacy_chunk_id(candidate.trim()) {
                    index = close_index + 1;
                    continue;
                }
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

const SCHEMA_VERSION: u32 = chunk_id::NAMESPACED_CHUNK_ID_VERSION;

fn apply_schema_migrations(conn: &Connection) -> Result<()> {
    let current = schema_user_version(conn)?;
    if current < chunk_id::LEGACY_CHUNK_ID_VERSION {
        set_schema_user_version(conn, chunk_id::LEGACY_CHUNK_ID_VERSION)?;
    }
    if current < SCHEMA_VERSION {
        migrate_chunk_ids_v2(conn)?;
        set_schema_user_version(conn, SCHEMA_VERSION)?;
    }
    Ok(())
}

fn schema_user_version(conn: &Connection) -> Result<u32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
        .context("failed to read schema user_version")
}

fn set_schema_user_version(conn: &Connection, version: u32) -> Result<()> {
    conn.pragma_update(None, "user_version", version)
        .with_context(|| format!("failed to set schema user_version to {version}"))
}

fn migrate_chunk_ids_v2(conn: &Connection) -> Result<()> {
    ensure_chunk_alias_table(conn)?;
    let book_ids = conn
        .prepare("SELECT id FROM books")
        .context("failed to prepare book id query for chunk id migration")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read book ids for chunk id migration")?;
    for book_id in book_ids {
        migrate_book_chunk_ids_v2(conn, &book_id)?;
        rebuild_fts(conn, &book_id)?;
    }
    Ok(())
}

fn ensure_chunk_alias_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS chunk_id_aliases (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          legacy_chunk_id TEXT NOT NULL,
          chunk_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(book_id, legacy_chunk_id),
          FOREIGN KEY(book_id, chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
        );
        ",
    )
    .context("failed to ensure chunk id alias table")
}

fn migrate_book_chunk_ids_v2(conn: &Connection, book_id: &str) -> Result<()> {
    let rows = conn
        .prepare(
            "SELECT id, chunk_id, page_index, text, markdown
             FROM chunks
             WHERE book_id = ?1
             ORDER BY page_index, id",
        )
        .context("failed to prepare chunk id migration rows")?
        .query_map(params![book_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read chunk id migration rows")?;
    let namespace = chunk_id::book_namespace(book_id);
    if rows.is_empty()
        || rows
            .iter()
            .all(|(_, chunk_id, _, _, _)| chunk_id_uses_namespace(chunk_id, &namespace))
    {
        normalize_interpretation_evidence_ids(conn, book_id)?;
        return Ok(());
    }

    let mut page_counts: HashMap<u32, u32> = HashMap::new();
    let mut aliases = Vec::new();
    for (row_id, old_chunk_id, page_index, text, markdown) in rows {
        let chunk_index = page_counts.entry(page_index).or_insert(0);
        let current_chunk_index = *chunk_index;
        *chunk_index += 1;
        if chunk_id_uses_namespace(&old_chunk_id, &namespace) {
            continue;
        }
        let new_chunk_id =
            chunk_id::make_chunk_id(&namespace, page_index, current_chunk_index, &text);
        let new_markdown =
            chunk_id::rewrite_chunk_markdown(&markdown, &old_chunk_id, &new_chunk_id);
        let embedding_rows = read_chunk_embedding_rows(conn, book_id, &old_chunk_id)?;
        if !embedding_rows.is_empty() {
            conn.execute(
                "DELETE FROM chunk_embeddings WHERE book_id = ?1 AND chunk_id = ?2",
                params![book_id, old_chunk_id],
            )
            .context("failed to stage chunk embedding ids for migration")?;
        }
        conn.execute(
            "UPDATE chunks SET chunk_id = ?1, markdown = ?2 WHERE id = ?3",
            params![new_chunk_id, new_markdown, row_id],
        )
        .with_context(|| format!("failed to migrate chunk id {old_chunk_id}"))?;
        for embedding in embedding_rows {
            insert_chunk_embedding_row(conn, book_id, &new_chunk_id, &embedding)
                .context("failed to restore migrated chunk embedding")?;
        }
        conn.execute(
            "INSERT OR REPLACE INTO chunk_id_aliases(book_id, legacy_chunk_id, chunk_id)
             VALUES (?1, ?2, ?3)",
            params![book_id, old_chunk_id, new_chunk_id],
        )
        .context("failed to record chunk id alias")?;
        aliases.push((old_chunk_id, new_chunk_id));
    }

    for (old_chunk_id, new_chunk_id) in aliases {
        migrate_interpretation_evidence_ids(conn, book_id, &old_chunk_id, &new_chunk_id)?;
    }
    normalize_interpretation_evidence_ids(conn, book_id)?;
    Ok(())
}

#[derive(Debug)]
struct ChunkEmbeddingRow {
    provider: String,
    base_url: String,
    model: String,
    dimension: u32,
    embedding_json: String,
}

fn read_chunk_embedding_rows(
    conn: &Connection,
    book_id: &str,
    chunk_id: &str,
) -> Result<Vec<ChunkEmbeddingRow>> {
    conn.prepare(
        "SELECT provider, base_url, model, dimension, embedding_json
         FROM chunk_embeddings
         WHERE book_id = ?1 AND chunk_id = ?2",
    )
    .context("failed to prepare chunk embedding migration rows")?
    .query_map(params![book_id, chunk_id], |row| {
        Ok(ChunkEmbeddingRow {
            provider: row.get(0)?,
            base_url: row.get(1)?,
            model: row.get(2)?,
            dimension: row.get(3)?,
            embedding_json: row.get(4)?,
        })
    })?
    .collect::<rusqlite::Result<Vec<_>>>()
    .context("failed to read chunk embedding migration rows")
}

fn insert_chunk_embedding_row(
    conn: &Connection,
    book_id: &str,
    chunk_id: &str,
    row: &ChunkEmbeddingRow,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO chunk_embeddings(
           book_id,
           chunk_id,
           provider,
           base_url,
           model,
           dimension,
           embedding_json
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            book_id,
            chunk_id,
            row.provider.as_str(),
            row.base_url.as_str(),
            row.model.as_str(),
            row.dimension,
            row.embedding_json.as_str()
        ],
    )
    .context("failed to insert chunk embedding migration row")?;
    Ok(())
}

fn migrate_interpretation_evidence_ids(
    conn: &Connection,
    book_id: &str,
    old_chunk_id: &str,
    new_chunk_id: &str,
) -> Result<()> {
    let rows = conn
        .prepare(
            "SELECT id, evidence_chunk_ids_json
             FROM interpretations
             WHERE book_id = ?1 AND evidence_chunk_ids_json LIKE ?2",
        )
        .context("failed to prepare interpretation evidence migration rows")?
        .query_map(params![book_id, format!("%{old_chunk_id}%")], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read interpretation evidence rows")?;
    for (interpretation_id, evidence_json) in rows {
        let mut evidence_ids = serde_json::from_str::<Vec<String>>(&evidence_json)
            .context("failed to parse interpretation evidence chunk ids")?;
        let mut changed = false;
        for chunk_id in &mut evidence_ids {
            if chunk_id == old_chunk_id {
                *chunk_id = new_chunk_id.to_string();
                changed = true;
            }
        }
        if changed {
            let updated_json = serde_json::to_string(&evidence_ids)
                .context("failed to serialize migrated interpretation evidence ids")?;
            conn.execute(
                "UPDATE interpretations SET evidence_chunk_ids_json = ?1 WHERE id = ?2",
                params![updated_json, interpretation_id],
            )
            .context("failed to update migrated interpretation evidence ids")?;
        }
    }
    Ok(())
}

fn normalize_interpretation_evidence_ids(conn: &Connection, book_id: &str) -> Result<()> {
    let rows = conn
        .prepare(
            "SELECT id, evidence_chunk_ids_json
             FROM interpretations
             WHERE book_id = ?1",
        )
        .context("failed to prepare interpretation evidence normalization rows")?
        .query_map(params![book_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read interpretation evidence normalization rows")?;

    for (interpretation_id, evidence_json) in rows {
        let evidence_ids = serde_json::from_str::<Vec<String>>(&evidence_json)
            .context("failed to parse interpretation evidence chunk ids for normalization")?;
        let resolved_ids = evidence_ids
            .iter()
            .map(|chunk_id| resolve_chunk_id(conn, book_id, chunk_id))
            .collect::<Result<Vec<_>>>()
            .context("failed to resolve interpretation evidence chunk ids for normalization")?;
        if resolved_ids != evidence_ids {
            let updated_json = serde_json::to_string(&resolved_ids)
                .context("failed to serialize normalized interpretation evidence ids")?;
            conn.execute(
                "UPDATE interpretations SET evidence_chunk_ids_json = ?1 WHERE id = ?2",
                params![updated_json, interpretation_id],
            )
            .context("failed to update normalized interpretation evidence ids")?;
        }
    }
    Ok(())
}

fn normalize_book_chunk_ids(
    mut request: SaveBookRequest,
    book_id: &str,
) -> (SaveBookRequest, Vec<(String, String)>) {
    let namespace = chunk_id::book_namespace(book_id);
    let mut aliases = Vec::new();
    for index in 0..request.chunks.len() {
        if chunk_id_uses_namespace(&request.chunks[index].chunk_id, &namespace) {
            continue;
        }
        let chunk_index = chunk_index_within_page(&request.chunks, index);
        let old_chunk_id = request.chunks[index].chunk_id.clone();
        let new_chunk_id = chunk_id::make_chunk_id(
            &namespace,
            request.chunks[index].page_index,
            chunk_index,
            &request.chunks[index].text,
        );
        request.chunks[index].markdown = chunk_id::rewrite_chunk_markdown(
            &request.chunks[index].markdown,
            &old_chunk_id,
            &new_chunk_id,
        );
        request.chunks[index].chunk_id = new_chunk_id;
        aliases.push((old_chunk_id, request.chunks[index].chunk_id.clone()));
    }
    (request, aliases)
}

fn existing_chunk_id_aliases(conn: &Connection, book_id: &str) -> Result<Vec<(String, String)>> {
    conn.prepare(
        "SELECT chunk_id, legacy_chunk_id
         FROM chunk_id_aliases
         WHERE book_id = ?1",
    )
    .context("failed to prepare existing chunk id aliases")?
    .query_map(params![book_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?
    .collect::<rusqlite::Result<Vec<_>>>()
    .context("failed to read existing chunk id aliases")
}

fn rebind_existing_chunk_aliases(
    existing_aliases: &[(String, String)],
    chunks: &[ParsedChunkInput],
) -> Vec<(String, String)> {
    existing_aliases
        .iter()
        .filter_map(|(old_chunk_id, legacy_chunk_id)| {
            resolve_chunk_id_from_inputs(chunks, old_chunk_id)
                .filter(|chunk_id| chunk_id != old_chunk_id)
                .map(|chunk_id| (legacy_chunk_id.clone(), chunk_id))
        })
        .collect()
}

fn chunk_id_uses_namespace(chunk_id: &str, namespace: &str) -> bool {
    chunk_id::is_namespaced_chunk_id(chunk_id)
        && chunk_id
            .to_ascii_lowercase()
            .starts_with(&format!("{}-", namespace.to_ascii_lowercase()))
}

fn chunk_index_within_page(chunks: &[ParsedChunkInput], index: usize) -> u32 {
    let page_index = chunks[index].page_index;
    chunks[..index]
        .iter()
        .filter(|chunk| chunk.page_index == page_index)
        .count() as u32
}

fn resolve_chunk_id_from_inputs(chunks: &[ParsedChunkInput], chunk_id: &str) -> Option<String> {
    let locator = chunk_id::locator_from_chunk_id(chunk_id)?;
    let candidates = chunks
        .iter()
        .filter(|chunk| chunk.page_index == locator.page_number.saturating_sub(1))
        .collect::<Vec<_>>();
    if let Some(content_hash) = locator.content_hash {
        let exact_hash_candidates = candidates
            .iter()
            .filter(|chunk| {
                chunk_id::locator_from_chunk_id(&chunk.chunk_id)
                    .and_then(|locator| locator.content_hash)
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(&content_hash))
            })
            .collect::<Vec<_>>();
        if exact_hash_candidates.len() == 1 {
            return Some(exact_hash_candidates[0].chunk_id.clone());
        }
        return candidates
            .get(locator.chunk_number.saturating_sub(1) as usize)
            .map(|chunk| chunk.chunk_id.clone());
    }
    candidates
        .get(locator.chunk_number.saturating_sub(1) as usize)
        .map(|chunk| chunk.chunk_id.clone())
}

fn resolve_chunk_id_by_locator(
    conn: &Connection,
    book_id: &str,
    chunk_id: &str,
) -> Result<Option<String>> {
    let Some(locator) = chunk_id::locator_from_chunk_id(chunk_id) else {
        return Ok(None);
    };
    let page_index = locator.page_number.saturating_sub(1);
    let candidates = conn
        .prepare(
            "SELECT chunk_id
             FROM chunks
             WHERE book_id = ?1 AND page_index = ?2
             ORDER BY id",
        )
        .context("failed to prepare chunk locator resolution rows")?
        .query_map(params![book_id, page_index], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read chunk locator resolution rows")?;
    let index = locator.chunk_number.saturating_sub(1) as usize;
    if let Some(content_hash) = locator.content_hash {
        let exact_hash_candidates = candidates
            .iter()
            .filter(|candidate| {
                chunk_id::locator_from_chunk_id(candidate)
                    .and_then(|locator| locator.content_hash)
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(&content_hash))
            })
            .collect::<Vec<_>>();
        if exact_hash_candidates.len() == 1 {
            return Ok(exact_hash_candidates
                .first()
                .map(|chunk_id| (*chunk_id).clone()));
        }
        return Ok(candidates.get(index).cloned());
    }
    Ok(candidates.get(index).cloned())
}

fn resolve_chunk_id(conn: &Connection, book_id: &str, chunk_id: &str) -> Result<String> {
    let resolved = conn
        .query_row(
            "SELECT chunk_id FROM chunk_id_aliases WHERE book_id = ?1 AND legacy_chunk_id = ?2",
            params![book_id, chunk_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to resolve legacy chunk id alias")?;
    if let Some(resolved) = resolved {
        return Ok(resolved);
    }
    if let Some(resolved) = resolve_chunk_id_by_locator(conn, book_id, chunk_id)? {
        return Ok(resolved);
    }
    Ok(chunk_id.to_string())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, sql: &str) -> Result<()> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .with_context(|| format!("failed to inspect table {table}"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .with_context(|| format!("failed to read columns for table {table}"))?
        .iter()
        .any(|name| name == column);
    if !exists {
        conn.execute(sql, [])
            .with_context(|| format!("failed to add column {table}.{column}"))?;
    }
    Ok(())
}

fn parse_quality(
    value: Option<String>,
) -> std::result::Result<Option<TextQuality>, serde_json::Error> {
    value
        .filter(|quality_json| !quality_json.trim().is_empty())
        .map(|quality_json| serde_json::from_str(&quality_json))
        .transpose()
}

struct SourcePdfMetadata {
    path: String,
    fingerprint: String,
    legacy_fingerprint: String,
}

struct TextAssetPaths {
    asset_dir: PathBuf,
    text_path: PathBuf,
    markdown_path: PathBuf,
    original_pdf_path: Option<PathBuf>,
}

fn write_book_assets(
    db_path: &Path,
    book_id: &str,
    title: &str,
    text: &str,
    source_asset_dirs: &[PathBuf],
    source_pdf_path: Option<&str>,
) -> Result<TextAssetPaths> {
    let asset_dir = converted_book_asset_dir(db_path, book_id);
    fs::create_dir_all(&asset_dir).with_context(|| {
        format!(
            "failed to create converted text asset directory {}",
            asset_dir.display()
        )
    })?;

    let file_stem = safe_asset_name(title);
    let text_path = asset_dir.join(format!("{file_stem}.txt"));
    let markdown_path = asset_dir.join(format!("{file_stem}.md"));
    fs::write(&text_path, text)
        .with_context(|| format!("failed to write text asset {}", text_path.display()))?;
    fs::write(&markdown_path, "").with_context(|| {
        format!(
            "failed to initialize markdown asset {}",
            markdown_path.display()
        )
    })?;
    for source_asset_dir in source_asset_dirs
        .iter()
        .filter(|path| path.exists() && path.is_dir())
    {
        copy_mineru_asset_resources(source_asset_dir, &asset_dir)?;
    }
    let original_pdf_path = source_pdf_path
        .filter(|path| !path.trim().is_empty())
        .map(Path::new)
        .filter(|path| path.exists())
        .map(|source| {
            let target = asset_dir.join(format!("{file_stem}.pdf"));
            fs::copy(source, &target).with_context(|| {
                format!(
                    "failed to copy source PDF {} to {}",
                    source.display(),
                    target.display()
                )
            })?;
            Ok::<PathBuf, anyhow::Error>(target)
        })
        .transpose()?;

    Ok(TextAssetPaths {
        asset_dir,
        text_path,
        markdown_path,
        original_pdf_path,
    })
}

fn copy_mineru_asset_resources(source_dir: &Path, asset_dir: &Path) -> Result<()> {
    for entry in fs::read_dir(source_dir).with_context(|| {
        format!(
            "failed to read MinerU asset directory {}",
            source_dir.display()
        )
    })? {
        let entry = entry.with_context(|| {
            format!(
                "failed to read MinerU asset directory entry {}",
                source_dir.display()
            )
        })?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if matches!(file_name, "layout.json" | "full.md" | "origin.pdf") {
            continue;
        }
        let target = asset_dir.join(file_name);
        copy_asset_entry(&path, &target)?;
    }
    Ok(())
}

fn copy_asset_entry(source: &Path, target: &Path) -> Result<()> {
    if source.is_dir() {
        fs::create_dir_all(target)
            .with_context(|| format!("failed to create asset directory {}", target.display()))?;
        for entry in fs::read_dir(source)
            .with_context(|| format!("failed to read asset directory {}", source.display()))?
        {
            let entry = entry.with_context(|| {
                format!("failed to read asset directory entry {}", source.display())
            })?;
            copy_asset_entry(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if source.is_file() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create asset directory {}", parent.display())
            })?;
        }
        fs::copy(source, target).with_context(|| {
            format!(
                "failed to copy MinerU asset {} to {}",
                source.display(),
                target.display()
            )
        })?;
    }
    Ok(())
}

fn rewrite_book_markdown_asset_paths(
    request: &mut SaveBookRequest,
    source_asset_dirs: &[PathBuf],
    asset_dir: &Path,
) {
    if source_asset_dirs.is_empty() {
        return;
    }
    for page in &mut request.pages {
        page.markdown = rewrite_markdown_asset_paths(&page.markdown, source_asset_dirs, asset_dir);
    }
    for chunk in &mut request.chunks {
        chunk.markdown =
            rewrite_markdown_asset_paths(&chunk.markdown, source_asset_dirs, asset_dir);
    }
}

fn rewrite_markdown_asset_paths(
    markdown: &str,
    source_asset_dirs: &[PathBuf],
    asset_dir: &Path,
) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    while let Some(relative_start) = markdown[cursor..].find("](") {
        let start = cursor + relative_start;
        output.push_str(&markdown[cursor..start + 2]);
        let path_start = start + 2;
        let Some(relative_end) = markdown[path_start..].find(')') else {
            output.push_str(&markdown[path_start..]);
            return output;
        };
        let path_end = path_start + relative_end;
        let raw_path = &markdown[path_start..path_end];
        output.push_str(&rewrite_markdown_link_path(
            raw_path,
            source_asset_dirs,
            asset_dir,
        ));
        output.push(')');
        cursor = path_end + 1;
    }
    output.push_str(&markdown[cursor..]);
    output
}

fn rewrite_markdown_link_path(
    raw_path: &str,
    source_asset_dirs: &[PathBuf],
    asset_dir: &Path,
) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("file:")
    {
        return raw_path.to_string();
    }
    let path_without_title = trimmed.split_whitespace().next().unwrap_or(trimmed);
    let Some(relative_path) = safe_relative_markdown_path(path_without_title) else {
        return raw_path.to_string();
    };
    let target_candidate = asset_dir.join(&relative_path);
    let source_exists = source_asset_dirs
        .iter()
        .any(|source_asset_dir| source_asset_dir.join(&relative_path).exists());
    let display_path = if target_candidate.exists() || source_exists {
        target_candidate
    } else {
        return raw_path.to_string();
    };
    path_to_file_url(&display_path)
}

fn normalized_source_asset_dirs(request: &SaveBookRequest) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for value in request
        .source_asset_dir
        .as_deref()
        .into_iter()
        .chain(request.source_asset_dirs.iter().map(String::as_str))
    {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(trimmed);
        if !paths.iter().any(|path| path == &candidate) {
            paths.push(candidate);
        }
    }
    paths
}

fn safe_relative_markdown_path(value: &str) -> Option<PathBuf> {
    let decoded = value.replace("%20", " ");
    let path = Path::new(&decoded);
    if path.is_absolute() {
        return None;
    }
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => output.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if output.as_os_str().is_empty() {
        None
    } else {
        Some(output)
    }
}

fn path_to_file_url(path: &Path) -> String {
    let absolute = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    format!("file://{}", absolute.to_string_lossy().replace(' ', "%20"))
}

fn source_pdf_metadata(source_pdf_path: Option<&str>) -> Result<Option<SourcePdfMetadata>> {
    source_pdf_path
        .filter(|path| !path.trim().is_empty())
        .map(Path::new)
        .map(source_pdf_metadata_for_path)
        .transpose()
        .map(|metadata| metadata.flatten())
}

fn source_pdf_metadata_for_path(path: &Path) -> Result<Option<SourcePdfMetadata>> {
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect source PDF {}", path.display()))?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(Some(SourcePdfMetadata {
        path: canonical.to_string_lossy().to_string(),
        fingerprint: source_file_fingerprint(&canonical, metadata.len())?,
        legacy_fingerprint: legacy_source_file_fingerprint(&canonical, metadata.len())?,
    }))
}

fn source_file_fingerprint(path: &Path, len: u64) -> Result<String> {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut file = fs::File::open(path)
        .with_context(|| format!("failed to open source PDF {}", path.display()))?;
    let mut hash = FNV_OFFSET;
    for byte in len.to_le_bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("failed to hash source PDF {}", path.display()))?;
        if read == 0 {
            break;
        }
        for byte in &buffer[..read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
    }
    Ok(format!("pdf-fnv1a64-{hash:016x}"))
}

fn legacy_source_file_fingerprint(path: &Path, len: u64) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("failed to open source PDF {}", path.display()))?;
    let mut hasher = DefaultHasher::new();
    len.hash(&mut hasher);
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("failed to hash source PDF {}", path.display()))?;
        if read == 0 {
            break;
        }
        buffer[..read].hash(&mut hasher);
    }
    Ok(format!("pdf-{:016x}", hasher.finish()))
}

fn same_source_path(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    let left_path = Path::new(left);
    let right_path = Path::new(right);
    let left_canonical = left_path
        .canonicalize()
        .unwrap_or_else(|_| left_path.to_path_buf());
    let right_canonical = right_path
        .canonicalize()
        .unwrap_or_else(|_| right_path.to_path_buf());
    left_canonical == right_canonical
}

fn converted_book_asset_dir(db_path: &Path, book_id: &str) -> PathBuf {
    let base_dir = db_path.parent().unwrap_or_else(|| Path::new("."));
    base_dir.join("converted-books").join(book_id)
}

fn safe_asset_name(title: &str) -> String {
    let candidate = title
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if candidate.is_empty() {
        "converted-book".to_string()
    } else {
        candidate
    }
}

fn fetch_pages(conn: &Connection, book_id: &str) -> Result<Vec<ParsedPageInput>> {
    let mut stmt = conn
        .prepare(
            "SELECT page_index, text, markdown
             FROM pages
             WHERE book_id = ?1
             ORDER BY page_index",
        )
        .context("failed to prepare converted pages query")?;
    let pages = stmt
        .query_map(params![book_id], |row| {
            Ok(ParsedPageInput {
                page_index: row.get(0)?,
                text: row.get(1)?,
                markdown: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map converted pages")?;
    Ok(pages)
}

fn fetch_chunks(conn: &Connection, book_id: &str) -> Result<Vec<ParsedChunkInput>> {
    let mut stmt = conn
        .prepare(
            "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
             FROM chunks
             WHERE book_id = ?1
             ORDER BY page_index, id",
        )
        .context("failed to prepare converted chunks query")?;
    let chunks = stmt
        .query_map(params![book_id], |row| {
            Ok(ParsedChunkInput {
                chunk_id: row.get(0)?,
                page_index: row.get(1)?,
                text: row.get(2)?,
                markdown: row.get(3)?,
                rects: parse_rects_for_row(row.get(4)?, 4)?,
                coordinate_version: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map converted chunks")?;
    Ok(chunks)
}

fn rebuild_fts(conn: &Connection, book_id: &str) -> Result<()> {
    if !has_fts_table(conn)? {
        return Ok(());
    }

    clear_fts_for_book(conn, book_id)?;
    conn.execute(
        "INSERT INTO chunks_fts(rowid, chunk_id, book_id, text, markdown)
         SELECT id, chunk_id, book_id, text, strip_legacy_chunk_citations(markdown)
         FROM chunks
         WHERE book_id = ?1",
        params![book_id],
    )
    .context("failed to insert FTS rows")?;
    Ok(())
}

fn rebuild_embeddings(conn: &Connection, book_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM chunk_embeddings WHERE book_id = ?1",
        params![book_id],
    )
    .context("failed to clear old chunk embeddings")?;
    conn.execute(
        "DELETE FROM embedding_indexes WHERE book_id = ?1",
        params![book_id],
    )
    .context("failed to clear old embedding metadata")?;

    let chunks = fetch_chunks(conn, book_id)?;
    let inputs = chunks
        .iter()
        .map(|chunk| format!("{}\n{}", chunk.text, chunk.markdown))
        .collect::<Vec<_>>();
    if inputs.is_empty() {
        return Ok(());
    }
    let Some(batch) =
        embeddings::embed_texts(&inputs).context("failed to call embedding provider")?
    else {
        return Ok(());
    };
    if batch.vectors.is_empty() {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO embedding_indexes(book_id, provider, base_url, model, dimension, last_error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET
           provider = excluded.provider,
           base_url = excluded.base_url,
           model = excluded.model,
           dimension = excluded.dimension,
           last_error = '',
           created_at = excluded.created_at",
        params![
            book_id,
            batch.provider,
            batch.base_url,
            batch.model,
            batch.dimension as u32
        ],
    )
    .context("failed to upsert embedding index metadata")?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO chunk_embeddings(book_id, chunk_id, provider, base_url, model, dimension, embedding_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .context("failed to prepare embedding insert")?;
    for (chunk, embedding) in chunks.iter().zip(batch.vectors.iter()) {
        let embedding_json =
            serde_json::to_string(embedding).context("failed to serialize embedding")?;
        stmt.execute(params![
            book_id,
            chunk.chunk_id,
            batch.provider,
            batch.base_url,
            batch.model,
            batch.dimension as u32,
            embedding_json
        ])
        .with_context(|| format!("failed to insert embedding for {}", chunk.chunk_id))?;
    }

    Ok(())
}

fn record_embedding_error(conn: &Connection, book_id: &str, error: &str) -> Result<()> {
    let settings = config::get_embedding_settings().ok();
    let provider = settings
        .as_ref()
        .map(|settings| settings.provider.clone())
        .unwrap_or_default();
    let base_url = settings
        .as_ref()
        .map(|settings| settings.base_url.clone())
        .unwrap_or_default();
    let model = settings
        .as_ref()
        .map(|settings| settings.model.clone())
        .unwrap_or_default();
    let dimension = settings
        .and_then(|settings| settings.expected_dimension)
        .unwrap_or_default() as u32;
    let error = error.chars().take(500).collect::<String>();

    conn.execute(
        "INSERT INTO embedding_indexes(book_id, provider, base_url, model, dimension, last_error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET
           provider = excluded.provider,
           base_url = excluded.base_url,
           model = excluded.model,
           dimension = excluded.dimension,
           last_error = excluded.last_error,
           created_at = excluded.created_at",
        params![book_id, provider, base_url, model, dimension, error],
    )
    .context("failed to record embedding rebuild error")?;
    Ok(())
}

fn clear_fts_for_book(conn: &Connection, book_id: &str) -> Result<()> {
    if !has_fts_table(conn)? {
        return Ok(());
    }

    conn.execute(
        "DELETE FROM chunks_fts WHERE book_id = ?1",
        params![book_id],
    )
    .context("failed to delete FTS rows")?;
    Ok(())
}

fn has_fts_table(conn: &Connection) -> Result<bool> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'",
            [],
            |_| Ok(true),
        )
        .optional()
        .context("failed to inspect FTS table")?
        .unwrap_or(false);
    Ok(exists)
}

fn fallback_search(
    conn: &Connection,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect();

    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
             FROM chunks
             WHERE book_id = ?1",
        )
        .context("failed to prepare fallback search")?;
    let mut rows = stmt
        .query(params![book_id])
        .context("failed to query chunks")?;
    let mut hits = Vec::new();

    while let Some(row) = rows.next().context("failed to read chunk row")? {
        let text: String = row.get(2)?;
        let markdown: String = row.get(3)?;
        let rects = parse_rects(row.get(4)?).context("failed to parse chunk rects")?;
        let coordinate_version = row.get(5)?;
        let haystack = format!("{}\n{}", text, markdown).to_lowercase();
        let score: f64 = terms
            .iter()
            .map(|term| haystack.matches(term).count() as f64)
            .sum();

        if score > 0.0 {
            hits.push(SearchHit {
                chunk_id: row.get(0)?,
                page_index: row.get(1)?,
                snippet: make_plain_snippet(&text, &terms),
                text,
                markdown,
                rects,
                coordinate_version,
                score,
            });
        }
    }

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(limit.max(1) as usize);
    Ok(hits)
}

fn vector_search(
    conn: &Connection,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let (provider, base_url, model, dimension, last_error) = match conn
        .query_row(
            "SELECT provider, base_url, model, dimension, last_error FROM embedding_indexes WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                ))
            },
        )
        .optional()
        .context("failed to fetch embedding metadata")?
    {
        Some(metadata) => metadata,
        None => return Ok(Vec::new()),
    };
    if !last_error.trim().is_empty() {
        return Ok(Vec::new());
    }
    let Some(batch) = embeddings::embed_texts(&[query.to_string()])
        .context("failed to call embedding provider for query")?
    else {
        return Ok(Vec::new());
    };
    if batch.provider != provider
        || batch.base_url != base_url
        || batch.model != model
        || batch.dimension != dimension as usize
    {
        return Ok(Vec::new());
    }
    let Some(query_embedding) = batch.vectors.first() else {
        return Ok(Vec::new());
    };
    let mut stmt = conn
        .prepare(
            "SELECT c.chunk_id,
                    c.page_index,
                    c.text,
                    c.markdown,
                    c.rects_json,
                    c.coordinate_version,
                    e.embedding_json
             FROM chunk_embeddings e
             JOIN chunks c ON c.book_id = e.book_id AND c.chunk_id = e.chunk_id
             WHERE e.book_id = ?1
               AND e.provider = ?2
               AND e.base_url = ?3
               AND e.model = ?4
               AND e.dimension = ?5",
        )
        .context("failed to prepare vector search")?;
    let mut rows = stmt
        .query(params![book_id, provider, base_url, model, dimension])
        .context("failed to query vector rows")?;
    let mut hits = Vec::new();

    while let Some(row) = rows.next().context("failed to read vector row")? {
        let text: String = row.get(2)?;
        let rects = parse_rects(row.get(4)?).context("failed to parse chunk rects")?;
        let coordinate_version = row.get(5)?;
        let embedding_json: String = row.get(6)?;
        let embedding: Vec<f32> =
            serde_json::from_str(&embedding_json).context("failed to parse embedding JSON")?;
        if embedding.len() != dimension as usize {
            continue;
        }
        let similarity = cosine_similarity(query_embedding, &embedding);
        if similarity <= 0.0 {
            continue;
        }
        hits.push(SearchHit {
            chunk_id: row.get(0)?,
            page_index: row.get(1)?,
            snippet: text.chars().take(180).collect(),
            text,
            markdown: row.get(3)?,
            rects,
            coordinate_version,
            score: similarity,
        });
    }

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
    hits.truncate(limit.max(1) as usize);
    Ok(hits)
}

fn fuse_search_hits(
    fts_hits: Vec<SearchHit>,
    vector_hits: Vec<SearchHit>,
    limit: u32,
) -> Vec<SearchHit> {
    let mut scores: HashMap<String, (f64, SearchHit)> = HashMap::new();
    add_rank_scores(&mut scores, fts_hits, 1.15);
    add_rank_scores(&mut scores, vector_hits, 1.0);

    let mut fused = scores
        .into_values()
        .map(|(score, mut hit)| {
            hit.score = score;
            hit
        })
        .collect::<Vec<_>>();
    fused.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
    fused.truncate(limit.max(1) as usize);
    fused
}

fn add_rank_scores(
    scores: &mut HashMap<String, (f64, SearchHit)>,
    hits: Vec<SearchHit>,
    weight: f64,
) {
    for (index, hit) in hits.into_iter().enumerate() {
        let rank_score = weight / (60.0 + index as f64 + 1.0);
        scores
            .entry(hit.chunk_id.clone())
            .and_modify(|(score, existing)| {
                *score += rank_score;
                if existing.snippet.trim().is_empty() || existing.snippet == existing.text {
                    existing.snippet = hit.snippet.clone();
                }
            })
            .or_insert((rank_score, hit));
    }
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f64 {
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        let left_value = f64::from(*left_value);
        let right_value = f64::from(*right_value);
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    if left_norm <= f64::EPSILON || right_norm <= f64::EPSILON {
        return 0.0;
    }
    dot / (left_norm.sqrt() * right_norm.sqrt())
}

fn stable_book_id(request: &SaveBookRequest) -> String {
    let mut hasher = DefaultHasher::new();
    request.title.hash(&mut hasher);
    request.total_pages.hash(&mut hasher);
    request.pages.len().hash(&mut hasher);
    request.chunks.len().hash(&mut hasher);
    if let Some(first) = request.pages.first() {
        first.text.hash(&mut hasher);
    }
    if let Some(last) = request.pages.last() {
        last.text.hash(&mut hasher);
    }
    format!("book-{:016x}", hasher.finish())
}

fn stable_highlight_id(request: &SaveHighlightRequest) -> String {
    let mut hasher = DefaultHasher::new();
    request.book_id.hash(&mut hasher);
    request.selection_text.hash(&mut hasher);
    request.prefix.hash(&mut hasher);
    request.suffix.hash(&mut hasher);
    request.page_index.hash(&mut hasher);
    request.position_start.hash(&mut hasher);
    request.position_end.hash(&mut hasher);
    for rect in &request.rects {
        rect.page_index.hash(&mut hasher);
        rect.x0.to_bits().hash(&mut hasher);
        rect.y0.to_bits().hash(&mut hasher);
        rect.x1.to_bits().hash(&mut hasher);
        rect.y1.to_bits().hash(&mut hasher);
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    now.hash(&mut hasher);
    format!("highlight-{:016x}", hasher.finish())
}

fn stable_interpretation_id(request: &SaveInterpretationRequest) -> String {
    let mut hasher = DefaultHasher::new();
    request.book_id.hash(&mut hasher);
    request.selection_text.hash(&mut hasher);
    request.session_id.hash(&mut hasher);
    request.turn_index.hash(&mut hasher);
    request.prefix.hash(&mut hasher);
    request.suffix.hash(&mut hasher);
    request.page_index.hash(&mut hasher);
    request.position_start.hash(&mut hasher);
    request.position_end.hash(&mut hasher);
    request.page_indexes.hash(&mut hasher);
    request.evidence_chunk_ids.hash(&mut hasher);
    request.question.hash(&mut hasher);
    request.answer.hash(&mut hasher);
    request.answer_source.hash(&mut hasher);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    now.hash(&mut hasher);
    format!("interpretation-{:016x}", hasher.finish())
}

fn get_highlight(conn: &Connection, highlight_id: &str) -> Result<SavedHighlight> {
    conn.query_row(
        "SELECT id,
                book_id,
                selection_text,
                prefix,
                suffix,
                page_index,
                position_start,
                position_end,
                rects_json,
                coordinate_version,
                interpretation,
                created_at
         FROM highlights
         WHERE id = ?1",
        params![highlight_id],
        row_to_highlight,
    )
    .context("failed to fetch saved highlight")
}

fn row_to_highlight(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedHighlight> {
    let rects_json: String = row.get(8)?;
    let rects = parse_rects_for_row(rects_json, 8)?;

    Ok(SavedHighlight {
        id: row.get(0)?,
        book_id: row.get(1)?,
        selection_text: row.get(2)?,
        prefix: row.get(3)?,
        suffix: row.get(4)?,
        page_index: row.get(5)?,
        position_start: row.get(6)?,
        position_end: row.get(7)?,
        rects,
        coordinate_version: row.get(9)?,
        interpretation: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn get_interpretation(conn: &Connection, interpretation_id: &str) -> Result<SavedInterpretation> {
    conn.query_row(
        "SELECT id,
                book_id,
                selection_text,
                session_id,
                turn_index,
                prefix,
                suffix,
                page_index,
                position_start,
                position_end,
                page_indexes_json,
                evidence_chunk_ids_json,
                question,
                answer,
                answer_source,
                created_at
         FROM interpretations
         WHERE id = ?1",
        params![interpretation_id],
        row_to_interpretation,
    )
    .context("failed to fetch saved interpretation")
}

fn row_to_interpretation(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedInterpretation> {
    let page_indexes_json: String = row.get(10)?;
    let evidence_json: String = row.get(11)?;
    let page_indexes = serde_json::from_str::<Vec<u32>>(&page_indexes_json).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(err))
    })?;
    let evidence_chunk_ids =
        serde_json::from_str::<Vec<String>>(&evidence_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(err),
            )
        })?;

    Ok(SavedInterpretation {
        id: row.get(0)?,
        book_id: row.get(1)?,
        selection_text: row.get(2)?,
        session_id: row.get(3)?,
        turn_index: row.get(4)?,
        prefix: row.get(5)?,
        suffix: row.get(6)?,
        page_index: row.get(7)?,
        position_start: row.get(8)?,
        position_end: row.get(9)?,
        page_indexes,
        evidence_chunk_ids,
        question: row.get(12)?,
        answer: row.get(13)?,
        answer_source: AnswerSource::from_db(&row.get::<_, String>(14)?),
        created_at: row.get(15)?,
    })
}

fn to_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| term.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn row_to_search_hit(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchHit> {
    let text: String = row.get(2)?;
    let rects = parse_rects_for_row(row.get(4)?, 4)?;
    let coordinate_version = row.get(5)?;
    let raw_snippet: String = row.get(6)?;
    Ok(SearchHit {
        chunk_id: row.get(0)?,
        page_index: row.get(1)?,
        markdown: row.get(3)?,
        rects,
        coordinate_version,
        snippet: if raw_snippet.trim().is_empty() {
            text.chars().take(180).collect()
        } else {
            raw_snippet
        },
        text,
        score: row.get(7)?,
    })
}

fn parse_rects(value: String) -> Result<Vec<NormalizedRectInput>, serde_json::Error> {
    serde_json::from_str(&value)
}

fn parse_rects_for_row(value: String, column: usize) -> rusqlite::Result<Vec<NormalizedRectInput>> {
    parse_rects(value).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(err),
        )
    })
}

fn make_plain_snippet(text: &str, terms: &[String]) -> String {
    let lower = text.to_lowercase();
    let start = terms
        .iter()
        .filter_map(|term| lower.find(term))
        .min()
        .unwrap_or(0);
    let start = start.saturating_sub(40);
    text.chars().skip(start).take(180).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write as _},
        net::{TcpListener, TcpStream},
        sync::{
            atomic::{AtomicBool, Ordering as AtomicOrdering},
            Arc,
        },
        thread::{self, JoinHandle},
        time::Duration,
    };

    fn disable_embedding_provider() {
        isolate_provider_config("disabled");
        std::env::set_var("EMBEDDING_PROVIDER", "disabled");
    }

    fn isolate_provider_config(name: &str) -> PathBuf {
        let worker = std::env::var("RUST_TEST_THREAD").unwrap_or_else(|_| "main".to_string());
        let thread_id = format!("{:?}", std::thread::current().id())
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
            .collect::<String>();
        let dir = std::env::temp_dir().join(format!(
            "focused-reading-storage-config-{}-{}-{}-{}",
            name,
            std::process::id(),
            worker,
            thread_id
        ));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        std::env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        std::env::set_var("FOCUSED_READING_ENV_PATH", dir.join(".env"));
        dir
    }

    fn clear_embedding_env() {
        std::env::remove_var("EMBEDDING_API_KEY");
        std::env::remove_var("EMBEDDING_BASE_URL");
        std::env::remove_var("EMBEDDING_MODEL");
        std::env::remove_var("EMBEDDING_DIM");
        std::env::remove_var("EMBEDDING_EXPECTED_DIM");
    }

    fn temp_db(name: &str) -> PathBuf {
        disable_embedding_provider();
        let worker = std::env::var("RUST_TEST_THREAD").unwrap_or_else(|_| "main".to_string());
        let thread_id = format!("{:?}", std::thread::current().id())
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
            .collect::<String>();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let dir = std::env::temp_dir().join(format!(
            "focused-reading-storage-{}-{}-{}-{}",
            name,
            std::process::id(),
            worker,
            thread_id
        ));
        let _ = fs::create_dir_all(&dir);
        dir.join(format!("{nonce}.sqlite3"))
    }

    #[test]
    fn saves_book_and_searches_chunks() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        disable_embedding_provider();
        let path = temp_db("search");
        let _ = fs::remove_file(&path);
        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "测试书".to_string(),
                total_pages: 2,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 12,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    ParsedPageInput {
                        page_index: 0,
                        text: "复利来自时间和耐心。".to_string(),
                        markdown: "## Page 1\n\n复利来自时间和耐心。".to_string(),
                    },
                    ParsedPageInput {
                        page_index: 1,
                        text: "风险控制决定长期收益。".to_string(),
                        markdown: "## Page 2\n\n风险控制决定长期收益。".to_string(),
                    },
                ],
                chunks: vec![
                    ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "复利来自时间和耐心。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n复利来自时间和耐心。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "风险控制决定长期收益。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n风险控制决定长期收益。".to_string(),
                        rects: vec![NormalizedRectInput {
                            page_index: 1,
                            x0: 0.1,
                            y0: 0.2,
                            x1: 0.8,
                            y1: 0.3,
                        }],
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");

        assert_eq!(saved.page_count, 2);
        assert_eq!(saved.chunk_count, 2);
        assert!(saved.text_char_count > 0);
        assert!(saved.markdown_char_count > saved.text_char_count);
        let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
        assert_eq!(summary.embedding_model, "");
        assert_eq!(summary.embedding_dim, 0);
        assert!(!summary.embedding_enabled);
        assert!(!summary.embedding_matches_config);
        assert_eq!(summary.chunk_count, 2);
        assert_eq!(summary.vector_count, 0);
        assert!(summary.fts_ready);

        let hits =
            hybrid_search_book(&path, &saved.book_id, "风险", 5).expect("search should work");
        assert_eq!(hits.len(), 1);
        assert!(chunk_id::is_namespaced_chunk_id(&hits[0].chunk_id));
        assert!(hits[0].chunk_id.contains("-p2-c1-"));
        assert_eq!(hits[0].page_index, 1);
        assert_eq!(hits[0].coordinate_version, COORDINATE_VERSION);
        assert_eq!(hits[0].rects.len(), 1);
        assert_eq!(hits[0].rects[0].x0, 0.1);
        let asset = get_converted_book(&path, &saved.book_id).expect("asset should load");
        assert!(asset.text.contains("复利来自时间和耐心"));
        assert!(asset.markdown.contains("## Page 1"));
        assert_eq!(asset.pages.len(), 2);
        assert_eq!(asset.chunks.len(), 2);
        assert_eq!(asset.chunks[1].coordinate_version, COORDINATE_VERSION);
        assert_eq!(asset.chunks[1].rects.len(), 1);
        assert_eq!(asset.parser_engine, "test");
        assert_eq!(asset.coordinate_mode, "text-only");
        assert!(asset
            .quality
            .as_ref()
            .is_some_and(|quality| quality.looks_usable));
        assert!(Path::new(&saved.text_path).exists());
        assert!(Path::new(&saved.markdown_path).exists());
        assert!(Path::new(&asset.text_path).exists());
        assert!(Path::new(&asset.markdown_path).exists());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn hybrid_search_works_without_embedding_provider_and_rebuilds_text_index() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        disable_embedding_provider();
        let path = temp_db("hybrid-no-embedding");
        let _ = fs::remove_file(&path);
        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "混合检索测试".to_string(),
                total_pages: 2,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 18,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    ParsedPageInput {
                        page_index: 0,
                        text: "资产配置需要分散风险。".to_string(),
                        markdown: "## Page 1\n\n资产配置需要分散风险。".to_string(),
                    },
                    ParsedPageInput {
                        page_index: 1,
                        text: "长期主义依赖耐心和现金流。".to_string(),
                        markdown: "## Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                    },
                ],
                chunks: vec![
                    ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "资产配置需要分散风险。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n资产配置需要分散风险。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "长期主义依赖耐心和现金流。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");

        let text_hits = hybrid_search_book(&path, &saved.book_id, "现金", 3)
            .expect("hybrid search should work");
        assert!(chunk_id::is_namespaced_chunk_id(&text_hits[0].chunk_id));
        assert!(text_hits[0].chunk_id.contains("-p2-c1-"));

        let rebuilt = rebuild_search_index(&path, &saved.book_id).expect("index should rebuild");
        assert_eq!(rebuilt.vector_count, 0);
        assert_eq!(rebuilt.embedding_model, "");
        assert_eq!(rebuilt.embedding_dim, 0);
        assert!(!rebuilt.embedding_enabled);
        assert!(!rebuilt.embedding_matches_config);
        assert!(rebuilt.fts_ready);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn hybrid_search_uses_matching_provider_embeddings_for_vector_recall() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        isolate_provider_config("vector-provider");
        clear_embedding_env();
        let server = FakeEmbeddingServer::start();
        std::env::set_var("EMBEDDING_PROVIDER", "test-provider");
        std::env::set_var("EMBEDDING_API_KEY", "embedding-test-key");
        std::env::set_var("EMBEDDING_BASE_URL", server.embeddings_url());
        std::env::set_var("EMBEDDING_MODEL", "test-embedding-model");
        std::env::set_var("EMBEDDING_DIM", "3");
        let path = std::env::temp_dir().join(format!(
            "focused-reading-storage-vector-provider-{}.sqlite3",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "向量检索测试".to_string(),
                total_pages: 2,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 20,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    ParsedPageInput {
                        page_index: 0,
                        text: "资产配置需要分散风险。".to_string(),
                        markdown: "## Page 1\n\n资产配置需要分散风险。".to_string(),
                    },
                    ParsedPageInput {
                        page_index: 1,
                        text: "长期主义依赖耐心和现金流。".to_string(),
                        markdown: "## Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                    },
                ],
                chunks: vec![
                    ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "资产配置需要分散风险。".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n资产配置需要分散风险。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "长期主义依赖耐心和现金流。".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save and build provider embeddings");

        let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
        assert_eq!(summary.chunk_count, 2);
        assert_eq!(summary.vector_count, 2);
        assert_eq!(summary.embedding_provider, "test-provider");
        assert_eq!(summary.embedding_base_url, server.embeddings_url());
        assert_eq!(summary.embedding_model, "test-embedding-model");
        assert_eq!(summary.embedding_dim, 3);
        assert!(summary.embedding_enabled);
        assert!(summary.embedding_key_configured);
        assert!(summary.embedding_matches_config);

        let vector_hits = hybrid_search_book(&path, &saved.book_id, "semantic-allocation", 3)
            .expect("vector search should work");
        assert_eq!(vector_hits.len(), 1);
        assert!(chunk_id::is_namespaced_chunk_id(&vector_hits[0].chunk_id));
        assert!(vector_hits[0].chunk_id.contains("-p1-c1-"));
        assert_eq!(vector_hits[0].page_index, 0);

        std::env::set_var("EMBEDDING_MODEL", "different-embedding-model");
        let stale_summary = search_index_summary(&path, &saved.book_id).expect("index summary");
        assert!(
            !stale_summary.embedding_matches_config,
            "changing embedding model must force a rebuild before old vectors can be trusted"
        );
        let stale_hits = hybrid_search_book(&path, &saved.book_id, "semantic-allocation", 3)
            .expect("hybrid search should not use stale vectors");
        assert!(
            stale_hits.is_empty(),
            "provider/model mismatches must not silently mix stale embedding vectors"
        );

        let _ = fs::remove_file(&path);
        disable_embedding_provider();
        std::env::remove_var("EMBEDDING_API_KEY");
        std::env::remove_var("EMBEDDING_BASE_URL");
        std::env::remove_var("EMBEDDING_MODEL");
        std::env::remove_var("EMBEDDING_DIM");
    }

    #[test]
    fn legacy_embedding_rows_are_marked_as_rebuild_required() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        disable_embedding_provider();
        clear_embedding_env();
        let path = temp_db("legacy-embedding-metadata");
        let _ = fs::remove_file(&path);
        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "旧向量元数据测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "旧向量不能混用。".to_string(),
                    markdown: "## Page 1\n\n旧向量不能混用。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "旧向量不能混用。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n旧向量不能混用。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");
        let saved_chunk_id = get_chunk(&path, &saved.book_id, "p1-c1")
            .expect("legacy chunk alias should resolve")
            .expect("saved chunk should exist")
            .chunk_id;

        let conn = open_database(&path).expect("database should open");
        conn.execute(
            "INSERT INTO embedding_indexes(book_id, provider, base_url, model, dimension, last_error, created_at)
             VALUES (?1, '', '', ?2, ?3, '', datetime('now'))",
            params![saved.book_id, "Qwen/Qwen3-Embedding-4B", 2560_u32],
        )
        .expect("legacy metadata should insert");
        conn.execute(
            "INSERT INTO chunk_embeddings(book_id, chunk_id, provider, base_url, model, dimension, embedding_json)
             VALUES (?1, ?2, '', '', ?3, ?4, ?5)",
            params![
                saved.book_id,
                saved_chunk_id,
                "Qwen/Qwen3-Embedding-4B",
                2560_u32,
                serde_json::to_string(&vec![1.0_f32; 2560]).expect("embedding JSON")
            ],
        )
        .expect("legacy embedding should insert");
        drop(conn);

        std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
        std::env::set_var("EMBEDDING_API_KEY", "configured-key");
        std::env::set_var(
            "EMBEDDING_BASE_URL",
            "https://api.siliconflow.cn/v1/embeddings",
        );
        std::env::set_var("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B");
        std::env::set_var("EMBEDDING_DIM", "2560");
        let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
        assert_eq!(summary.vector_count, 1);
        assert!(summary.embedding_enabled);
        assert!(summary.embedding_key_configured);
        assert_eq!(summary.embedding_provider, "");
        assert_eq!(summary.embedding_model, "Qwen/Qwen3-Embedding-4B");
        assert_eq!(summary.embedding_dim, 2560);
        assert!(
            !summary.embedding_matches_config,
            "vectors without provider/base URL metadata must be rebuilt before use"
        );

        let _ = fs::remove_file(&path);
        disable_embedding_provider();
        std::env::remove_var("EMBEDDING_API_KEY");
        std::env::remove_var("EMBEDDING_BASE_URL");
        std::env::remove_var("EMBEDDING_MODEL");
        std::env::remove_var("EMBEDDING_DIM");
    }

    #[test]
    fn save_book_keeps_text_index_when_embedding_provider_fails() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        isolate_provider_config("embedding-failure");
        clear_embedding_env();
        std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
        std::env::set_var("EMBEDDING_API_KEY", "invalid-key");
        std::env::set_var("EMBEDDING_BASE_URL", "http://127.0.0.1:1/v1/embeddings");
        std::env::set_var("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B");
        std::env::set_var("EMBEDDING_DIM", "2560");
        let path = std::env::temp_dir().join(format!(
            "focused-reading-storage-embedding-failure-{}.sqlite3",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "向量失败仍保存".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 10,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "文本索引必须先可用。".to_string(),
                    markdown: "## Page 1\n\n文本索引必须先可用。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "文本索引必须先可用。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n文本索引必须先可用。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should still save when embedding provider fails");

        let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
        assert_eq!(summary.chunk_count, 1);
        assert_eq!(summary.vector_count, 0);
        assert!(summary.fts_ready);
        assert!(summary
            .embedding_last_error
            .contains("failed to call embedding provider"));
        let hits = hybrid_search_book(&path, &saved.book_id, "文本索引", 3)
            .expect("text search should still work");
        assert!(chunk_id::is_namespaced_chunk_id(&hits[0].chunk_id));
        assert!(hits[0].chunk_id.contains("-p1-c1-"));

        let rebuilt =
            rebuild_search_index(&path, &saved.book_id).expect("rebuild should keep FTS usable");
        assert_eq!(rebuilt.chunk_count, 1);
        assert_eq!(rebuilt.vector_count, 0);
        assert!(rebuilt.fts_ready);
        assert!(rebuilt
            .embedding_last_error
            .contains("failed to call embedding provider"));

        let _ = fs::remove_file(&path);
        disable_embedding_provider();
        std::env::remove_var("EMBEDDING_API_KEY");
        std::env::remove_var("EMBEDDING_BASE_URL");
        std::env::remove_var("EMBEDDING_MODEL");
        std::env::remove_var("EMBEDDING_DIM");
    }

    #[test]
    fn vector_search_skips_provider_when_index_has_last_error() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        isolate_provider_config("embedding-error-skip");
        clear_embedding_env();
        std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
        std::env::set_var("EMBEDDING_API_KEY", "invalid-key");
        std::env::set_var("EMBEDDING_BASE_URL", "http://127.0.0.1:1/v1/embeddings");
        std::env::set_var("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B");
        std::env::set_var("EMBEDDING_DIM", "2560");
        let path = std::env::temp_dir().join(format!(
            "focused-reading-storage-embedding-error-skip-{}.sqlite3",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "向量失败跳过".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "文本检索不依赖向量服务。".to_string(),
                    markdown: "## Page 1\n\n文本检索不依赖向量服务。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "文本检索不依赖向量服务。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n文本检索不依赖向量服务。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save even when embedding provider fails");
        let conn = open_database(&path).expect("db should open");

        let vector_hits = vector_search(&conn, &saved.book_id, "semantic query", 3)
            .expect("recorded provider errors should skip vector search without reconnecting");
        assert!(vector_hits.is_empty());

        let _ = fs::remove_file(&path);
        disable_embedding_provider();
        std::env::remove_var("EMBEDDING_API_KEY");
        std::env::remove_var("EMBEDDING_BASE_URL");
        std::env::remove_var("EMBEDDING_MODEL");
        std::env::remove_var("EMBEDDING_DIM");
    }

    #[test]
    fn vector_similarity_uses_cosine_not_vector_magnitude() {
        assert!(
            cosine_similarity(&[1.0, 0.0], &[1.0, 1.0])
                > cosine_similarity(&[1.0, 0.0], &[100.0, 400.0]),
            "semantic direction should outrank raw embedding magnitude"
        );
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[0.0, 0.0]), 0.0);
    }

    struct FakeEmbeddingServer {
        embeddings_url: String,
        stop: Arc<AtomicBool>,
        handle: Option<JoinHandle<()>>,
    }

    impl FakeEmbeddingServer {
        fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("fake server should bind");
            listener
                .set_nonblocking(true)
                .expect("fake server should be nonblocking");
            let addr = listener.local_addr().expect("fake server address");
            let stop = Arc::new(AtomicBool::new(false));
            let thread_stop = Arc::clone(&stop);
            let handle = thread::spawn(move || {
                while !thread_stop.load(AtomicOrdering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => handle_embedding_request(stream),
                        Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
            });

            Self {
                embeddings_url: format!("http://{addr}/v1/embeddings"),
                stop,
                handle: Some(handle),
            }
        }

        fn embeddings_url(&self) -> String {
            self.embeddings_url.clone()
        }
    }

    impl Drop for FakeEmbeddingServer {
        fn drop(&mut self) {
            self.stop.store(true, AtomicOrdering::SeqCst);
            if let Ok(stream) = TcpStream::connect(
                self.embeddings_url
                    .trim_start_matches("http://")
                    .trim_end_matches("/v1/embeddings"),
            ) {
                drop(stream);
            }
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn handle_embedding_request(mut stream: TcpStream) {
        let mut reader = BufReader::new(
            stream
                .try_clone()
                .expect("fake server should clone TCP stream"),
        );
        let mut content_length = 0_usize;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or_default() == 0 {
                return;
            }
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                break;
            }
            if let Some(value) = trimmed.to_ascii_lowercase().strip_prefix("content-length:") {
                content_length = value.trim().parse().unwrap_or_default();
            }
        }

        let mut body = vec![0_u8; content_length];
        if std::io::Read::read_exact(&mut reader, &mut body).is_err() {
            return;
        }
        let request: serde_json::Value =
            serde_json::from_slice(&body).expect("embedding request should be JSON");
        let inputs = match &request["input"] {
            serde_json::Value::Array(items) => items
                .iter()
                .map(|item| item.as_str().unwrap_or_default().to_string())
                .collect::<Vec<_>>(),
            serde_json::Value::String(item) => vec![item.clone()],
            _ => Vec::new(),
        };
        let data = inputs
            .iter()
            .enumerate()
            .map(|(index, input)| {
                serde_json::json!({
                    "index": index,
                    "embedding": fake_embedding_for(input),
                })
            })
            .collect::<Vec<_>>();
        let response = serde_json::json!({ "data": data }).to_string();
        let http = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response.len(),
            response
        );
        let _ = stream.write_all(http.as_bytes());
    }

    fn fake_embedding_for(input: &str) -> Vec<f32> {
        if input.contains("semantic-allocation") || input.contains("资产配置") {
            vec![1.0, 0.0, 0.0]
        } else if input.contains("长期主义") || input.contains("现金流") {
            vec![0.0, 1.0, 0.0]
        } else {
            vec![0.0, 0.0, 1.0]
        }
    }

    #[test]
    fn fetches_chunks_neighbors_and_structure() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("tools");
        let _ = fs::remove_file(&path);
        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "工具测试".to_string(),
                total_pages: 3,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 12,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![
                    ParsedPageInput {
                        page_index: 0,
                        text: "第一页".to_string(),
                        markdown: "## Page 1\n\n第一页".to_string(),
                    },
                    ParsedPageInput {
                        page_index: 1,
                        text: "第二页".to_string(),
                        markdown: "## Page 2\n\n第二页".to_string(),
                    },
                    ParsedPageInput {
                        page_index: 2,
                        text: "第三页".to_string(),
                        markdown: "## Page 3\n\n第三页".to_string(),
                    },
                ],
                chunks: vec![
                    ParsedChunkInput {
                        chunk_id: "p1-c1".to_string(),
                        page_index: 0,
                        text: "第一页第一块".to_string(),
                        markdown: "### [p1-c1] Page 1\n\n第一页第一块".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    ParsedChunkInput {
                        chunk_id: "p2-c1".to_string(),
                        page_index: 1,
                        text: "第二页第一块".to_string(),
                        markdown: "### [p2-c1] Page 2\n\n第二页第一块".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    ParsedChunkInput {
                        chunk_id: "p3-c1".to_string(),
                        page_index: 2,
                        text: "第三页第一块".to_string(),
                        markdown: "### [p3-c1] Page 3\n\n第三页第一块".to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");

        let chunk = get_chunk(&path, &saved.book_id, "p2-c1")
            .expect("chunk query should work")
            .expect("chunk should exist");
        assert_eq!(chunk.page_index, 1);
        assert!(chunk_id::is_namespaced_chunk_id(&chunk.chunk_id));

        let neighbors =
            get_neighbors(&path, &saved.book_id, "p2-c1", 1).expect("neighbors should load");
        assert_eq!(
            neighbors
                .iter()
                .map(|hit| hit.text.as_str())
                .collect::<Vec<_>>(),
            vec!["第一页第一块", "第二页第一块", "第三页第一块"]
        );
        assert!(neighbors
            .iter()
            .all(|hit| chunk_id::is_namespaced_chunk_id(&hit.chunk_id)));

        let structure = list_structure(&path, &saved.book_id).expect("structure should load");
        assert_eq!(structure.len(), 3);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn lists_saved_books() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("list");
        let _ = fs::remove_file(&path);
        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "列表测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 12,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "一页文本".to_string(),
                    markdown: "## Page 1\n\n一页文本".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "一页文本".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n一页文本".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        let books = list_books(&path).expect("books should list");
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].book_id, saved.book_id);
        assert_eq!(books[0].chunk_count, 1);
        assert!(books[0].text_char_count > 0);
        assert!(books[0].markdown_char_count > 0);
        assert_eq!(books[0].parser_engine, "test");
        assert_eq!(books[0].coordinate_mode, "text-only");
        assert!(!books[0].created_at.is_empty());
        assert!(books[0]
            .quality
            .as_ref()
            .is_some_and(|quality| quality.looks_usable));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn copies_source_pdf_into_book_assets() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("pdf-copy");
        let _ = fs::remove_file(&path);
        let source_pdf = std::env::temp_dir().join(format!(
            "focused-reading-source-pdf-{}.pdf",
            std::process::id()
        ));
        fs::write(&source_pdf, b"%PDF-1.7\nfake fixture\n").expect("source PDF should write");

        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "PDF 资产测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 8,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: Some(source_pdf.to_string_lossy().to_string()),
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "PDF 已转换".to_string(),
                    markdown: "## Page 1\n\nPDF 已转换".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "PDF 已转换".to_string(),
                    markdown: "### [p1-c1] Page 1\n\nPDF 已转换".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        assert!(!saved.original_pdf_path.is_empty());
        assert_ne!(
            Path::new(&saved.original_pdf_path),
            source_pdf.as_path(),
            "source PDF should be copied into managed assets"
        );
        assert_eq!(
            fs::read(&saved.original_pdf_path).expect("copied PDF should read"),
            fs::read(&source_pdf).expect("source PDF should read")
        );
        let canonical_source_pdf = source_pdf
            .canonicalize()
            .expect("source PDF should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(saved.source_pdf_path, canonical_source_pdf);
        assert!(saved.source_pdf_fingerprint.starts_with("pdf-fnv1a64-"));

        let asset = get_converted_book(&path, &saved.book_id).expect("asset should load");
        assert_eq!(asset.original_pdf_path, saved.original_pdf_path);
        assert_eq!(asset.source_pdf_path, saved.source_pdf_path);
        assert_eq!(asset.source_pdf_fingerprint, saved.source_pdf_fingerprint);
        let books = list_books(&path).expect("books should list");
        assert_eq!(books[0].original_pdf_path, saved.original_pdf_path);
        assert_eq!(books[0].source_pdf_path, saved.source_pdf_path);
        assert_eq!(
            books[0].source_pdf_fingerprint,
            saved.source_pdf_fingerprint
        );
        let matched = find_book_by_source_pdf(&path, &source_pdf)
            .expect("source PDF lookup should run")
            .expect("source PDF should match saved book");
        assert_eq!(matched.book_id, saved.book_id);
        let cached_response = SaveBookResponse::from_cached_book(matched);
        assert_eq!(cached_response.book_id, saved.book_id);
        assert_eq!(cached_response.chunk_count, saved.chunk_count);
        assert_eq!(cached_response.text_char_count, saved.text_char_count);
        assert_eq!(
            cached_response.markdown_char_count,
            saved.markdown_char_count
        );
        assert_eq!(cached_response.original_pdf_path, saved.original_pdf_path);
        assert_eq!(cached_response.source_pdf_path, saved.source_pdf_path);
        assert_eq!(
            cached_response.source_pdf_fingerprint,
            saved.source_pdf_fingerprint
        );

        let _ = fs::remove_file(&source_pdf);
        let _ = fs::remove_file(&saved.original_pdf_path);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn source_pdf_lookup_matches_legacy_fingerprint_rows() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("pdf-legacy-fingerprint");
        let _ = fs::remove_file(&path);
        let source_pdf = std::env::temp_dir().join(format!(
            "focused-reading-source-pdf-legacy-{}.pdf",
            std::process::id()
        ));
        fs::write(&source_pdf, b"%PDF-1.7\nlegacy fingerprint fixture\n")
            .expect("source PDF should write");

        let saved = save_book(
            &path,
            SaveBookRequest {
                title: "旧指纹兼容".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: Some(source_pdf.to_string_lossy().to_string()),
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "旧指纹也应该匹配。".to_string(),
                    markdown: "## Page 1\n\n旧指纹也应该匹配。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "旧指纹也应该匹配。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n旧指纹也应该匹配。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        let legacy = legacy_source_file_fingerprint(
            &source_pdf
                .canonicalize()
                .expect("source PDF should canonicalize"),
            fs::metadata(&source_pdf)
                .expect("source PDF metadata should load")
                .len(),
        )
        .expect("legacy fingerprint should hash");
        let conn = open_database(&path).expect("database should open");
        conn.execute(
            "UPDATE book_assets SET source_pdf_fingerprint = ?1 WHERE book_id = ?2",
            params![legacy, saved.book_id],
        )
        .expect("legacy fingerprint should update");
        drop(conn);

        let matched = find_book_by_source_pdf(&path, &source_pdf)
            .expect("source PDF lookup should run")
            .expect("legacy source PDF should match saved book");
        assert_eq!(matched.book_id, saved.book_id);

        let _ = fs::remove_file(&source_pdf);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn delete_book_removes_rows_fts_and_assets() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("delete-book");
        let _ = fs::remove_file(&path);
        let saved_book = save_book(
            &path,
            SaveBookRequest {
                title: "删除书籍测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        let asset_dir = converted_book_asset_dir(&path, &saved_book.book_id);
        assert!(asset_dir.exists());
        assert!(!search_book(&path, &saved_book.book_id, "复利", 5)
            .expect("search should work")
            .is_empty());

        let deleted = delete_book(&path, &saved_book.book_id).expect("book should delete");
        assert_eq!(deleted.book_id, saved_book.book_id);
        assert!(deleted.removed_asset_dir);
        assert!(!asset_dir.exists());
        assert!(list_books(&path).expect("books should list").is_empty());
        assert!(get_converted_book(&path, &saved_book.book_id).is_err());
        assert!(search_book(&path, &saved_book.book_id, "复利", 5)
            .expect("search should still run")
            .is_empty());

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn saves_lists_and_deletes_highlights() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("highlights");
        let _ = fs::remove_file(&path);
        let saved_book = save_book(
            &path,
            SaveBookRequest {
                title: "高亮测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 12,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        let highlight = save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: saved_book.book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                prefix: "前文".to_string(),
                suffix: "后文".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                rects: vec![NormalizedRectInput {
                    page_index: 0,
                    x0: 0.1,
                    y0: 0.2,
                    x1: 0.6,
                    y1: 0.24,
                }],
                coordinate_version: COORDINATE_VERSION,
                interpretation: Some("解读内容".to_string()),
            },
        )
        .expect("highlight should save");

        let highlights = list_highlights(&path, &saved_book.book_id).expect("highlights list");
        assert_eq!(highlights.len(), 1);
        assert_eq!(highlights[0].id, highlight.id);
        assert_eq!(highlights[0].rects[0].x0, 0.1);
        assert_eq!(highlights[0].prefix, "前文");
        assert_eq!(highlights[0].page_index, Some(0));
        assert_eq!(highlights[0].position_start, Some(0));
        assert_eq!(highlights[0].position_end, Some(6));
        assert_eq!(highlights[0].coordinate_version, COORDINATE_VERSION);

        delete_highlight(&path, &highlight.id).expect("highlight should delete");
        let highlights = list_highlights(&path, &saved_book.book_id).expect("highlights list");
        assert!(highlights.is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn saves_text_only_highlight_without_pdf_rects() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("text-only-highlights");
        let _ = fs::remove_file(&path);
        let saved_book = save_book(
            &path,
            SaveBookRequest {
                title: "文本高亮测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间和耐心。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间和耐心。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间和耐心。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n复利来自时间和耐心。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        let highlight = save_highlight(
            &path,
            SaveHighlightRequest {
                book_id: saved_book.book_id.clone(),
                selection_text: "时间和耐心".to_string(),
                prefix: "复利来自".to_string(),
                suffix: "。".to_string(),
                page_index: Some(0),
                position_start: Some(4),
                position_end: Some(9),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
                interpretation: None,
            },
        )
        .expect("text-only highlight should save");

        let highlights = list_highlights(&path, &saved_book.book_id).expect("highlights list");
        assert_eq!(highlights.len(), 1);
        assert_eq!(highlights[0].id, highlight.id);
        assert_eq!(highlights[0].page_index, Some(0));
        assert_eq!(highlights[0].position_start, Some(4));
        assert_eq!(highlights[0].position_end, Some(9));
        assert!(highlights[0].rects.is_empty());

        delete_highlight(&path, &highlight.id).expect("highlight should delete");
        assert!(list_highlights(&path, &saved_book.book_id)
            .expect("highlights list")
            .is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn saves_and_lists_interpretations() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("interpretations");
        let _ = fs::remove_file(&path);
        let saved_book = save_book(
            &path,
            SaveBookRequest {
                title: "解读测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 12,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");
        let saved_chunk_id = get_chunk(&path, &saved_book.book_id, "p1-c1")
            .expect("legacy chunk alias should resolve")
            .expect("saved chunk should exist")
            .chunk_id;

        let saved = save_interpretation(
            &path,
            SaveInterpretationRequest {
                book_id: saved_book.book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                session_id: Some("session-1".to_string()),
                turn_index: Some(1),
                prefix: "".to_string(),
                suffix: "。".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                page_indexes: vec![0],
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                question: Some("为什么是时间？".to_string()),
                answer: "因为复利依赖长期积累。[p1-c1]".to_string(),
                answer_source: AnswerSource::Llm,
            },
        )
        .expect("interpretation should save");

        let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, saved.id);
        assert_eq!(rows[0].session_id, "session-1");
        assert_eq!(rows[0].turn_index, 1);
        assert_eq!(rows[0].prefix, "");
        assert_eq!(rows[0].suffix, "。");
        assert_eq!(rows[0].page_index, Some(0));
        assert_eq!(rows[0].position_start, Some(0));
        assert_eq!(rows[0].position_end, Some(6));
        assert_eq!(rows[0].page_indexes, vec![0]);
        assert_eq!(rows[0].evidence_chunk_ids, vec![saved_chunk_id]);
        assert_eq!(rows[0].question.as_deref(), Some("为什么是时间？"));

        delete_interpretation(&path, &saved.id).expect("interpretation should delete");
        let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
        assert!(rows.is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn resolves_missing_alias_by_chunk_locator_for_saved_interpretations() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("interpretation-locator-alias");
        let _ = fs::remove_file(&path);
        let saved_book = save_book(
            &path,
            SaveBookRequest {
                title: "旧别名兼容测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间。".to_string(),
                }],
                chunks: vec![
                    ParsedChunkInput {
                        chunk_id: "b503f19a9-p1-c1-deadbeef".to_string(),
                        page_index: 0,
                        text: "复利来自时间。".to_string(),
                        markdown: "### [b503f19a9-p1-c1-deadbeef] Page 1\n\n复利来自时间。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                    ParsedChunkInput {
                        chunk_id: "b503f19a9-p1-c2-feedface".to_string(),
                        page_index: 0,
                        text: "现金流保持策略。".to_string(),
                        markdown: "### [b503f19a9-p1-c2-feedface] Page 1\n\n现金流保持策略。"
                            .to_string(),
                        rects: Vec::new(),
                        coordinate_version: COORDINATE_VERSION,
                    },
                ],
            },
        )
        .expect("book should save");
        let saved_chunk_id = get_converted_book(&path, &saved_book.book_id)
            .expect("asset should load")
            .chunks[0]
            .chunk_id
            .clone();
        let resolved = get_chunk(&path, &saved_book.book_id, "b503f19a9-p1-c1-deadbeef")
            .expect("locator fallback should query")
            .expect("locator fallback should resolve");
        assert_eq!(resolved.chunk_id, saved_chunk_id);

        let saved = save_interpretation(
            &path,
            SaveInterpretationRequest {
                book_id: saved_book.book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                session_id: None,
                turn_index: Some(0),
                prefix: "".to_string(),
                suffix: "。".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                page_indexes: vec![0],
                evidence_chunk_ids: vec!["b503f19a9-p1-c1-deadbeef".to_string()],
                question: None,
                answer: "初始解读。[b503f19a9-p1-c1-deadbeef]".to_string(),
                answer_source: AnswerSource::Llm,
            },
        )
        .expect("interpretation should save");

        let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
        assert_eq!(rows[0].id, saved.id);
        assert_eq!(rows[0].evidence_chunk_ids, vec![saved_chunk_id]);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn deletes_all_interpretation_turns_in_a_session() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let path = temp_db("interpretation-session");
        let _ = fs::remove_file(&path);
        let saved_book = save_book(
            &path,
            SaveBookRequest {
                title: "会话测试".to_string(),
                total_pages: 1,
                parser_engine: "test".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: Some(TextQuality {
                    char_count: 12,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                }),
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: Vec::new(),
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间。".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

        let first = save_interpretation(
            &path,
            SaveInterpretationRequest {
                book_id: saved_book.book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                session_id: None,
                turn_index: Some(0),
                prefix: "".to_string(),
                suffix: "。".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                page_indexes: vec![0],
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                question: None,
                answer: "初始解读。[p1-c1]".to_string(),
                answer_source: AnswerSource::Llm,
            },
        )
        .expect("first turn should save");

        let follow_up = save_interpretation(
            &path,
            SaveInterpretationRequest {
                book_id: saved_book.book_id.clone(),
                selection_text: "复利来自时间".to_string(),
                session_id: Some(first.session_id.clone()),
                turn_index: Some(1),
                prefix: "".to_string(),
                suffix: "。".to_string(),
                page_index: Some(0),
                position_start: Some(0),
                position_end: Some(6),
                page_indexes: vec![0],
                evidence_chunk_ids: vec!["p1-c1".to_string()],
                question: Some("为什么？".to_string()),
                answer: "因为时间是变量。[p1-c1]".to_string(),
                answer_source: AnswerSource::LocalFallback,
            },
        )
        .expect("follow-up should save");

        let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].turn_index, 0);
        assert_eq!(rows[1].turn_index, 1);
        assert_eq!(rows[1].session_id, first.session_id);

        delete_interpretation(&path, &follow_up.id).expect("session should delete");
        assert!(list_interpretations(&path, &saved_book.book_id)
            .expect("history should list")
            .is_empty());
        let _ = fs::remove_file(&path);
    }
}
