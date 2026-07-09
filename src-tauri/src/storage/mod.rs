use std::{
    cmp::Ordering,
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{chunk_id, config, coordinates::COORDINATE_VERSION, embeddings, knowledge};

mod types;
pub use types::*;

const DEFAULT_INTERPRETATION_HISTORY_LIMIT: u32 = 50;
const MAX_INTERPRETATION_HISTORY_LIMIT: u32 = 200;
const VECTOR_SEARCH_MAX_CANDIDATES: u32 = 5000;
static COORDINATE_VERSION_WARNED: OnceLock<()> = OnceLock::new();

fn normalized_interpretation_kind(request: &SaveInterpretationRequest) -> InterpretationKind {
    request.kind.unwrap_or(InterpretationKind::Interpretation)
}

pub const TLDR_SOURCE_VERSION: u32 = 3;

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
           quality_json = excluded.quality_json,
           tldr_text = NULL,
           tldr_generated_at = NULL,
           tldr_model = NULL,
           tldr_source_version = NULL,
           tldr_engine_tag = NULL",
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
                .original_source_path
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
        for (legacy_chunk_id, chunk_id) in rebind_existing_chunk_aliases(
            &existing_chunk_aliases,
            &request.chunks,
            |legacy_chunk_id| !aliases.iter().any(|(alias, _)| alias == legacy_chunk_id),
        ) {
            alias_stmt
                .execute(params![book_id, legacy_chunk_id, chunk_id])
                .with_context(|| format!("failed to rebind chunk id alias {legacy_chunk_id}"))?;
        }
    }

    tx.commit().context("failed to commit parsed book")?;
    normalize_interpretation_evidence_ids(&conn, &book_id)
        .context("failed to rebind saved interpretation evidence ids")?;
    rebuild_fts(&conn, &book_id).context("failed to rebuild text search index")?;
    if !options.skip_embedding_rebuild {
        if let Err(err) = rebuild_embeddings(&mut conn, &book_id) {
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
            .original_source_path
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
        if !fts_query.is_empty() {
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
    }

    fallback_search(&conn, book_id, trimmed_query, limit)
}

pub fn hybrid_search_book(
    db_path: &Path,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit.max(1);
    let search_limit = limit.saturating_mul(2);
    let (fts_result, vector_hits) = std::thread::scope(|scope| {
        let vector_handle = scope.spawn(|| {
            let conn = open_database(db_path)?;
            vector_search(&conn, book_id, trimmed_query, search_limit)
        });
        let fts_result = search_book(db_path, book_id, trimmed_query, search_limit);
        let vector_hits = vector_handle
            .join()
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
        (fts_result, vector_hits)
    });
    let fts_hits = fts_result?;
    Ok(fuse_search_hits(fts_hits, vector_hits, limit))
}

pub fn rebuild_search_index(db_path: &Path, book_id: &str) -> Result<SearchIndexSummary> {
    let mut conn = open_database(db_path)?;
    rebuild_fts(&conn, book_id)?;
    if let Err(err) = rebuild_embeddings(&mut conn, book_id) {
        record_embedding_error(&conn, book_id, &format!("{err:#}"))?;
        eprintln!("failed to rebuild provider embedding index for {book_id}: {err:#}");
    }
    clear_book_tldr_with_conn(&conn, book_id)?;
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
                    coordinate_version: checked_coordinate_version(row.get(5)?),
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
                coordinate_version: checked_coordinate_version(row.get(5)?),
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
                    coordinate_version: checked_coordinate_version(row.get(5)?),
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
                coordinate_version: checked_coordinate_version(row.get(5)?),
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
                    COALESCE(chunk_counts.chunk_count, 0) AS chunk_count,
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
                    b.tldr_text,
                    strftime('%Y-%m-%dT%H:%M:%SZ', b.tldr_generated_at) AS tldr_generated_at,
                    b.tldr_model,
                    b.tldr_source_version,
                    strftime('%Y-%m-%dT%H:%M:%SZ', b.created_at) AS created_at
             FROM books b
             LEFT JOIN book_assets a ON a.book_id = b.id
             LEFT JOIN (
               SELECT book_id, COUNT(*) AS chunk_count
               FROM chunks
               GROUP BY book_id
             ) chunk_counts ON chunk_counts.book_id = b.id
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
                tldr_text: row.get(14)?,
                tldr_generated_at: row.get(15)?,
                tldr_model: row.get(16)?,
                tldr_source_version: row.get(17)?,
                created_at: row.get(18)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map stored books")?;
    Ok(books)
}

pub fn get_converted_book_manifest(db_path: &Path, book_id: &str) -> Result<StoredBookSummary> {
    let conn = open_database(db_path)?;
    conn.query_row(
        "SELECT b.id,
                b.title,
                b.total_pages,
                COALESCE(chunk_counts.chunk_count, 0) AS chunk_count,
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
                b.tldr_text,
                strftime('%Y-%m-%dT%H:%M:%SZ', b.tldr_generated_at) AS tldr_generated_at,
                b.tldr_model,
                b.tldr_source_version,
                strftime('%Y-%m-%dT%H:%M:%SZ', b.created_at) AS created_at
         FROM books b
         LEFT JOIN book_assets a ON a.book_id = b.id
         LEFT JOIN (
           SELECT book_id, COUNT(*) AS chunk_count
           FROM chunks
           WHERE book_id = ?1
           GROUP BY book_id
         ) chunk_counts ON chunk_counts.book_id = b.id
         WHERE b.id = ?1",
        params![book_id],
        |row| {
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
                tldr_text: row.get(14)?,
                tldr_generated_at: row.get(15)?,
                tldr_model: row.get(16)?,
                tldr_source_version: row.get(17)?,
                created_at: row.get(18)?,
            })
        },
    )
    .optional()
    .context("failed to fetch converted book manifest")?
    .ok_or_else(|| anyhow::anyhow!("book not found: {book_id}"))
}

pub fn get_converted_book(db_path: &Path, book_id: &str) -> Result<StoredBookAsset> {
    let conn = open_database(db_path)?;
    let (
        title,
        total_pages,
        parser_engine,
        coordinate_mode,
        quality,
        tldr_text,
        tldr_generated_at,
        tldr_model,
        tldr_source_version,
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
                    b.tldr_text,
                    strftime('%Y-%m-%dT%H:%M:%SZ', b.tldr_generated_at) AS tldr_generated_at,
                    b.tldr_model,
                    b.tldr_source_version,
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
                    row.get::<_, Option<u32>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
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
        tldr_text,
        tldr_generated_at,
        tldr_model,
        tldr_source_version,
        pages,
        chunks,
    })
}

pub const MAX_CONVERTED_BOOK_PAGE_WINDOW: u32 = 128;

fn bounded_page_window(total_pages: u32, start_page: u32, page_count: u32) -> (u32, u32) {
    let count = page_count.min(MAX_CONVERTED_BOOK_PAGE_WINDOW);
    let safe_start = if total_pages == 0 {
        0
    } else {
        start_page.min(total_pages.saturating_sub(1))
    };
    let end_page = safe_start.saturating_add(count).min(total_pages);
    (safe_start, end_page)
}

pub fn get_converted_book_pages(
    db_path: &Path,
    book_id: &str,
    start_page: u32,
    page_count: u32,
) -> Result<StoredBookPageWindow> {
    let conn = open_database(db_path)?;
    let total_pages = conn
        .query_row(
            "SELECT total_pages FROM books WHERE id = ?1",
            params![book_id],
            |row| row.get::<_, u32>(0),
        )
        .optional()
        .context("failed to fetch converted book page count")?
        .ok_or_else(|| anyhow::anyhow!("book not found: {book_id}"))?;

    let (safe_start, end_page) = bounded_page_window(total_pages, start_page, page_count);
    let pages = if safe_start < end_page {
        fetch_pages_range(&conn, book_id, safe_start, end_page)?
    } else {
        Vec::new()
    };
    let chunks = if safe_start < end_page {
        fetch_chunks_range(&conn, book_id, safe_start, end_page)?
    } else {
        Vec::new()
    };
    let text = pages
        .iter()
        .map(|page| page.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let markdown = pages
        .iter()
        .map(|page| page.markdown.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(StoredBookPageWindow {
        book_id: book_id.to_string(),
        start_page: safe_start,
        end_page,
        total_pages,
        text,
        markdown,
        pages,
        chunks,
    })
}

pub fn get_converted_book_page_sources(
    db_path: &Path,
    book_id: &str,
    start_page: u32,
    page_count: u32,
) -> Result<StoredBookPageSourceWindow> {
    let conn = open_database(db_path)?;
    let total_pages = conn
        .query_row(
            "SELECT total_pages FROM books WHERE id = ?1",
            params![book_id],
            |row| row.get::<_, u32>(0),
        )
        .optional()
        .context("failed to fetch converted book page count")?
        .ok_or_else(|| anyhow::anyhow!("book not found: {book_id}"))?;

    let (safe_start, end_page) = bounded_page_window(total_pages, start_page, page_count);
    let pages = if safe_start < end_page {
        fetch_pages_range(&conn, book_id, safe_start, end_page)?
    } else {
        Vec::new()
    };

    Ok(StoredBookPageSourceWindow { end_page, pages })
}

pub fn find_book_by_source_pdf(
    db_path: &Path,
    source_pdf_path: &Path,
) -> Result<Option<StoredBookSummary>> {
    find_book_by_source_pdf_with_engine(db_path, source_pdf_path, |_| true)
}

pub fn find_book_by_source_pdf_with_engine(
    db_path: &Path,
    source_pdf_path: &Path,
    accept_engine: impl Fn(&str) -> bool,
) -> Result<Option<StoredBookSummary>> {
    let Some(source) = source_pdf_metadata_for_path(source_pdf_path)? else {
        return Ok(None);
    };

    let books = list_books(db_path)?;
    for book in books {
        if !accept_engine(&book.parser_engine) {
            continue;
        }
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

pub fn save_highlight(db_path: &Path, mut request: SaveHighlightRequest) -> Result<SavedHighlight> {
    let conn = open_database(db_path)?;
    let requested_evidence_chunk_ids = request.evidence_chunk_ids.clone();
    request.evidence_chunk_ids = requested_evidence_chunk_ids
        .iter()
        .map(|chunk_id| resolve_chunk_id(&conn, &request.book_id, chunk_id))
        .collect::<Result<Vec<_>>>()
        .context("failed to normalize highlight evidence chunk ids")?;
    request.evidence_chunk_snapshots = evidence_chunk_snapshots(
        &conn,
        &request.book_id,
        &requested_evidence_chunk_ids,
        &request.evidence_chunk_ids,
        &request.evidence_chunk_snapshots,
    )?;
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
           evidence_chunk_ids_json,
           evidence_chunk_snapshots_json,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           selection_text = excluded.selection_text,
           prefix = excluded.prefix,
           suffix = excluded.suffix,
           page_index = excluded.page_index,
           position_start = excluded.position_start,
           position_end = excluded.position_end,
           rects_json = excluded.rects_json,
           coordinate_version = excluded.coordinate_version,
           interpretation = excluded.interpretation,
           evidence_chunk_ids_json = excluded.evidence_chunk_ids_json,
           evidence_chunk_snapshots_json = excluded.evidence_chunk_snapshots_json",
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
            request.interpretation,
            serde_json::to_string(&request.evidence_chunk_ids)
                .context("failed to serialize highlight evidence chunk ids")?,
            serde_json::to_string(&request.evidence_chunk_snapshots)
                .context("failed to serialize highlight evidence chunk snapshots")?
        ],
    )
    .context("failed to save highlight")?;

    let highlight = get_highlight(&conn, &id)?;
    knowledge::create_card_for_highlight(
        &conn,
        &highlight,
        knowledge::HighlightKnowledgeInput {
            evidence_chunk_ids: &request.evidence_chunk_ids,
            evidence_chunk_snapshots: &request.evidence_chunk_snapshots,
        },
    )?;
    Ok(highlight)
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
                    evidence_chunk_ids_json,
                    evidence_chunk_snapshots_json,
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
    knowledge::delete_card_for_source(&conn, "highlight", highlight_id)?;
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
    let requested_evidence_chunk_ids = request.evidence_chunk_ids.clone();
    request.evidence_chunk_ids = requested_evidence_chunk_ids
        .iter()
        .map(|chunk_id| resolve_chunk_id(&conn, &request.book_id, chunk_id))
        .collect::<Result<Vec<_>>>()
        .context("failed to normalize interpretation evidence chunk ids")?;
    request.evidence_chunk_snapshots = evidence_chunk_snapshots(
        &conn,
        &request.book_id,
        &requested_evidence_chunk_ids,
        &request.evidence_chunk_ids,
        &request.evidence_chunk_snapshots,
    )?;
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
    let evidence_snapshot_json = serde_json::to_string(&request.evidence_chunk_snapshots)
        .context("failed to serialize evidence chunk snapshots")?;
    let kind = normalized_interpretation_kind(&request);

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
           kind,
           interpret_mode,
           evidence_chunk_snapshots_json,
           created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, datetime('now'))",
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
            request.answer_source.as_str(),
            kind.as_str(),
            request.mode.as_deref(),
            evidence_snapshot_json
        ],
    )
    .context("failed to save interpretation")?;

    let interpretation = get_interpretation(&conn, &id)?;
    knowledge::create_card_for_interpretation(&conn, &interpretation)?;
    Ok(interpretation)
}

pub fn list_interpretations(db_path: &Path, book_id: &str) -> Result<Vec<SavedInterpretation>> {
    list_interpretations_page(db_path, book_id, None, None)
}

pub fn list_interpretations_page(
    db_path: &Path,
    book_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<SavedInterpretation>> {
    let conn = open_database(db_path)?;
    let limit = limit
        .unwrap_or(DEFAULT_INTERPRETATION_HISTORY_LIMIT)
        .clamp(1, MAX_INTERPRETATION_HISTORY_LIMIT);
    let offset = offset.unwrap_or(0);
    let mut stmt = conn
        .prepare(
            "WITH recent_sessions AS (
               SELECT COALESCE(NULLIF(session_id, ''), id) AS session_key,
                      MAX(created_at) AS latest_created_at
               FROM interpretations
               WHERE book_id = ?1
               GROUP BY session_key
               ORDER BY latest_created_at DESC
               LIMIT ?2 OFFSET ?3
             )
             SELECT i.id,
                    i.book_id,
                    i.selection_text,
                    i.session_id,
                    i.turn_index,
                    i.prefix,
                    i.suffix,
                    i.page_index,
                    i.position_start,
                    i.position_end,
                    i.page_indexes_json,
                    i.evidence_chunk_ids_json,
                    i.question,
                    i.answer,
                    i.answer_source,
                    i.kind,
                    i.interpret_mode,
                    i.evidence_chunk_snapshots_json,
                    i.created_at
             FROM interpretations i
             JOIN recent_sessions r
               ON r.session_key = COALESCE(NULLIF(i.session_id, ''), i.id)
             WHERE i.book_id = ?1
             ORDER BY r.latest_created_at DESC, i.turn_index ASC, i.created_at ASC",
        )
        .context("failed to prepare interpretation list")?;
    let interpretations = stmt
        .query_map(params![book_id, limit, offset], row_to_interpretation)?
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
        let interpretation_ids = conn
            .prepare("SELECT id FROM interpretations WHERE session_id = ?1 OR id = ?2")
            .context("failed to prepare interpretation ids for knowledge cleanup")?
            .query_map(params![session_id, interpretation_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to read interpretation ids for knowledge cleanup")?;
        for id in interpretation_ids {
            knowledge::delete_card_for_source(&conn, "interpretation", &id)?;
        }
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

pub fn get_book_tldr(db_path: &Path, book_id: &str) -> Result<Option<DocumentTldr>> {
    let conn = open_database(db_path)?;
    get_book_tldr_with_conn(&conn, book_id)
}

pub fn save_book_tldr(
    db_path: &Path,
    book_id: &str,
    text: &str,
    model: &str,
    source_version: u32,
    engine_tag: &str,
) -> Result<DocumentTldr> {
    let conn = open_database(db_path)?;
    conn.execute(
        "UPDATE books
         SET tldr_text = ?2,
             tldr_generated_at = datetime('now'),
             tldr_model = ?3,
             tldr_source_version = ?4,
             tldr_engine_tag = ?5
         WHERE id = ?1",
        params![book_id, text, model, source_version, engine_tag],
    )
    .context("failed to save book TLDR")?;
    get_book_tldr_with_conn(&conn, book_id)?
        .ok_or_else(|| anyhow::anyhow!("book TLDR was not saved: {book_id}"))
}

fn get_book_tldr_with_conn(conn: &Connection, book_id: &str) -> Result<Option<DocumentTldr>> {
    conn.query_row(
        "SELECT id,
                tldr_text,
                strftime('%Y-%m-%dT%H:%M:%SZ', tldr_generated_at) AS tldr_generated_at,
                tldr_model,
                tldr_source_version,
                tldr_engine_tag
         FROM books
         WHERE id = ?1",
        params![book_id],
        |row| {
            let text = row.get::<_, Option<String>>(1)?;
            let generated_at = row.get::<_, Option<String>>(2)?;
            let model = row.get::<_, Option<String>>(3)?;
            let source_version = row.get::<_, Option<u32>>(4)?;
            let engine_tag = row.get::<_, Option<String>>(5)?;
            Ok(match (text, generated_at, model, source_version) {
                (Some(text), Some(generated_at), Some(model), Some(source_version))
                    if !text.trim().is_empty() =>
                {
                    Some(DocumentTldr {
                        book_id: row.get(0)?,
                        text,
                        generated_at,
                        model,
                        source_version,
                        engine_tag,
                    })
                }
                _ => None,
            })
        },
    )
    .optional()
    .context("failed to fetch book TLDR")
    .map(Option::flatten)
}

fn clear_book_tldr_with_conn(conn: &Connection, book_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE books
         SET tldr_text = NULL,
             tldr_generated_at = NULL,
             tldr_model = NULL,
             tldr_source_version = NULL,
             tldr_engine_tag = NULL
         WHERE id = ?1",
        params![book_id],
    )
    .context("failed to clear book TLDR")?;
    Ok(())
}

pub(crate) fn open_database(path: &Path) -> Result<Connection> {
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
          tldr_text TEXT,
          tldr_generated_at TEXT,
          tldr_model TEXT,
          tldr_source_version INTEGER,
          tldr_engine_tag TEXT,
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
          evidence_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
          evidence_chunk_snapshots_json TEXT NOT NULL DEFAULT '[]',
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
          kind TEXT NOT NULL DEFAULT 'interpretation',
          interpret_mode TEXT,
          evidence_chunk_snapshots_json TEXT NOT NULL DEFAULT '[]',
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
        CREATE INDEX IF NOT EXISTS idx_chunks_book_page_id
          ON chunks(book_id, page_index, id);
        CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_book_provider_model
          ON chunk_embeddings(book_id, provider, base_url, model, dimension);
        CREATE INDEX IF NOT EXISTS idx_highlights_book_page_created
          ON highlights(book_id, page_index, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_interpretations_book_session_turn
          ON interpretations(book_id, session_id, turn_index);
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
        "books",
        "tldr_text",
        "ALTER TABLE books ADD COLUMN tldr_text TEXT",
    )?;
    ensure_column(
        &conn,
        "books",
        "tldr_generated_at",
        "ALTER TABLE books ADD COLUMN tldr_generated_at TEXT",
    )?;
    ensure_column(
        &conn,
        "books",
        "tldr_model",
        "ALTER TABLE books ADD COLUMN tldr_model TEXT",
    )?;
    ensure_column(
        &conn,
        "books",
        "tldr_source_version",
        "ALTER TABLE books ADD COLUMN tldr_source_version INTEGER",
    )?;
    ensure_column(
        &conn,
        "books",
        "tldr_engine_tag",
        "ALTER TABLE books ADD COLUMN tldr_engine_tag TEXT",
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
        "highlights",
        "evidence_chunk_ids_json",
        "ALTER TABLE highlights ADD COLUMN evidence_chunk_ids_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        &conn,
        "highlights",
        "evidence_chunk_snapshots_json",
        "ALTER TABLE highlights ADD COLUMN evidence_chunk_snapshots_json TEXT NOT NULL DEFAULT '[]'",
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
    ensure_column(
        &conn,
        "interpretations",
        "kind",
        "ALTER TABLE interpretations ADD COLUMN kind TEXT NOT NULL DEFAULT 'interpretation'",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "interpret_mode",
        "ALTER TABLE interpretations ADD COLUMN interpret_mode TEXT",
    )?;
    ensure_column(
        &conn,
        "interpretations",
        "evidence_chunk_snapshots_json",
        "ALTER TABLE interpretations ADD COLUMN evidence_chunk_snapshots_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    knowledge::initialize_schema(&conn)?;
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

fn evidence_chunk_snapshots(
    conn: &Connection,
    book_id: &str,
    original_ids: &[String],
    resolved_ids: &[String],
    supplied_snapshots: &[EvidenceChunkSnapshot],
) -> Result<Vec<EvidenceChunkSnapshot>> {
    let supplied_by_resolved_id = supplied_snapshots
        .iter()
        .filter(|snapshot| snapshot.content_hash.is_some() || snapshot.chunk_id_version > 0)
        .map(|snapshot| (snapshot.chunk_id.as_str(), snapshot))
        .collect::<HashMap<_, _>>();
    let mut snapshots = Vec::new();
    for (index, resolved_id) in resolved_ids.iter().enumerate() {
        let supplied_snapshot = supplied_by_resolved_id
            .get(resolved_id.as_str())
            .or_else(|| {
                original_ids
                    .get(index)
                    .and_then(|id| supplied_by_resolved_id.get(id.as_str()))
            });
        let mut snapshot = evidence_chunk_snapshot(
            conn,
            book_id,
            original_ids
                .get(index)
                .map(String::as_str)
                .unwrap_or(resolved_id),
            resolved_id,
        )?;
        if let Some(supplied) = supplied_snapshot {
            if supplied.content_hash.is_some() {
                snapshot.content_hash = supplied.content_hash.clone();
            }
        }
        snapshots.push(snapshot);
    }
    Ok(snapshots)
}

fn evidence_chunk_snapshot(
    conn: &Connection,
    book_id: &str,
    original_id: &str,
    resolved_id: &str,
) -> Result<EvidenceChunkSnapshot> {
    let stored_text = conn
        .query_row(
            "SELECT text FROM chunks WHERE book_id = ?1 AND chunk_id = ?2",
            params![book_id, resolved_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to load evidence chunk text for audit snapshot")?;
    let locator = chunk_id::locator_from_chunk_id(original_id)
        .or_else(|| chunk_id::locator_from_chunk_id(resolved_id));
    let chunk_id_version = if chunk_id::is_namespaced_chunk_id(resolved_id) {
        chunk_id::NAMESPACED_CHUNK_ID_VERSION
    } else if chunk_id::is_legacy_chunk_id(resolved_id) || chunk_id::is_legacy_chunk_id(original_id)
    {
        chunk_id::LEGACY_CHUNK_ID_VERSION
    } else {
        0
    };
    let content_hash = locator
        .and_then(|locator| locator.content_hash)
        .or_else(|| stored_text.as_deref().map(chunk_id::content_hash));
    Ok(EvidenceChunkSnapshot {
        chunk_id: resolved_id.to_string(),
        chunk_id_version,
        content_hash,
    })
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
    should_rebind: impl Fn(&str) -> bool,
) -> Vec<(String, String)> {
    existing_aliases
        .iter()
        .filter_map(|(old_chunk_id, legacy_chunk_id)| {
            if !should_rebind(legacy_chunk_id) {
                return None;
            }
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
    if chunk_id::locator_from_chunk_id(chunk_id).is_some() {
        eprintln!(
            "warning: unresolved chunk_id locator for book {book_id}: {chunk_id}; preserving original id"
        );
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
    original_source_path: Option<PathBuf>,
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
    let namespace_asset_dirs = source_asset_dirs.len() > 1;
    for source_asset_dir in source_asset_dirs
        .iter()
        .filter(|path| path.exists() && path.is_dir())
    {
        copy_mineru_asset_resources(source_asset_dir, &asset_dir, namespace_asset_dirs)?;
    }
    let original_source_path = source_pdf_path
        .filter(|path| !path.trim().is_empty())
        .map(Path::new)
        .filter(|path| path.exists())
        .map(|source| {
            let extension = source
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.trim().trim_start_matches('.'))
                .filter(|extension| !extension.is_empty())
                .unwrap_or("source");
            let target = asset_dir.join(format!("{file_stem}.{extension}"));
            fs::copy(source, &target).with_context(|| {
                format!(
                    "failed to copy source file {} to {}",
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
        original_source_path,
    })
}

fn copy_mineru_asset_resources(
    source_dir: &Path,
    asset_dir: &Path,
    namespace_asset_dir: bool,
) -> Result<()> {
    let target_root = if namespace_asset_dir {
        source_dir
            .file_name()
            .map(|name| asset_dir.join(name))
            .unwrap_or_else(|| asset_dir.to_path_buf())
    } else {
        asset_dir.to_path_buf()
    };
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
        let target = target_root.join(file_name);
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
    let markdown = rewrite_html_image_src_paths(markdown, source_asset_dirs, asset_dir);
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

fn rewrite_html_image_src_paths(
    markdown: &str,
    source_asset_dirs: &[PathBuf],
    asset_dir: &Path,
) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    while let Some(tag_start_relative) = find_ascii_case_insensitive(&markdown[cursor..], "<img") {
        let tag_start = cursor + tag_start_relative;
        output.push_str(&markdown[cursor..tag_start]);
        let Some(tag_end_relative) = markdown[tag_start..].find('>') else {
            output.push_str(&markdown[tag_start..]);
            return output;
        };
        let tag_end = tag_start + tag_end_relative + 1;
        output.push_str(&rewrite_html_image_tag_src(
            &markdown[tag_start..tag_end],
            source_asset_dirs,
            asset_dir,
        ));
        cursor = tag_end;
    }
    output.push_str(&markdown[cursor..]);
    output
}

fn rewrite_html_image_tag_src(
    tag: &str,
    source_asset_dirs: &[PathBuf],
    asset_dir: &Path,
) -> String {
    let Some((src_start, value_start, value_end)) = find_html_src_attribute(tag) else {
        return tag.to_string();
    };
    let raw_path = &tag[value_start..value_end];
    let rewritten = rewrite_markdown_link_path(raw_path, source_asset_dirs, asset_dir);
    if rewritten == raw_path {
        return tag.to_string();
    }
    format!("{}{}{}", &tag[..src_start], &rewritten, &tag[value_end..])
}

fn find_html_src_attribute(tag: &str) -> Option<(usize, usize, usize)> {
    let mut search_start = 0;
    while let Some(src_relative) = find_ascii_case_insensitive(&tag[search_start..], "src") {
        let src_start = search_start + src_relative;
        let before = tag[..src_start].chars().next_back();
        if before.is_some_and(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_')) {
            search_start = src_start + 3;
            continue;
        }
        let mut cursor = src_start + 3;
        cursor = skip_ascii_whitespace(tag, cursor);
        if tag.as_bytes().get(cursor) != Some(&b'=') {
            search_start = src_start + 3;
            continue;
        }
        cursor += 1;
        cursor = skip_ascii_whitespace(tag, cursor);
        let quote = *tag.as_bytes().get(cursor)?;
        if quote == b'"' || quote == b'\'' {
            let value_start = cursor + 1;
            let value_end = tag[value_start..].find(quote as char)? + value_start;
            return Some((value_start, value_start, value_end));
        }
        let value_start = cursor;
        let value_end = tag[value_start..]
            .find(|ch: char| ch.is_ascii_whitespace() || ch == '>')
            .map(|offset| value_start + offset)
            .unwrap_or(tag.len());
        return Some((value_start, value_start, value_end));
    }
    None
}

fn skip_ascii_whitespace(value: &str, mut cursor: usize) -> usize {
    while value
        .as_bytes()
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_whitespace())
    {
        cursor += 1;
    }
    cursor
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let needle = needle.as_bytes();
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
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
    let path_without_title = markdown_link_path_without_title(trimmed);
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

fn markdown_link_path_without_title(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(stripped) = trimmed.strip_prefix('<') {
        if let Some(end) = stripped.find('>') {
            return &stripped[..end];
        }
    }
    if let Some((path, _title)) = trimmed.split_once(" \"") {
        return path.trim_end();
    }
    if let Some((path, _title)) = trimmed.split_once(" '") {
        return path.trim_end();
    }
    trimmed
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
    fetch_pages_with_query(
        conn,
        book_id,
        "SELECT page_index, text, markdown
         FROM pages
         WHERE book_id = ?1
         ORDER BY page_index",
        None,
    )
}

fn fetch_pages_range(
    conn: &Connection,
    book_id: &str,
    start_page: u32,
    end_page: u32,
) -> Result<Vec<ParsedPageInput>> {
    fetch_pages_with_query(
        conn,
        book_id,
        "SELECT page_index, text, markdown
         FROM pages
         WHERE book_id = ?1 AND page_index >= ?2 AND page_index < ?3
         ORDER BY page_index",
        Some((start_page, end_page)),
    )
}

fn fetch_pages_with_query(
    conn: &Connection,
    book_id: &str,
    query: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<ParsedPageInput>> {
    let mut stmt = conn
        .prepare(query)
        .context("failed to prepare converted pages query")?;
    let map_page = |row: &rusqlite::Row<'_>| {
        Ok(ParsedPageInput {
            page_index: row.get(0)?,
            text: row.get(1)?,
            markdown: row.get(2)?,
        })
    };
    let pages = match range {
        Some((start_page, end_page)) => {
            stmt.query_map(params![book_id, start_page, end_page], map_page)?
        }
        None => stmt.query_map(params![book_id], map_page)?,
    }
    .collect::<rusqlite::Result<Vec<_>>>()
    .context("failed to map converted pages")?;
    Ok(pages)
}

fn fetch_chunks(conn: &Connection, book_id: &str) -> Result<Vec<ParsedChunkInput>> {
    fetch_chunks_with_query(
        conn,
        book_id,
        "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
         FROM chunks
         WHERE book_id = ?1
         ORDER BY page_index, id",
        None,
    )
}

fn fetch_chunks_range(
    conn: &Connection,
    book_id: &str,
    start_page: u32,
    end_page: u32,
) -> Result<Vec<ParsedChunkInput>> {
    fetch_chunks_with_query(
        conn,
        book_id,
        "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
         FROM chunks
         WHERE book_id = ?1 AND page_index >= ?2 AND page_index < ?3
         ORDER BY page_index, id",
        Some((start_page, end_page)),
    )
}

fn fetch_chunks_with_query(
    conn: &Connection,
    book_id: &str,
    query: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<ParsedChunkInput>> {
    let mut stmt = conn
        .prepare(query)
        .context("failed to prepare converted chunks query")?;
    let map_chunk = |row: &rusqlite::Row<'_>| {
        Ok(ParsedChunkInput {
            chunk_id: row.get(0)?,
            page_index: row.get(1)?,
            text: row.get(2)?,
            markdown: row.get(3)?,
            rects: parse_rects_for_row(row.get(4)?, 4)?,
            coordinate_version: row.get(5)?,
        })
    };
    let chunks = match range {
        Some((start_page, end_page)) => {
            stmt.query_map(params![book_id, start_page, end_page], map_chunk)?
        }
        None => stmt.query_map(params![book_id], map_chunk)?,
    }
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

fn rebuild_embeddings(conn: &mut Connection, book_id: &str) -> Result<()> {
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

    let tx = conn
        .transaction()
        .context("failed to start embedding insert transaction")?;
    let mut stmt = tx
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
    drop(stmt);
    tx.commit()
        .context("failed to commit embedding insert transaction")?;

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
    let terms = fallback_query_terms(query);

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
        let coordinate_version = checked_coordinate_version(row.get(5)?);
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

fn fallback_query_terms(query: &str) -> Vec<String> {
    let compact = query.to_lowercase();
    let mut terms = compact
        .split_whitespace()
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let cjk_chars = compact
        .chars()
        .filter(|ch| contains_cjk_char(*ch))
        .collect::<Vec<_>>();
    for size in [2, 3, 4] {
        for window in cjk_chars.windows(size).take(80) {
            terms.push(window.iter().collect());
        }
    }
    terms.sort();
    terms.dedup();
    terms
}

fn contains_cjk_char(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
        || ('\u{3400}'..='\u{4dbf}').contains(&ch)
        || ('\u{f900}'..='\u{faff}').contains(&ch)
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
               AND e.dimension = ?5
             ORDER BY c.page_index, c.id
             LIMIT ?6",
        )
        .context("failed to prepare vector search")?;
    let mut rows = stmt
        .query(params![
            book_id,
            provider,
            base_url,
            model,
            dimension,
            VECTOR_SEARCH_MAX_CANDIDATES
        ])
        .context("failed to query vector rows")?;
    let mut hits = Vec::new();

    while let Some(row) = rows.next().context("failed to read vector row")? {
        let text: String = row.get(2)?;
        let rects = parse_rects(row.get(4)?).context("failed to parse chunk rects")?;
        let coordinate_version = checked_coordinate_version(row.get(5)?);
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
    normalized_interpretation_kind(request).hash(&mut hasher);
    request.evidence_chunk_snapshots.hash(&mut hasher);
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
                evidence_chunk_ids_json,
                evidence_chunk_snapshots_json,
                created_at
         FROM highlights
         WHERE id = ?1",
        params![highlight_id],
        row_to_highlight,
    )
    .context("failed to fetch saved highlight")
}

pub(crate) fn row_to_highlight(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedHighlight> {
    let rects_json: String = row.get(8)?;
    let rects = parse_rects_for_row(rects_json, 8)?;
    let evidence_json: String = row.get(11)?;
    let evidence_snapshots_json: String = row.get(12)?;
    let evidence_chunk_ids =
        serde_json::from_str::<Vec<String>>(&evidence_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(err),
            )
        })?;
    let evidence_chunk_snapshots = serde_json::from_str::<Vec<EvidenceChunkSnapshot>>(
        &evidence_snapshots_json,
    )
    .map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(err))
    })?;

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
        evidence_chunk_ids,
        evidence_chunk_snapshots,
        created_at: row.get(13)?,
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
                kind,
                interpret_mode,
                evidence_chunk_snapshots_json,
                created_at
         FROM interpretations
         WHERE id = ?1",
        params![interpretation_id],
        row_to_interpretation,
    )
    .context("failed to fetch saved interpretation")
}

pub(crate) fn row_to_interpretation(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<SavedInterpretation> {
    let page_indexes_json: String = row.get(10)?;
    let evidence_json: String = row.get(11)?;
    let evidence_snapshots_json: String = row.get(17)?;
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
    let evidence_chunk_snapshots = serde_json::from_str::<Vec<EvidenceChunkSnapshot>>(
        &evidence_snapshots_json,
    )
    .map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(17, rusqlite::types::Type::Text, Box::new(err))
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
        kind: InterpretationKind::from_db(&row.get::<_, String>(15)?),
        mode: row.get(16)?,
        evidence_chunk_snapshots,
        created_at: row.get(18)?,
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
    let coordinate_version = checked_coordinate_version(row.get(5)?);
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

fn warn_if_coordinate_version_mismatch(coordinate_version: u32) {
    if coordinate_version == COORDINATE_VERSION {
        return;
    }
    COORDINATE_VERSION_WARNED.get_or_init(|| {
        eprintln!(
            "stored chunk coordinate_version {coordinate_version} does not match runtime coordinate_version {COORDINATE_VERSION}; coordinates may need migration"
        );
    });
}

fn checked_coordinate_version(coordinate_version: u32) -> u32 {
    warn_if_coordinate_version_mismatch(coordinate_version);
    coordinate_version
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
mod tests;
