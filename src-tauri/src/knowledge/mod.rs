use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, BTreeSet},
    hash::{Hash, Hasher},
    path::Path,
};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::storage::{self, EvidenceChunkSnapshot, SavedHighlight, SavedInterpretation};

mod text_utils;
use text_utils::*;

pub const KB_SOURCE_VERSION: u32 = 1;
const KNOWLEDGE_GRAPH_TASK: &str = "knowledge_graph";
const MAX_GRAPH_CANDIDATES: usize = 260;
const MAX_BOOK_SCAN_CHUNKS: usize = 4_000;
const MAX_BOOK_SEED_CARDS: usize = 180;
const MAX_BOOK_SECTION_CARDS: usize = 96;
const MAX_EVIDENCE_PER_AUTO_CARD: usize = 64;
const MAX_TEXT_PER_CARD_CHARS: usize = 4_000;
const MAX_GRAPH_NODES: usize = 220;
const MAX_SAME_EVIDENCE_CARDS_PER_CHUNK: usize = 24;
const MAX_KNOWLEDGE_SEARCH_CARDS: usize = 16;
const MAX_KNOWLEDGE_SEARCH_HITS: usize = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCard {
    pub card_id: String,
    pub book_id: String,
    pub card_type: String,
    pub title: String,
    pub summary: String,
    pub body_markdown: String,
    pub payload_json: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub source_version: u32,
    pub user_locked: bool,
    pub created_at: String,
    pub updated_at: String,
    pub evidence: Vec<KnowledgeEvidence>,
    pub drift_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEvidence {
    pub card_id: String,
    pub book_id: String,
    pub chunk_id: String,
    pub page_index: Option<u32>,
    pub quote: String,
    pub role: String,
    pub content_hash: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertKnowledgeCardRequest {
    pub card_id: Option<String>,
    pub book_id: String,
    pub card_type: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub body_markdown: String,
    #[serde(default)]
    pub payload_json: Option<String>,
    #[serde(default = "default_confirmed_status")]
    pub status: String,
    #[serde(default)]
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeHealth {
    pub book_id: String,
    pub card_count: usize,
    pub confirmed_count: usize,
    pub candidate_count: usize,
    pub rejected_count: usize,
    pub drift_count: usize,
    pub edge_count: usize,
    pub latest_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDrift {
    pub card_id: String,
    pub title: String,
    pub chunk_id: String,
    pub page_index: Option<u32>,
    pub stored_content_hash: Option<String>,
    pub current_content_hash: Option<String>,
    pub quote: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchHit {
    pub card_id: String,
    pub title: String,
    pub card_type: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub score: f64,
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextCard {
    pub card_id: String,
    pub title: String,
    pub card_type: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub summary: String,
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextEdge {
    pub edge_type: String,
    pub label: String,
    pub source_title: String,
    pub target_title: String,
    pub evidence_chunk_ids: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextResponse {
    pub book_id: String,
    pub query: String,
    pub cards: Vec<KnowledgeContextCard>,
    pub edges: Vec<KnowledgeContextEdge>,
    pub station_count: usize,
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookKnowledgeJsonResponse {
    pub book_id: String,
    pub generated_at: String,
    pub cards: Vec<KnowledgeCard>,
    pub edges: Vec<KnowledgeEdge>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapLine {
    pub line_id: String,
    pub title: String,
    pub page_start: u32,
    pub page_end: u32,
    pub station_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapStation {
    pub station_id: String,
    pub card_id: String,
    pub line_id: String,
    pub title: String,
    pub card_type: String,
    pub status: String,
    pub page_index: Option<u32>,
    pub time_raw: Option<String>,
    pub time_norm: Option<String>,
    pub time_order: u32,
    pub time_source: Option<String>,
    pub people: Vec<String>,
    pub places: Vec<String>,
    pub evidence: Vec<KnowledgeEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapTransfer {
    pub edge_id: String,
    pub source_station_id: String,
    pub target_station_id: String,
    pub edge_type: String,
    pub label: String,
    pub evidence_chunk_ids: Vec<String>,
    pub confidence: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapResponse {
    pub book_id: String,
    pub lines: Vec<KnowledgeMapLine>,
    pub stations: Vec<KnowledgeMapStation>,
    pub transfers: Vec<KnowledgeMapTransfer>,
    pub built_at: Option<String>,
}

fn default_confirmed_status() -> String {
    "confirmed".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookKnowledgeMarkdownResponse {
    pub book_id: String,
    pub markdown: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEdge {
    pub edge_id: String,
    pub book_id: String,
    pub source_card_id: String,
    pub target_card_id: String,
    pub edge_type: String,
    pub label: String,
    pub evidence_chunk_ids: Vec<String>,
    pub source: String,
    pub confidence: f64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphNode {
    pub card_id: String,
    pub book_id: String,
    pub card_type: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub evidence_count: usize,
    pub page_index: Option<u32>,
    pub evidence: Vec<KnowledgeEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphResponse {
    pub book_id: String,
    pub nodes: Vec<KnowledgeGraphNode>,
    pub edges: Vec<KnowledgeEdge>,
    pub built_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildKnowledgeGraphResponse {
    pub book_id: String,
    pub card_count: usize,
    pub edge_count: usize,
    pub candidate_count: usize,
    pub built_at: String,
}

#[derive(Debug, Clone)]
pub struct HighlightKnowledgeInput<'a> {
    pub evidence_chunk_ids: &'a [String],
    pub evidence_chunk_snapshots: &'a [EvidenceChunkSnapshot],
}

pub fn initialize_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS kb_cards (
          card_id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          card_type TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          body_markdown TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'confirmed',
          source TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          source_version INTEGER NOT NULL,
          user_locked INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS kb_evidence (
          card_id TEXT NOT NULL REFERENCES kb_cards(card_id) ON DELETE CASCADE,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chunk_id TEXT NOT NULL,
          page_index INTEGER,
          quote TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'support',
          content_hash TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(card_id, chunk_id, role),
          FOREIGN KEY(book_id, chunk_id) REFERENCES chunks(book_id, chunk_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS kb_edges (
          edge_id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          source_card_id TEXT NOT NULL REFERENCES kb_cards(card_id) ON DELETE CASCADE,
          target_card_id TEXT NOT NULL REFERENCES kb_cards(card_id) ON DELETE CASCADE,
          edge_type TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          evidence_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'auto',
          confidence REAL NOT NULL DEFAULT 0.0,
          status TEXT NOT NULL DEFAULT 'candidate',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS kb_build_runs (
          run_id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          task TEXT NOT NULL,
          source_version INTEGER NOT NULL,
          status TEXT NOT NULL,
          progress_json TEXT NOT NULL DEFAULT '{}',
          error_message TEXT,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_kb_cards_book_updated
          ON kb_cards(book_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_kb_cards_book_type_status
          ON kb_cards(book_id, card_type, status);
        CREATE INDEX IF NOT EXISTS idx_kb_evidence_book_chunk
          ON kb_evidence(book_id, chunk_id);
        CREATE INDEX IF NOT EXISTS idx_kb_edges_book_source
          ON kb_edges(book_id, source_card_id, edge_type);
        ",
    )
    .context("failed to initialize knowledge schema")?;
    ensure_column(
        conn,
        "kb_cards",
        "deleted_at",
        "ALTER TABLE kb_cards ADD COLUMN deleted_at TEXT",
    )?;
    ensure_column(
        conn,
        "kb_edges",
        "deleted_at",
        "ALTER TABLE kb_edges ADD COLUMN deleted_at TEXT",
    )?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, alter_sql: &str) -> Result<()> {
    let pragma = format!("PRAGMA table_info({table})");
    let exists = conn
        .prepare(&pragma)
        .with_context(|| format!("failed to inspect {table} schema"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .with_context(|| format!("failed to read {table} schema"))?
        .into_iter()
        .any(|name| name == column);
    if !exists {
        conn.execute(alter_sql, [])
            .with_context(|| format!("failed to add {table}.{column}"))?;
    }
    Ok(())
}

pub fn list_cards(db_path: &Path, book_id: &str) -> Result<Vec<KnowledgeCard>> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    list_cards_for_conn(&conn, book_id)
}

pub fn export_book_knowledge_markdown(
    db_path: &Path,
    book_id: &str,
) -> Result<ExportBookKnowledgeMarkdownResponse> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let cards = list_cards_for_conn(&conn, book_id)?;
    let edges = list_edges_for_conn(&conn, book_id)?;
    let generated_at = sqlite_timestamp(&conn)?;
    Ok(ExportBookKnowledgeMarkdownResponse {
        book_id: book_id.to_string(),
        markdown: render_markdown(book_id, &cards, &edges, &generated_at),
        generated_at,
    })
}

pub fn build_knowledge_graph(db_path: &Path, book_id: &str) -> Result<BuildKnowledgeGraphResponse> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let book_chunks = load_book_chunks_for_knowledge(&conn, book_id)?;
    let scaffold_stats = ensure_book_seed_cards(&conn, book_id, &book_chunks)?;
    let source_cards = list_cards_for_conn(&conn, book_id)?;
    let candidates = merge_candidate_drafts(vec![
        extract_candidate_drafts(&source_cards),
        extract_book_candidate_drafts(&book_chunks),
    ]);

    for candidate in &candidates {
        upsert_candidate_card(&conn, book_id, candidate)?;
    }

    conn.execute(
        "UPDATE kb_edges
         SET deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE book_id = ?1
           AND source = 'auto'
           AND status != 'rejected'",
        params![book_id],
    )
    .context("failed to retire stale automatic knowledge graph edges")?;

    let graph_cards = list_cards_for_conn(&conn, book_id)?;
    let candidate_edge_count = upsert_candidate_edges(&conn, book_id, &candidates)?;
    let structural_edge_count = upsert_structural_edges(&conn, book_id, &graph_cards)?;
    let ontology_edge_count = upsert_book_ontology_edges(&conn, book_id, &graph_cards)?;
    let built_at = sqlite_timestamp(&conn)?;
    let edge_count = candidate_edge_count + structural_edge_count + ontology_edge_count;
    let run_id = format!(
        "kb-run-{}-{}",
        stable_hash(book_id),
        stable_hash(&format!("{built_at}:{edge_count}:{}", candidates.len()))
    );
    conn.execute(
        "INSERT OR REPLACE INTO kb_build_runs(
           run_id,
           book_id,
           task,
           source_version,
           status,
           progress_json,
           error_message,
           started_at,
           finished_at
         )
         VALUES (?1, ?2, ?3, ?4, 'completed', ?5, NULL, datetime('now'), datetime('now'))",
        params![
            run_id,
            book_id,
            KNOWLEDGE_GRAPH_TASK,
            KB_SOURCE_VERSION,
            json!({
                "candidateCount": candidates.len(),
                "edgeCount": edge_count,
                "ontologyEdgeCount": ontology_edge_count,
                "seedCount": scaffold_stats.seed_count,
                "sectionCount": scaffold_stats.section_count,
                "scannedChunkCount": scaffold_stats.scanned_chunk_count,
            })
            .to_string()
        ],
    )
    .context("failed to record knowledge graph build run")?;

    let card_count = conn
        .query_row(
            "SELECT COUNT(1)
             FROM kb_cards
             WHERE book_id = ?1
               AND status != 'rejected'
               AND deleted_at IS NULL",
            params![book_id],
            |row| row.get::<_, i64>(0),
        )
        .context("failed to count knowledge graph cards")? as usize;

    Ok(BuildKnowledgeGraphResponse {
        book_id: book_id.to_string(),
        card_count,
        edge_count,
        candidate_count: candidates.len(),
        built_at,
    })
}

pub fn get_knowledge_graph(db_path: &Path, book_id: &str) -> Result<KnowledgeGraphResponse> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let cards = list_cards_for_conn(&conn, book_id)?;
    let edges = list_edges_for_conn(&conn, book_id)?;
    let mut node_ids = BTreeSet::<String>::new();
    for edge in &edges {
        node_ids.insert(edge.source_card_id.clone());
        node_ids.insert(edge.target_card_id.clone());
    }

    let mut nodes = Vec::new();
    for card in &cards {
        if nodes.len() >= MAX_GRAPH_NODES && !node_ids.contains(&card.card_id) {
            continue;
        }
        if node_ids.contains(&card.card_id)
            || matches!(
                card.card_type.as_str(),
                "highlight"
                    | "interpretation"
                    | "question"
                    | "note"
                    | "entity"
                    | "concept"
                    | "event"
                    | "claim"
                    | "summary"
            )
        {
            nodes.push(card_to_graph_node(card));
        }
        if nodes.len() >= MAX_GRAPH_NODES && node_ids.len() <= nodes.len() {
            break;
        }
    }

    let retained_ids = nodes
        .iter()
        .map(|node| node.card_id.clone())
        .collect::<BTreeSet<_>>();
    let retained_edges = edges
        .into_iter()
        .filter(|edge| {
            retained_ids.contains(&edge.source_card_id)
                && retained_ids.contains(&edge.target_card_id)
        })
        .collect::<Vec<_>>();
    let built_at = latest_graph_build_time(&conn, book_id)?;

    Ok(KnowledgeGraphResponse {
        book_id: book_id.to_string(),
        nodes,
        edges: retained_edges,
        built_at,
    })
}

pub fn get_card(db_path: &Path, book_id: &str, card_id: &str) -> Result<Option<KnowledgeCard>> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let evidence = list_evidence_for_book(&conn, book_id)?;
    let mut evidence_by_card = BTreeMap::<String, Vec<KnowledgeEvidence>>::new();
    for item in evidence {
        evidence_by_card
            .entry(item.card_id.clone())
            .or_default()
            .push(item);
    }
    let mut card = conn
        .query_row(
            "SELECT card_id,
                    book_id,
                    card_type,
                    title,
                    summary,
                    body_markdown,
                    payload_json,
                    status,
                    source,
                    confidence,
                    source_version,
                    user_locked,
                    strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at,
                    strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) AS updated_at
             FROM kb_cards
             WHERE book_id = ?1
               AND card_id = ?2
               AND deleted_at IS NULL",
            params![book_id, card_id],
            row_to_card,
        )
        .optional()
        .context("failed to load knowledge card")?;
    if let Some(card) = &mut card {
        card.evidence = evidence_by_card.remove(&card.card_id).unwrap_or_default();
        card.drift_count = drift_count_for_card(&conn, card)?;
    }
    Ok(card)
}

pub fn upsert_user_card(
    db_path: &Path,
    request: UpsertKnowledgeCardRequest,
) -> Result<KnowledgeCard> {
    let conn = storage::open_database(db_path)?;
    validate_card_status(&request.status)?;
    validate_card_type(&request.card_type)?;
    let book_exists = conn
        .query_row(
            "SELECT 1 FROM books WHERE id = ?1",
            params![request.book_id],
            |_| Ok(()),
        )
        .optional()
        .context("failed to check knowledge card book")?
        .is_some();
    if !book_exists {
        return Err(anyhow!("book not found for knowledge card"));
    }
    let now = sqlite_timestamp(&conn)?;
    let card_id = request
        .card_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            format!(
                "kb-user-{}",
                stable_hash(&format!(
                    "{}:{}:{}:{}",
                    request.book_id, request.card_type, request.title, now
                ))
            )
        });
    let payload_json = request
        .payload_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("{}");
    serde_json::from_str::<Value>(payload_json)
        .context("knowledge card payload_json must be JSON")?;
    let title = request.title.trim();
    if title.is_empty() {
        return Err(anyhow!("knowledge card title cannot be empty"));
    }
    let summary = request.summary.trim();
    let body_markdown = request.body_markdown.trim();
    conn.execute(
        "INSERT INTO kb_cards(
           card_id,
           book_id,
           card_type,
           title,
           summary,
           body_markdown,
           payload_json,
           status,
           source,
           confidence,
           source_version,
           user_locked,
           created_at,
           updated_at,
           deleted_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'user', 1.0, ?9, 1, datetime('now'), datetime('now'), NULL)
         ON CONFLICT(card_id) DO UPDATE SET
           card_type = excluded.card_type,
           title = excluded.title,
           summary = excluded.summary,
           body_markdown = excluded.body_markdown,
           payload_json = excluded.payload_json,
           status = excluded.status,
           source = CASE WHEN kb_cards.source = 'auto' THEN 'user' ELSE kb_cards.source END,
           confidence = CASE WHEN kb_cards.confidence < 1.0 THEN 1.0 ELSE kb_cards.confidence END,
           source_version = excluded.source_version,
           user_locked = 1,
           updated_at = datetime('now'),
           deleted_at = NULL
         WHERE kb_cards.book_id = excluded.book_id",
        params![
            card_id,
            request.book_id,
            request.card_type,
            title,
            summary,
            body_markdown,
            payload_json,
            request.status,
            KB_SOURCE_VERSION,
        ],
    )
    .context("failed to upsert user knowledge card")?;
    replace_evidence(
        &conn,
        &card_id,
        &request.book_id,
        &request.evidence_chunk_ids,
        &[],
        if body_markdown.is_empty() {
            summary
        } else {
            body_markdown
        },
    )?;
    get_card(&db_path.to_path_buf(), &request.book_id, &card_id)?
        .ok_or_else(|| anyhow!("upserted knowledge card was not found"))
}

pub fn confirm_card(db_path: &Path, book_id: &str, card_id: &str) -> Result<KnowledgeCard> {
    set_card_status(db_path, book_id, card_id, "confirmed")
}

pub fn reject_card(db_path: &Path, book_id: &str, card_id: &str) -> Result<KnowledgeCard> {
    set_card_status(db_path, book_id, card_id, "rejected")
}

pub fn delete_card(db_path: &Path, book_id: &str, card_id: &str) -> Result<()> {
    let conn = storage::open_database(db_path)?;
    conn.execute(
        "UPDATE kb_cards
         SET deleted_at = datetime('now'), updated_at = datetime('now'), user_locked = 1
         WHERE book_id = ?1 AND card_id = ?2",
        params![book_id, card_id],
    )
    .context("failed to soft delete knowledge card")?;
    conn.execute(
        "UPDATE kb_edges
         SET deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE book_id = ?1 AND (source_card_id = ?2 OR target_card_id = ?2)",
        params![book_id, card_id],
    )
    .context("failed to soft delete knowledge card edges")?;
    Ok(())
}

pub fn list_cards_by_chunk(
    db_path: &Path,
    book_id: &str,
    chunk_id: &str,
) -> Result<Vec<KnowledgeCard>> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let mut cards = conn
        .prepare(
            "SELECT c.card_id,
                    c.book_id,
                    c.card_type,
                    c.title,
                    c.summary,
                    c.body_markdown,
                    c.payload_json,
                    c.status,
                    c.source,
                    c.confidence,
                    c.source_version,
                    c.user_locked,
                    strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at) AS created_at,
                    strftime('%Y-%m-%dT%H:%M:%SZ', c.updated_at) AS updated_at
             FROM kb_cards c
             INNER JOIN kb_evidence e ON e.card_id = c.card_id
             WHERE c.book_id = ?1
               AND e.book_id = ?1
               AND e.chunk_id = ?2
               AND c.status != 'rejected'
               AND c.deleted_at IS NULL
             GROUP BY c.card_id
             ORDER BY c.updated_at DESC, c.created_at DESC",
        )
        .context("failed to prepare knowledge cards by chunk")?
        .query_map(params![book_id, chunk_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map knowledge cards by chunk")?;
    hydrate_cards(&conn, book_id, &mut cards)?;
    Ok(cards)
}

pub fn knowledge_health(db_path: &Path, book_id: &str) -> Result<KnowledgeHealth> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let drift = list_drift_for_conn(&conn, book_id)?;
    let (card_count, confirmed_count, candidate_count, rejected_count, latest_updated_at) =
        conn.query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN status != 'rejected' AND deleted_at IS NULL THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN status = 'confirmed' AND deleted_at IS NULL THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN status = 'candidate' AND deleted_at IS NULL THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN status = 'rejected' OR deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0),
               MAX(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at))
             FROM kb_cards
             WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as usize,
                    row.get::<_, i64>(1)? as usize,
                    row.get::<_, i64>(2)? as usize,
                    row.get::<_, i64>(3)? as usize,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .context("failed to compute knowledge health")?;
    let edge_count = conn
        .query_row(
            "SELECT COUNT(1)
             FROM kb_edges
             WHERE book_id = ?1 AND status != 'rejected' AND deleted_at IS NULL",
            params![book_id],
            |row| row.get::<_, i64>(0),
        )
        .context("failed to count knowledge edges")? as usize;
    Ok(KnowledgeHealth {
        book_id: book_id.to_string(),
        card_count,
        confirmed_count,
        candidate_count,
        rejected_count,
        drift_count: drift.len(),
        edge_count,
        latest_updated_at,
    })
}

pub fn list_drift(db_path: &Path, book_id: &str) -> Result<Vec<KnowledgeDrift>> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    list_drift_for_conn(&conn, book_id)
}

pub fn search_knowledge(
    db_path: &Path,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<KnowledgeSearchHit>> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    search_knowledge_cards_for_conn(&conn, book_id, query, limit as usize)
}

pub fn search_knowledge_hits(
    db_path: &Path,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<storage::SearchHit>> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let card_hits = search_knowledge_cards_for_conn(
        &conn,
        book_id,
        query,
        MAX_KNOWLEDGE_SEARCH_CARDS.min((limit as usize).saturating_mul(2).max(4)),
    )?;
    let mut chunk_scores = BTreeMap::<String, f64>::new();
    for card in card_hits {
        let card_boost = if card.status == "confirmed" {
            0.18
        } else {
            0.0
        };
        for (index, chunk_id) in card.evidence_chunk_ids.iter().enumerate() {
            let score = card.score + card.confidence + card_boost - (index as f64 * 0.01);
            chunk_scores
                .entry(chunk_id.clone())
                .and_modify(|current| {
                    if score > *current {
                        *current = score;
                    }
                })
                .or_insert(score);
        }
    }
    let mut hits = Vec::new();
    for (chunk_id, score) in chunk_scores {
        if let Some(mut hit) = search_hit_for_chunk(&conn, book_id, &chunk_id, score)? {
            hit.snippet = format!("知识层命中：{}", hit.snippet);
            hits.push(hit);
        }
    }
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.page_index.cmp(&right.page_index))
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    hits.truncate(MAX_KNOWLEDGE_SEARCH_HITS.min(limit as usize));
    Ok(hits)
}

pub fn knowledge_context_for_query(
    db_path: &Path,
    book_id: &str,
    query: &str,
    limit: u32,
) -> Result<KnowledgeContextResponse> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let limit = (limit as usize).clamp(1, 10);
    let hits = search_knowledge_cards_for_conn(&conn, book_id, query, limit)?;
    let hit_ids = hits
        .iter()
        .map(|hit| hit.card_id.as_str())
        .collect::<BTreeSet<_>>();
    let cards_by_id = list_cards_for_conn(&conn, book_id)?
        .into_iter()
        .map(|card| (card.card_id.clone(), card))
        .collect::<BTreeMap<_, _>>();
    let edges = list_edges_for_conn(&conn, book_id)?;
    let context_cards = hits
        .iter()
        .filter_map(|hit| cards_by_id.get(&hit.card_id))
        .map(|card| KnowledgeContextCard {
            card_id: card.card_id.clone(),
            title: card.title.clone(),
            card_type: card.card_type.clone(),
            status: card.status.clone(),
            source: card.source.clone(),
            confidence: card.confidence,
            summary: card.summary.clone(),
            evidence_chunk_ids: card
                .evidence
                .iter()
                .map(|item| item.chunk_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .take(12)
                .collect(),
        })
        .collect::<Vec<_>>();
    let context_edges = edges
        .into_iter()
        .filter(|edge| {
            hit_ids.contains(edge.source_card_id.as_str())
                || hit_ids.contains(edge.target_card_id.as_str())
        })
        .filter_map(|edge| {
            let source = cards_by_id.get(&edge.source_card_id)?;
            let target = cards_by_id.get(&edge.target_card_id)?;
            Some(KnowledgeContextEdge {
                edge_type: edge.edge_type,
                label: edge.label,
                source_title: source.title.clone(),
                target_title: target.title.clone(),
                evidence_chunk_ids: edge.evidence_chunk_ids.into_iter().take(8).collect(),
                confidence: edge.confidence,
            })
        })
        .take(18)
        .collect::<Vec<_>>();
    let station_count = context_cards
        .iter()
        .filter(|card| !card.evidence_chunk_ids.is_empty())
        .count();
    let evidence_chunk_ids = context_cards
        .iter()
        .flat_map(|card| card.evidence_chunk_ids.iter().cloned())
        .chain(
            context_edges
                .iter()
                .flat_map(|edge| edge.evidence_chunk_ids.iter().cloned()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(32)
        .collect::<Vec<_>>();
    Ok(KnowledgeContextResponse {
        book_id: book_id.to_string(),
        query: query.to_string(),
        cards: context_cards,
        edges: context_edges,
        station_count,
        evidence_chunk_ids,
    })
}

pub fn export_book_knowledge_json(
    db_path: &Path,
    book_id: &str,
) -> Result<ExportBookKnowledgeJsonResponse> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let cards = list_cards_for_conn(&conn, book_id)?;
    let edges = list_edges_for_conn(&conn, book_id)?;
    let generated_at = sqlite_timestamp(&conn)?;
    Ok(ExportBookKnowledgeJsonResponse {
        book_id: book_id.to_string(),
        generated_at,
        cards,
        edges,
    })
}

pub fn get_book_knowledge_map(db_path: &Path, book_id: &str) -> Result<KnowledgeMapResponse> {
    let conn = storage::open_database(db_path)?;
    backfill_cards_for_book(&conn, book_id)?;
    let cards = list_cards_for_conn(&conn, book_id)?;
    let edges = list_edges_for_conn(&conn, book_id)?;
    let station_cards = cards
        .iter()
        .filter(|card| {
            !card.evidence.is_empty()
                && matches!(
                    card.card_type.as_str(),
                    "event"
                        | "claim"
                        | "concept"
                        | "entity"
                        | "highlight"
                        | "interpretation"
                        | "note"
                        | "summary"
                )
        })
        .collect::<Vec<_>>();
    let mut line_ranges = BTreeMap::<String, (u32, u32, usize)>::new();
    let mut stations = Vec::new();
    let mut card_to_station = BTreeMap::<String, String>::new();
    for (index, card) in station_cards.iter().enumerate() {
        let page_index = first_page_index(card);
        let line_id = line_id_for_page(page_index);
        let entry = line_ranges.entry(line_id.clone()).or_insert((
            page_index.unwrap_or(0),
            page_index.unwrap_or(0),
            0,
        ));
        if let Some(page) = page_index {
            entry.0 = entry.0.min(page);
            entry.1 = entry.1.max(page);
        }
        entry.2 += 1;
        let station_id = format!("kb-station-{}", stable_hash(&card.card_id));
        card_to_station.insert(card.card_id.clone(), station_id.clone());
        let payload = serde_json::from_str::<Value>(&card.payload_json).unwrap_or(Value::Null);
        stations.push(KnowledgeMapStation {
            station_id,
            card_id: card.card_id.clone(),
            line_id,
            title: card.title.clone(),
            card_type: card.card_type.clone(),
            status: card.status.clone(),
            page_index,
            time_raw: string_payload(&payload, "timeRaw")
                .or_else(|| string_payload(&payload, "time_raw")),
            time_norm: string_payload(&payload, "timeNorm")
                .or_else(|| string_payload(&payload, "time_norm")),
            time_order: page_index
                .map(|page| page.saturating_mul(1000).saturating_add(index as u32))
                .unwrap_or(index as u32),
            time_source: string_payload(&payload, "timeSource")
                .or_else(|| string_payload(&payload, "time_source"))
                .or_else(|| Some("reading_order".to_string())),
            people: string_vec_payload(&payload, "people"),
            places: string_vec_payload(&payload, "places"),
            evidence: card.evidence.clone(),
        });
    }
    stations.sort_by(|left, right| {
        left.time_order
            .cmp(&right.time_order)
            .then_with(|| left.title.cmp(&right.title))
    });
    let mut lines = line_ranges
        .into_iter()
        .map(
            |(line_id, (page_start, page_end, station_count))| KnowledgeMapLine {
                title: if line_id == "line-unknown" {
                    "未定位".to_string()
                } else {
                    format!("第 {} 页段", page_start / 10 + 1)
                },
                line_id,
                page_start,
                page_end,
                station_count,
            },
        )
        .collect::<Vec<_>>();
    lines.sort_by(|left, right| left.page_start.cmp(&right.page_start));
    let transfers = edges
        .into_iter()
        .filter_map(|edge| {
            let source_station_id = card_to_station.get(&edge.source_card_id)?.clone();
            let target_station_id = card_to_station.get(&edge.target_card_id)?.clone();
            Some(KnowledgeMapTransfer {
                edge_id: edge.edge_id,
                source_station_id,
                target_station_id,
                edge_type: edge.edge_type,
                label: edge.label,
                evidence_chunk_ids: edge.evidence_chunk_ids,
                confidence: edge.confidence,
                status: edge.status,
            })
        })
        .collect::<Vec<_>>();
    let built_at = latest_graph_build_time(&conn, book_id)?;
    Ok(KnowledgeMapResponse {
        book_id: book_id.to_string(),
        lines,
        stations,
        transfers,
        built_at,
    })
}

pub fn create_card_for_highlight(
    conn: &Connection,
    highlight: &SavedHighlight,
    input: HighlightKnowledgeInput<'_>,
) -> Result<()> {
    let card_id = source_card_id("highlight", &highlight.id);
    let should_replace_evidence = can_replace_evidence(conn, &card_id)?;
    let title = title_from_text(&highlight.selection_text, "高亮");
    let summary = summary_from_text(&highlight.selection_text, 160);
    let mut body_markdown = highlight.selection_text.trim().to_string();
    if let Some(interpretation) = highlight
        .interpretation
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body_markdown = format!("{body_markdown}\n\n> {interpretation}");
    }
    let payload_json = json!({
        "sourceTable": "highlights",
        "sourceId": highlight.id,
        "pageIndex": highlight.page_index,
        "positionStart": highlight.position_start,
        "positionEnd": highlight.position_end,
        "coordinateVersion": highlight.coordinate_version,
    })
    .to_string();
    upsert_card(
        conn,
        CardUpsert {
            card_id: &card_id,
            book_id: &highlight.book_id,
            card_type: "highlight",
            title: &title,
            summary: &summary,
            body_markdown: &body_markdown,
            payload_json: &payload_json,
            status: "confirmed",
            source: "highlight",
            confidence: 1.0,
        },
    )?;

    let evidence_ids = if input.evidence_chunk_ids.is_empty() {
        Vec::new()
    } else {
        input.evidence_chunk_ids.to_vec()
    };
    if should_replace_evidence {
        replace_evidence(
            conn,
            &card_id,
            &highlight.book_id,
            &evidence_ids,
            input.evidence_chunk_snapshots,
            highlight.selection_text.trim(),
        )?;
    }
    Ok(())
}

pub fn create_card_for_interpretation(
    conn: &Connection,
    interpretation: &SavedInterpretation,
) -> Result<()> {
    let card_id = source_card_id("interpretation", &interpretation.id);
    let should_replace_evidence = can_replace_evidence(conn, &card_id)?;
    let card_type = match interpretation.kind.as_str() {
        "spark" => "question",
        "note" => "note",
        _ => "interpretation",
    };
    let source = match interpretation.kind.as_str() {
        "note" => "user",
        "spark" => "interpretation",
        _ => "interpretation",
    };
    let title = interpretation
        .question
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| title_from_text(value, "追问"))
        .unwrap_or_else(|| title_from_text(&interpretation.selection_text, "解读"));
    let summary = summary_from_text(&interpretation.answer, 180);
    let body_markdown = if let Some(question) = interpretation
        .question
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        format!(
            "### 问题\n{question}\n\n### 回答\n{}",
            interpretation.answer.trim()
        )
    } else if interpretation.selection_text.trim().is_empty() {
        interpretation.answer.trim().to_string()
    } else {
        format!(
            "### 选区\n{}\n\n### 解读\n{}",
            interpretation.selection_text.trim(),
            interpretation.answer.trim()
        )
    };
    let payload_json = json!({
        "sourceTable": "interpretations",
        "sourceId": interpretation.id,
        "sessionId": interpretation.session_id,
        "turnIndex": interpretation.turn_index,
        "answerSource": interpretation.answer_source.as_str(),
        "kind": interpretation.kind.as_str(),
        "pageIndexes": interpretation.page_indexes,
        "pageIndex": interpretation.page_index,
        "positionStart": interpretation.position_start,
        "positionEnd": interpretation.position_end,
    })
    .to_string();
    let confidence = if interpretation.answer_source.as_str() == "local_fallback" {
        0.68
    } else {
        0.9
    };
    upsert_card(
        conn,
        CardUpsert {
            card_id: &card_id,
            book_id: &interpretation.book_id,
            card_type,
            title: &title,
            summary: &summary,
            body_markdown: &body_markdown,
            payload_json: &payload_json,
            status: "confirmed",
            source,
            confidence,
        },
    )?;
    if should_replace_evidence {
        replace_evidence(
            conn,
            &card_id,
            &interpretation.book_id,
            &interpretation.evidence_chunk_ids,
            &interpretation.evidence_chunk_snapshots,
            interpretation.selection_text.trim(),
        )?;
    }
    Ok(())
}

pub fn delete_card_for_source(
    conn: &Connection,
    source_prefix: &str,
    source_id: &str,
) -> Result<()> {
    let card_id = source_card_id(source_prefix, source_id);
    conn.execute("DELETE FROM kb_cards WHERE card_id = ?1", params![card_id])
        .context("failed to delete source knowledge card")?;
    Ok(())
}

#[derive(Debug, Clone)]
struct CandidateDraft {
    card_type: String,
    kind: String,
    title: String,
    normalized_title: String,
    summary: String,
    snippets: Vec<String>,
    source_card_ids: BTreeSet<String>,
    source_evidence: BTreeMap<String, BTreeSet<String>>,
    source_relations: BTreeMap<String, BTreeSet<String>>,
    evidence_chunk_ids: BTreeSet<String>,
    page_indexes: BTreeSet<u32>,
    confidence: f64,
}

#[derive(Debug, Clone)]
struct CandidateTerm {
    title: String,
    kind: String,
}

#[derive(Debug, Clone)]
struct BookKnowledgeChunk {
    chunk_id: String,
    page_index: u32,
    text: String,
    markdown: String,
}

#[derive(Debug, Clone, Default)]
struct KnowledgeScaffoldStats {
    seed_count: usize,
    section_count: usize,
    scanned_chunk_count: usize,
}

fn extract_candidate_drafts(cards: &[KnowledgeCard]) -> Vec<CandidateDraft> {
    let mut drafts = BTreeMap::<String, CandidateDraft>::new();
    for card in cards.iter().filter(|card| is_extraction_source_card(card)) {
        let text = text_for_candidate_extraction(card);
        let relations = relation_types_for_text(&text);
        for term in extract_candidate_terms(&text) {
            let card_type = card_type_for_term(&term.title, &term.kind, &text);
            add_candidate_draft(
                &mut drafts,
                card,
                &card_type,
                &term.kind,
                &term.title,
                snippet_for_term(&text, &term.title),
                &relations,
            );
        }
        for sentence in extract_event_sentences(&text) {
            add_candidate_draft(
                &mut drafts,
                card,
                "event",
                "event",
                &title_from_text(&sentence, "事件"),
                sentence,
                &relations,
            );
        }
    }

    let mut candidates = drafts
        .into_values()
        .filter(|candidate| !candidate.evidence_chunk_ids.is_empty())
        .collect::<Vec<_>>();
    for candidate in &mut candidates {
        let evidence_count = candidate.evidence_chunk_ids.len();
        let source_count = candidate.source_card_ids.len();
        candidate.summary = format!(
            "自动候选：{}。来自 {} 张知识卡片、{} 条原文证据。",
            candidate.title, source_count, evidence_count
        );
        candidate.confidence = confidence_for_candidate(candidate);
    }
    candidates.sort_by(|left, right| {
        right
            .source_card_ids
            .len()
            .cmp(&left.source_card_ids.len())
            .then(
                right
                    .evidence_chunk_ids
                    .len()
                    .cmp(&left.evidence_chunk_ids.len()),
            )
            .then(left.title.cmp(&right.title))
    });
    candidates.truncate(MAX_GRAPH_CANDIDATES);
    candidates
}

fn extract_book_candidate_drafts(chunks: &[BookKnowledgeChunk]) -> Vec<CandidateDraft> {
    let mut drafts = BTreeMap::<String, CandidateDraft>::new();
    for chunk in chunks {
        let text = chunk
            .text
            .trim()
            .chars()
            .take(MAX_TEXT_PER_CARD_CHARS)
            .collect::<String>();
        if text.chars().count() < 24 {
            continue;
        }
        for term in extract_candidate_terms(&text).into_iter().take(18) {
            let card_type = card_type_for_term(&term.title, &term.kind, &text);
            add_book_candidate_draft(
                &mut drafts,
                chunk,
                &card_type,
                &term.kind,
                &term.title,
                snippet_for_term(&text, &term.title),
            );
        }
        for sentence in extract_event_sentences(&text).into_iter().take(3) {
            add_book_candidate_draft(
                &mut drafts,
                chunk,
                "event",
                "event",
                &title_from_text(&sentence, "事件"),
                sentence,
            );
        }
    }

    let mut candidates = drafts
        .into_values()
        .filter(|candidate| !candidate.evidence_chunk_ids.is_empty())
        .collect::<Vec<_>>();
    for candidate in &mut candidates {
        let evidence_count = candidate.evidence_chunk_ids.len();
        let page_count = candidate.page_indexes.len();
        candidate.summary = format!(
            "整书自动索引：{}。出现于 {} 条原文证据、{} 个页段。",
            candidate.title, evidence_count, page_count
        );
        candidate.confidence = confidence_for_candidate(candidate);
    }
    candidates.sort_by(|left, right| {
        right
            .evidence_chunk_ids
            .len()
            .cmp(&left.evidence_chunk_ids.len())
            .then(right.page_indexes.len().cmp(&left.page_indexes.len()))
            .then(left.title.cmp(&right.title))
    });
    candidates.truncate(MAX_GRAPH_CANDIDATES);
    candidates
}

fn merge_candidate_drafts(candidate_sets: Vec<Vec<CandidateDraft>>) -> Vec<CandidateDraft> {
    let mut merged = BTreeMap::<String, CandidateDraft>::new();
    for candidate in candidate_sets.into_iter().flatten() {
        let key = format!("{}:{}", candidate.card_type, candidate.normalized_title);
        if let Some(existing) = merged.get_mut(&key) {
            existing.source_card_ids.extend(candidate.source_card_ids);
            existing
                .evidence_chunk_ids
                .extend(candidate.evidence_chunk_ids);
            existing.page_indexes.extend(candidate.page_indexes);
            for (source_id, evidence_ids) in candidate.source_evidence {
                existing
                    .source_evidence
                    .entry(source_id)
                    .or_default()
                    .extend(evidence_ids);
            }
            for (source_id, relations) in candidate.source_relations {
                existing
                    .source_relations
                    .entry(source_id)
                    .or_default()
                    .extend(relations);
            }
            for snippet in candidate.snippets {
                if !existing.snippets.iter().any(|item| item == &snippet) {
                    existing.snippets.push(snippet);
                }
            }
            existing.snippets.truncate(6);
            existing.confidence = existing.confidence.max(candidate.confidence);
        } else {
            merged.insert(key, candidate);
        }
    }

    let mut candidates = merged.into_values().collect::<Vec<_>>();
    for candidate in &mut candidates {
        let evidence_count = candidate.evidence_chunk_ids.len();
        let page_count = candidate.page_indexes.len();
        let source_count = candidate.source_card_ids.len();
        candidate.summary = if source_count > 0 {
            format!(
                "自动候选：{}。来自 {} 张知识卡片、{} 条原文证据、{} 个页段。",
                candidate.title, source_count, evidence_count, page_count
            )
        } else {
            format!(
                "整书自动索引：{}。出现于 {} 条原文证据、{} 个页段。",
                candidate.title, evidence_count, page_count
            )
        };
        candidate.confidence = confidence_for_candidate(candidate);
    }
    candidates.sort_by(|left, right| {
        right
            .evidence_chunk_ids
            .len()
            .cmp(&left.evidence_chunk_ids.len())
            .then(right.source_card_ids.len().cmp(&left.source_card_ids.len()))
            .then(left.title.cmp(&right.title))
    });
    candidates.truncate(MAX_GRAPH_CANDIDATES);
    candidates
}

fn add_candidate_draft(
    drafts: &mut BTreeMap<String, CandidateDraft>,
    card: &KnowledgeCard,
    card_type: &str,
    kind: &str,
    raw_title: &str,
    snippet: String,
    relations: &BTreeSet<String>,
) {
    let title = clean_candidate_title(raw_title);
    let normalized_title = normalize_candidate_title(&title);
    if !is_valid_candidate_title(&title, &normalized_title) {
        return;
    }
    let key = format!("{card_type}:{normalized_title}");
    let entry = drafts.entry(key).or_insert_with(|| CandidateDraft {
        card_type: card_type.to_string(),
        kind: kind.to_string(),
        title: title.clone(),
        normalized_title,
        summary: String::new(),
        snippets: Vec::new(),
        source_card_ids: BTreeSet::new(),
        source_evidence: BTreeMap::new(),
        source_relations: BTreeMap::new(),
        evidence_chunk_ids: BTreeSet::new(),
        page_indexes: BTreeSet::new(),
        confidence: 0.0,
    });
    entry.source_card_ids.insert(card.card_id.clone());
    let source_evidence = entry
        .source_evidence
        .entry(card.card_id.clone())
        .or_default();
    for evidence in &card.evidence {
        source_evidence.insert(evidence.chunk_id.clone());
        entry.evidence_chunk_ids.insert(evidence.chunk_id.clone());
        if let Some(page_index) = evidence.page_index {
            entry.page_indexes.insert(page_index);
        }
    }
    if !relations.is_empty() {
        entry
            .source_relations
            .entry(card.card_id.clone())
            .or_default()
            .extend(relations.iter().cloned());
    }
    let snippet = summary_from_text(&snippet, 120);
    if !snippet.is_empty() && !entry.snippets.iter().any(|item| item == &snippet) {
        entry.snippets.push(snippet);
        if entry.snippets.len() > 4 {
            entry.snippets.truncate(4);
        }
    }
}

fn add_book_candidate_draft(
    drafts: &mut BTreeMap<String, CandidateDraft>,
    chunk: &BookKnowledgeChunk,
    card_type: &str,
    kind: &str,
    raw_title: &str,
    snippet: String,
) {
    let title = clean_candidate_title(raw_title);
    let normalized_title = normalize_candidate_title(&title);
    if !is_valid_candidate_title(&title, &normalized_title) {
        return;
    }
    let key = format!("{card_type}:{normalized_title}");
    let entry = drafts.entry(key).or_insert_with(|| CandidateDraft {
        card_type: card_type.to_string(),
        kind: kind.to_string(),
        title: title.clone(),
        normalized_title,
        summary: String::new(),
        snippets: Vec::new(),
        source_card_ids: BTreeSet::new(),
        source_evidence: BTreeMap::new(),
        source_relations: BTreeMap::new(),
        evidence_chunk_ids: BTreeSet::new(),
        page_indexes: BTreeSet::new(),
        confidence: 0.0,
    });
    if entry.evidence_chunk_ids.len() < MAX_EVIDENCE_PER_AUTO_CARD {
        entry.evidence_chunk_ids.insert(chunk.chunk_id.clone());
    }
    entry.page_indexes.insert(chunk.page_index);
    let relations = relation_types_for_text(&chunk.text);
    if !relations.is_empty() {
        entry
            .source_relations
            .entry(format!("chunk:{}", chunk.chunk_id))
            .or_default()
            .extend(relations);
    }
    let snippet = summary_from_text(&snippet, 140);
    if !snippet.is_empty() && !entry.snippets.iter().any(|item| item == &snippet) {
        entry.snippets.push(snippet);
        if entry.snippets.len() > 6 {
            entry.snippets.truncate(6);
        }
    }
}

fn upsert_candidate_card(
    conn: &Connection,
    book_id: &str,
    candidate: &CandidateDraft,
) -> Result<()> {
    let card_id = candidate_card_id(book_id, candidate);
    let should_replace_evidence = can_replace_evidence(conn, &card_id)?;
    let payload_json = json!({
        "extractor": "local-heuristic",
        "kind": candidate.kind,
        "normalizedTitle": candidate.normalized_title,
        "sourceCardIds": candidate.source_card_ids.iter().cloned().collect::<Vec<_>>(),
        "pageIndexes": candidate.page_indexes.iter().cloned().collect::<Vec<_>>(),
    })
    .to_string();
    let body_markdown = render_candidate_body(candidate);
    conn.execute(
        "INSERT INTO kb_cards(
           card_id,
           book_id,
           card_type,
           title,
           summary,
           body_markdown,
           payload_json,
           status,
           source,
           confidence,
           source_version,
           user_locked,
           created_at,
           updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'candidate', 'auto', ?8, ?9, 0, datetime('now'), datetime('now'))
         ON CONFLICT(card_id) DO UPDATE SET
           card_type = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.card_type ELSE kb_cards.card_type END,
           title = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.title ELSE kb_cards.title END,
           summary = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.summary ELSE kb_cards.summary END,
           body_markdown = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.body_markdown ELSE kb_cards.body_markdown END,
           payload_json = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.payload_json ELSE kb_cards.payload_json END,
           status = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.status ELSE kb_cards.status END,
           source = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.source ELSE kb_cards.source END,
           confidence = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.confidence ELSE kb_cards.confidence END,
           source_version = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.source_version ELSE kb_cards.source_version END,
           deleted_at = CASE WHEN kb_cards.status = 'rejected' THEN kb_cards.deleted_at ELSE NULL END,
           updated_at = datetime('now')",
        params![
            card_id,
            book_id,
            candidate.card_type,
            candidate.title,
            candidate.summary,
            body_markdown,
            payload_json,
            candidate.confidence,
            KB_SOURCE_VERSION,
        ],
    )
    .context("failed to upsert knowledge graph candidate card")?;
    if should_replace_evidence {
        let evidence_ids = candidate
            .evidence_chunk_ids
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        replace_evidence(
            conn,
            &card_id,
            book_id,
            &evidence_ids,
            &[],
            &candidate.summary,
        )?;
    }
    Ok(())
}

fn upsert_candidate_edges(
    conn: &Connection,
    book_id: &str,
    candidates: &[CandidateDraft],
) -> Result<usize> {
    let mut count = 0;
    for candidate in candidates {
        let target_card_id = candidate_card_id(book_id, candidate);
        for source_card_id in &candidate.source_card_ids {
            let Some(evidence) = candidate.source_evidence.get(source_card_id) else {
                continue;
            };
            let evidence_chunk_ids = evidence.iter().cloned().collect::<Vec<_>>();
            if evidence_chunk_ids.is_empty() {
                continue;
            }
            upsert_edge(
                conn,
                EdgeUpsert {
                    book_id,
                    source_card_id,
                    target_card_id: &target_card_id,
                    edge_type: "mentions",
                    label: "提及候选",
                    evidence_chunk_ids: &evidence_chunk_ids,
                    confidence: (candidate.confidence * 0.9).min(0.86),
                    status: "candidate",
                },
            )?;
            count += 1;

            if let Some(relations) = candidate.source_relations.get(source_card_id) {
                for relation in relations {
                    let label = label_for_edge_type(relation);
                    upsert_edge(
                        conn,
                        EdgeUpsert {
                            book_id,
                            source_card_id,
                            target_card_id: &target_card_id,
                            edge_type: relation,
                            label,
                            evidence_chunk_ids: &evidence_chunk_ids,
                            confidence: (candidate.confidence * 0.72).min(0.72),
                            status: "candidate",
                        },
                    )?;
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

fn upsert_structural_edges(
    conn: &Connection,
    book_id: &str,
    cards: &[KnowledgeCard],
) -> Result<usize> {
    let source_cards = cards
        .iter()
        .filter(|card| is_structural_source_card(card))
        .collect::<Vec<_>>();
    let mut count = 0;
    let mut pairs = BTreeSet::<(String, String, String)>::new();
    let mut cards_by_chunk = BTreeMap::<String, Vec<&KnowledgeCard>>::new();
    for card in &source_cards {
        for evidence in &card.evidence {
            cards_by_chunk
                .entry(evidence.chunk_id.clone())
                .or_default()
                .push(card);
        }
    }
    for (chunk_id, chunk_cards) in cards_by_chunk {
        let mut unique_cards = BTreeMap::<String, &KnowledgeCard>::new();
        for card in chunk_cards {
            unique_cards.entry(card.card_id.clone()).or_insert(card);
        }
        let cards_for_chunk = unique_cards
            .into_values()
            .take(MAX_SAME_EVIDENCE_CARDS_PER_CHUNK)
            .collect::<Vec<_>>();
        for left_index in 0..cards_for_chunk.len() {
            for right_index in (left_index + 1)..cards_for_chunk.len() {
                let left = cards_for_chunk[left_index];
                let right = cards_for_chunk[right_index];
                let (source_card_id, target_card_id) = ordered_pair(&left.card_id, &right.card_id);
                if !pairs.insert((
                    source_card_id.to_string(),
                    target_card_id.to_string(),
                    "same_evidence".to_string(),
                )) {
                    continue;
                }
                let evidence_chunk_ids = vec![chunk_id.clone()];
                upsert_edge(
                    conn,
                    EdgeUpsert {
                        book_id,
                        source_card_id,
                        target_card_id,
                        edge_type: "same_evidence",
                        label: "共享原文证据",
                        evidence_chunk_ids: &evidence_chunk_ids,
                        confidence: 0.82,
                        status: "candidate",
                    },
                )?;
                count += 1;
            }
        }
    }

    let mut page_cards = source_cards
        .into_iter()
        .filter_map(|card| first_page_index(card).map(|page_index| (page_index, card)))
        .collect::<Vec<_>>();
    page_cards.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.created_at.cmp(&right.1.created_at))
            .then(left.1.card_id.cmp(&right.1.card_id))
    });
    for window in page_cards.windows(2) {
        let (left_page, left) = window[0];
        let (right_page, right) = window[1];
        if left.card_id == right.card_id || right_page.saturating_sub(left_page) > 1 {
            continue;
        }
        if cards_share_evidence(left, right) {
            continue;
        }
        let (source_card_id, target_card_id) = ordered_pair(&left.card_id, &right.card_id);
        if !pairs.insert((
            source_card_id.to_string(),
            target_card_id.to_string(),
            "nearby".to_string(),
        )) {
            continue;
        }
        let evidence_chunk_ids = union_evidence_chunk_ids(left, right, 4);
        if evidence_chunk_ids.is_empty() {
            continue;
        }
        upsert_edge(
            conn,
            EdgeUpsert {
                book_id,
                source_card_id,
                target_card_id,
                edge_type: "nearby",
                label: "章节邻近",
                evidence_chunk_ids: &evidence_chunk_ids,
                confidence: 0.58,
                status: "candidate",
            },
        )?;
        count += 1;
    }
    Ok(count)
}

fn upsert_book_ontology_edges(
    conn: &Connection,
    book_id: &str,
    cards: &[KnowledgeCard],
) -> Result<usize> {
    let mut count = 0;
    let active_cards = cards
        .iter()
        .filter(|card| card.status != "rejected" && !card.evidence.is_empty())
        .collect::<Vec<_>>();

    let section_cards = active_cards
        .iter()
        .copied()
        .filter(|card| card.card_type == "summary")
        .collect::<Vec<_>>();
    let indexed_cards = active_cards
        .iter()
        .copied()
        .filter(|card| {
            matches!(
                card.card_type.as_str(),
                "entity" | "concept" | "event" | "claim"
            )
        })
        .collect::<Vec<_>>();
    for section in &section_cards {
        let Some(section_page) = first_page_index(section) else {
            continue;
        };
        let section_chunks = section
            .evidence
            .iter()
            .map(|item| item.chunk_id.as_str())
            .collect::<BTreeSet<_>>();
        for card in indexed_cards.iter().take(600) {
            if section.card_id == card.card_id {
                continue;
            }
            let Some(card_page) = first_page_index(card) else {
                continue;
            };
            if card_page < section_page || card_page.saturating_sub(section_page) > 12 {
                continue;
            }
            let evidence_chunk_ids = card
                .evidence
                .iter()
                .filter(|item| section_chunks.contains(item.chunk_id.as_str()))
                .map(|item| item.chunk_id.clone())
                .take(6)
                .collect::<Vec<_>>();
            if evidence_chunk_ids.is_empty() {
                continue;
            }
            upsert_edge(
                conn,
                EdgeUpsert {
                    book_id,
                    source_card_id: &section.card_id,
                    target_card_id: &card.card_id,
                    edge_type: "part_of",
                    label: "章节包含",
                    evidence_chunk_ids: &evidence_chunk_ids,
                    confidence: 0.74,
                    status: "candidate",
                },
            )?;
            count += 1;
        }
    }

    let mut cards_by_normalized_title = BTreeMap::<String, Vec<&KnowledgeCard>>::new();
    for card in active_cards
        .iter()
        .copied()
        .filter(|card| matches!(card.card_type.as_str(), "entity" | "concept"))
    {
        cards_by_normalized_title
            .entry(normalize_candidate_title(&card.title))
            .or_default()
            .push(card);
    }
    for cards_with_title in cards_by_normalized_title.values() {
        if cards_with_title.len() < 2 {
            continue;
        }
        for pair in cards_with_title.windows(2) {
            let left = pair[0];
            let right = pair[1];
            let evidence_chunk_ids = union_evidence_chunk_ids(left, right, 6);
            if evidence_chunk_ids.is_empty() {
                continue;
            }
            let (source_card_id, target_card_id) = ordered_pair(&left.card_id, &right.card_id);
            upsert_edge(
                conn,
                EdgeUpsert {
                    book_id,
                    source_card_id,
                    target_card_id,
                    edge_type: "alias_of",
                    label: "同名/别名线索",
                    evidence_chunk_ids: &evidence_chunk_ids,
                    confidence: 0.66,
                    status: "candidate",
                },
            )?;
            count += 1;
        }
    }

    let mut sequence_cards = active_cards
        .into_iter()
        .filter(|card| matches!(card.card_type.as_str(), "event" | "claim" | "summary"))
        .filter_map(|card| first_page_index(card).map(|page| (page, card)))
        .collect::<Vec<_>>();
    sequence_cards.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.title.cmp(&right.1.title))
            .then_with(|| left.1.card_id.cmp(&right.1.card_id))
    });
    for window in sequence_cards.windows(2).take(180) {
        let (left_page, left) = window[0];
        let (right_page, right) = window[1];
        if left.card_id == right.card_id || right_page.saturating_sub(left_page) > 8 {
            continue;
        }
        let evidence_chunk_ids = union_evidence_chunk_ids(left, right, 4);
        if evidence_chunk_ids.is_empty() {
            continue;
        }
        upsert_edge(
            conn,
            EdgeUpsert {
                book_id,
                source_card_id: &left.card_id,
                target_card_id: &right.card_id,
                edge_type: "sequel",
                label: "阅读顺序",
                evidence_chunk_ids: &evidence_chunk_ids,
                confidence: 0.52,
                status: "candidate",
            },
        )?;
        count += 1;
    }

    Ok(count)
}

fn load_book_chunks_for_knowledge(
    conn: &Connection,
    book_id: &str,
) -> Result<Vec<BookKnowledgeChunk>> {
    conn.prepare(
        "SELECT chunk_id, page_index, text, markdown
         FROM chunks
         WHERE book_id = ?1
           AND TRIM(text) != ''
         ORDER BY page_index ASC, chunk_id ASC
         LIMIT ?2",
    )
    .context("failed to prepare full-book knowledge chunks")?
    .query_map(params![book_id, MAX_BOOK_SCAN_CHUNKS as u32], |row| {
        Ok(BookKnowledgeChunk {
            chunk_id: row.get(0)?,
            page_index: row.get(1)?,
            text: row.get(2)?,
            markdown: row.get(3)?,
        })
    })?
    .collect::<rusqlite::Result<Vec<_>>>()
    .context("failed to read full-book knowledge chunks")
}

fn ensure_book_seed_cards(
    conn: &Connection,
    book_id: &str,
    chunks: &[BookKnowledgeChunk],
) -> Result<KnowledgeScaffoldStats> {
    let mut stats = KnowledgeScaffoldStats {
        scanned_chunk_count: chunks.len(),
        ..KnowledgeScaffoldStats::default()
    };

    let mut scored_chunks = chunks
        .iter()
        .filter(|chunk| chunk.text.trim().chars().count() >= 48)
        .map(|chunk| (knowledge_seed_score(chunk), chunk))
        .collect::<Vec<_>>();
    scored_chunks.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.page_index.cmp(&right.1.page_index))
            .then_with(|| left.1.chunk_id.cmp(&right.1.chunk_id))
    });

    for (_, chunk) in scored_chunks.into_iter().take(MAX_BOOK_SEED_CARDS) {
        let clean = chunk.text.trim();
        let card_type = if looks_like_event_sentence(clean) {
            "event"
        } else {
            "claim"
        };
        let title_source =
            title_from_markdown_heading(&chunk.markdown).unwrap_or_else(|| clean.to_string());
        let title = title_from_text(&title_source, "书内片段");
        let summary = summary_from_text(clean, 220);
        let payload_json = json!({
            "sourceTable": "chunks",
            "sourceId": chunk.chunk_id,
            "pageIndex": chunk.page_index,
            "seed": "book-chunk",
            "extractor": "full-book-local",
            "timeOrder": chunk.page_index,
        })
        .to_string();
        let card_id = format!(
            "kb-seed-{}",
            stable_hash(&format!("{book_id}:{}:{card_type}", chunk.chunk_id))
        );
        let before = card_exists(conn, &card_id)?;
        upsert_card(
            conn,
            CardUpsert {
                card_id: &card_id,
                book_id,
                card_type,
                title: &title,
                summary: &summary,
                body_markdown: clean,
                payload_json: &payload_json,
                status: "candidate",
                source: "auto",
                confidence: 0.58,
            },
        )?;
        if can_replace_evidence(conn, &card_id)? {
            replace_evidence(
                conn,
                &card_id,
                book_id,
                std::slice::from_ref(&chunk.chunk_id),
                &[],
                &summary,
            )?;
        }
        if !before {
            stats.seed_count += 1;
        }
    }

    for section in build_book_sections(chunks)
        .into_iter()
        .take(MAX_BOOK_SECTION_CARDS)
    {
        let summary = summary_from_text(&section.body_text, 260);
        if summary.is_empty() || section.evidence_chunk_ids.is_empty() {
            continue;
        }
        let card_id = format!(
            "kb-section-{}",
            stable_hash(&format!(
                "{book_id}:{}:{}",
                section.title, section.page_start
            ))
        );
        let payload_json = json!({
            "sourceTable": "chunks",
            "sourceId": section.evidence_chunk_ids.first(),
            "pageIndex": section.page_start,
            "pageStart": section.page_start,
            "pageEnd": section.page_end,
            "seed": "section-summary",
            "extractor": "full-book-local",
        })
        .to_string();
        let before = card_exists(conn, &card_id)?;
        upsert_card(
            conn,
            CardUpsert {
                card_id: &card_id,
                book_id,
                card_type: "summary",
                title: &section.title,
                summary: &summary,
                body_markdown: &section.body_text,
                payload_json: &payload_json,
                status: "candidate",
                source: "auto",
                confidence: 0.64,
            },
        )?;
        if can_replace_evidence(conn, &card_id)? {
            replace_evidence(
                conn,
                &card_id,
                book_id,
                &section.evidence_chunk_ids,
                &[],
                &summary,
            )?;
        }
        if !before {
            stats.section_count += 1;
        }

        if let Some(first_chunk_id) = section.evidence_chunk_ids.first() {
            let concept_id = format!(
                "kb-section-concept-{}",
                stable_hash(&format!("{book_id}:section-heading:{}", section.title))
            );
            let concept_payload = json!({
                "sourceTable": "chunks",
                "sourceId": first_chunk_id,
                "pageIndex": section.page_start,
                "seed": "heading-concept",
                "extractor": "full-book-local",
            })
            .to_string();
            let concept_before = card_exists(conn, &concept_id)?;
            upsert_card(
                conn,
                CardUpsert {
                    card_id: &concept_id,
                    book_id,
                    card_type: "concept",
                    title: &section.title,
                    summary: &format!("章节/页段索引：{}", section.title),
                    body_markdown: &summary,
                    payload_json: &concept_payload,
                    status: "candidate",
                    source: "auto",
                    confidence: 0.68,
                },
            )?;
            if can_replace_evidence(conn, &concept_id)? {
                replace_evidence(
                    conn,
                    &concept_id,
                    book_id,
                    std::slice::from_ref(first_chunk_id),
                    &[],
                    &summary,
                )?;
            }
            if !concept_before {
                stats.section_count += 1;
            }
        }
    }
    Ok(stats)
}

fn backfill_cards_for_book(conn: &Connection, book_id: &str) -> Result<()> {
    let highlights = conn
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
             WHERE book_id = ?1",
        )
        .context("failed to prepare highlight knowledge backfill")?
        .query_map(params![book_id], storage::row_to_highlight)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read highlight knowledge backfill rows")?;
    for highlight in highlights {
        if card_exists(conn, &source_card_id("highlight", &highlight.id))? {
            continue;
        }
        create_card_for_highlight(
            conn,
            &highlight,
            HighlightKnowledgeInput {
                evidence_chunk_ids: &highlight.evidence_chunk_ids,
                evidence_chunk_snapshots: &highlight.evidence_chunk_snapshots,
            },
        )?;
    }

    let interpretations = conn
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
                    kind,
                    evidence_chunk_snapshots_json,
                    created_at
             FROM interpretations
             WHERE book_id = ?1",
        )
        .context("failed to prepare interpretation knowledge backfill")?
        .query_map(params![book_id], storage::row_to_interpretation)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read interpretation knowledge backfill rows")?;
    for interpretation in interpretations {
        if card_exists(conn, &source_card_id("interpretation", &interpretation.id))? {
            continue;
        }
        create_card_for_interpretation(conn, &interpretation)?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct BookSectionDraft {
    title: String,
    page_start: u32,
    page_end: u32,
    body_text: String,
    evidence_chunk_ids: Vec<String>,
}

fn build_book_sections(chunks: &[BookKnowledgeChunk]) -> Vec<BookSectionDraft> {
    let mut sections = Vec::new();
    let mut current_title = String::new();
    let mut current_page_start = 0;
    let mut current_page_end = 0;
    let mut current_body = String::new();
    let mut current_evidence = Vec::<String>::new();
    let mut page_bucket = None::<u32>;

    for chunk in chunks {
        let heading = title_from_markdown_heading(&chunk.markdown);
        let bucket = chunk.page_index / 10;
        let should_start_new = heading.is_some()
            || page_bucket
                .map(|existing| existing != bucket)
                .unwrap_or(true)
            || current_evidence.len() >= 24;
        if should_start_new && !current_evidence.is_empty() {
            sections.push(BookSectionDraft {
                title: if current_title.is_empty() {
                    format!("第 {} 页段", current_page_start + 1)
                } else {
                    current_title.clone()
                },
                page_start: current_page_start,
                page_end: current_page_end,
                body_text: summary_from_text(&current_body, 1_600),
                evidence_chunk_ids: current_evidence.clone(),
            });
            current_body.clear();
            current_evidence.clear();
        }
        if should_start_new {
            current_title = heading.unwrap_or_else(|| format!("第 {} 页段", chunk.page_index + 1));
            current_page_start = chunk.page_index;
            page_bucket = Some(bucket);
        }
        current_page_end = chunk.page_index;
        if !current_body.is_empty() {
            current_body.push('\n');
        }
        current_body.push_str(chunk.text.trim());
        current_evidence.push(chunk.chunk_id.clone());
    }

    if !current_evidence.is_empty() {
        sections.push(BookSectionDraft {
            title: if current_title.is_empty() {
                format!("第 {} 页段", current_page_start + 1)
            } else {
                current_title
            },
            page_start: current_page_start,
            page_end: current_page_end,
            body_text: summary_from_text(&current_body, 1_600),
            evidence_chunk_ids: current_evidence,
        });
    }
    sections
}

fn knowledge_seed_score(chunk: &BookKnowledgeChunk) -> usize {
    let text = chunk.text.trim();
    let mut score = text.chars().count().min(420);
    if title_from_markdown_heading(&chunk.markdown).is_some() {
        score += 160;
    }
    if looks_like_event_sentence(text) {
        score += 120;
    }
    score += extract_candidate_terms(text).len().min(12) * 18;
    score += relation_types_for_text(text).len() * 36;
    score
}

fn card_exists(conn: &Connection, card_id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT 1 FROM kb_cards WHERE card_id = ?1",
        params![card_id],
        |_| Ok(()),
    )
    .optional()
    .context("failed to check knowledge card existence")
    .map(|value| value.is_some())
}

fn can_replace_evidence(conn: &Connection, card_id: &str) -> Result<bool> {
    let user_locked = conn
        .query_row(
            "SELECT user_locked FROM kb_cards WHERE card_id = ?1",
            params![card_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .context("failed to check knowledge card lock state")?;
    Ok(user_locked != Some(1))
}

fn list_cards_for_conn(conn: &Connection, book_id: &str) -> Result<Vec<KnowledgeCard>> {
    let mut stmt = conn
        .prepare(
            "SELECT card_id,
                    book_id,
                    card_type,
                    title,
                    summary,
                    body_markdown,
                    payload_json,
                    status,
                    source,
                    confidence,
                    source_version,
                    user_locked,
                    strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at,
                    strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) AS updated_at
             FROM kb_cards
             WHERE book_id = ?1
               AND status != 'rejected'
               AND deleted_at IS NULL
             ORDER BY updated_at DESC, created_at DESC",
        )
        .context("failed to prepare knowledge cards list")?;
    let mut cards = stmt
        .query_map(params![book_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to map knowledge cards")?;
    hydrate_cards(conn, book_id, &mut cards)?;
    Ok(cards)
}

fn hydrate_cards(conn: &Connection, book_id: &str, cards: &mut [KnowledgeCard]) -> Result<()> {
    let evidence = list_evidence_for_book(conn, book_id)?;
    let mut evidence_by_card = BTreeMap::<String, Vec<KnowledgeEvidence>>::new();
    for item in evidence {
        evidence_by_card
            .entry(item.card_id.clone())
            .or_default()
            .push(item);
    }
    for card in cards {
        card.evidence = evidence_by_card.remove(&card.card_id).unwrap_or_default();
        card.drift_count = drift_count_for_card(conn, card)?;
    }
    Ok(())
}

fn list_evidence_for_book(conn: &Connection, book_id: &str) -> Result<Vec<KnowledgeEvidence>> {
    conn.prepare(
        "SELECT card_id,
                book_id,
                chunk_id,
                page_index,
                quote,
                role,
                content_hash,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM kb_evidence
         WHERE book_id = ?1
         ORDER BY page_index ASC, chunk_id ASC, created_at ASC",
    )
    .context("failed to prepare knowledge evidence list")?
    .query_map(params![book_id], row_to_evidence)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .context("failed to map knowledge evidence")
}

fn list_edges_for_conn(conn: &Connection, book_id: &str) -> Result<Vec<KnowledgeEdge>> {
    conn.prepare(
        "SELECT edge_id,
                book_id,
                source_card_id,
                target_card_id,
                edge_type,
                label,
                evidence_chunk_ids_json,
                source,
                confidence,
                status,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at,
                strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) AS updated_at
         FROM kb_edges
         WHERE book_id = ?1
           AND status != 'rejected'
           AND deleted_at IS NULL
         ORDER BY confidence DESC, edge_type ASC, updated_at DESC",
    )
    .context("failed to prepare knowledge graph edges list")?
    .query_map(params![book_id], row_to_edge)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .context("failed to map knowledge graph edges")
}

fn latest_graph_build_time(conn: &Connection, book_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', finished_at)
         FROM kb_build_runs
         WHERE book_id = ?1
           AND task = ?2
           AND status = 'completed'
           AND finished_at IS NOT NULL
         ORDER BY finished_at DESC
         LIMIT 1",
        params![book_id, KNOWLEDGE_GRAPH_TASK],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .context("failed to read latest knowledge graph build time")
}

fn row_to_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeEdge> {
    let evidence_json: String = row.get(6)?;
    let evidence_chunk_ids =
        serde_json::from_str::<Vec<String>>(&evidence_json).unwrap_or_default();
    Ok(KnowledgeEdge {
        edge_id: row.get(0)?,
        book_id: row.get(1)?,
        source_card_id: row.get(2)?,
        target_card_id: row.get(3)?,
        edge_type: row.get(4)?,
        label: row.get(5)?,
        evidence_chunk_ids,
        source: row.get(7)?,
        confidence: row.get(8)?,
        status: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn card_to_graph_node(card: &KnowledgeCard) -> KnowledgeGraphNode {
    KnowledgeGraphNode {
        card_id: card.card_id.clone(),
        book_id: card.book_id.clone(),
        card_type: card.card_type.clone(),
        title: card.title.clone(),
        summary: card.summary.clone(),
        status: card.status.clone(),
        source: card.source.clone(),
        confidence: card.confidence,
        evidence_count: card.evidence.len(),
        page_index: first_page_index(card),
        evidence: card.evidence.clone(),
    }
}

struct EdgeUpsert<'a> {
    book_id: &'a str,
    source_card_id: &'a str,
    target_card_id: &'a str,
    edge_type: &'a str,
    label: &'a str,
    evidence_chunk_ids: &'a [String],
    confidence: f64,
    status: &'a str,
}

fn upsert_edge(conn: &Connection, input: EdgeUpsert<'_>) -> Result<()> {
    let mut evidence_chunk_ids = input.evidence_chunk_ids.to_vec();
    evidence_chunk_ids.sort();
    evidence_chunk_ids.dedup();
    if evidence_chunk_ids.is_empty() {
        return Ok(());
    }
    let edge_id = edge_id(
        input.book_id,
        input.source_card_id,
        input.target_card_id,
        input.edge_type,
        &evidence_chunk_ids,
    );
    conn.execute(
        "INSERT INTO kb_edges(
           edge_id,
           book_id,
           source_card_id,
           target_card_id,
           edge_type,
           label,
           evidence_chunk_ids_json,
           source,
           confidence,
           status,
           created_at,
           updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'auto', ?8, ?9, datetime('now'), datetime('now'))
         ON CONFLICT(edge_id) DO UPDATE SET
           label = CASE WHEN kb_edges.status != 'rejected' THEN excluded.label ELSE kb_edges.label END,
           evidence_chunk_ids_json = CASE WHEN kb_edges.status != 'rejected' THEN excluded.evidence_chunk_ids_json ELSE kb_edges.evidence_chunk_ids_json END,
           confidence = CASE WHEN kb_edges.status != 'rejected' THEN excluded.confidence ELSE kb_edges.confidence END,
           status = CASE WHEN kb_edges.status != 'rejected' THEN excluded.status ELSE kb_edges.status END,
           deleted_at = CASE WHEN kb_edges.status != 'rejected' THEN NULL ELSE kb_edges.deleted_at END,
           updated_at = datetime('now')",
        params![
            edge_id,
            input.book_id,
            input.source_card_id,
            input.target_card_id,
            input.edge_type,
            input.label,
            serde_json::to_string(&evidence_chunk_ids)
                .context("failed to serialize knowledge graph edge evidence")?,
            input.confidence,
            input.status,
        ],
    )
    .context("failed to upsert knowledge graph edge")?;
    Ok(())
}

fn row_to_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeCard> {
    Ok(KnowledgeCard {
        card_id: row.get(0)?,
        book_id: row.get(1)?,
        card_type: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        body_markdown: row.get(5)?,
        payload_json: row.get(6)?,
        status: row.get(7)?,
        source: row.get(8)?,
        confidence: row.get(9)?,
        source_version: row.get(10)?,
        user_locked: row.get::<_, i64>(11)? != 0,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        evidence: Vec::new(),
        drift_count: 0,
    })
}

fn row_to_evidence(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeEvidence> {
    Ok(KnowledgeEvidence {
        card_id: row.get(0)?,
        book_id: row.get(1)?,
        chunk_id: row.get(2)?,
        page_index: row.get(3)?,
        quote: row.get(4)?,
        role: row.get(5)?,
        content_hash: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn is_extraction_source_card(card: &KnowledgeCard) -> bool {
    !card.evidence.is_empty()
        && card.status != "rejected"
        && card.source != "auto"
        && matches!(
            card.card_type.as_str(),
            "highlight" | "interpretation" | "question" | "note" | "claim"
        )
}

fn is_structural_source_card(card: &KnowledgeCard) -> bool {
    !card.evidence.is_empty()
        && card.status != "rejected"
        && matches!(
            card.card_type.as_str(),
            "highlight"
                | "interpretation"
                | "question"
                | "note"
                | "entity"
                | "concept"
                | "event"
                | "claim"
                | "summary"
        )
}

fn text_for_candidate_extraction(card: &KnowledgeCard) -> String {
    let mut parts = vec![
        card.title.trim().to_string(),
        card.summary.trim().to_string(),
        card.body_markdown.trim().to_string(),
    ];
    for evidence in &card.evidence {
        let quote = evidence.quote.trim();
        if !quote.is_empty() {
            parts.push(quote.to_string());
        }
    }
    let joined = parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    joined.chars().take(MAX_TEXT_PER_CARD_CHARS).collect()
}

fn extract_candidate_terms(text: &str) -> Vec<CandidateTerm> {
    let mut terms = BTreeMap::<String, CandidateTerm>::new();
    for term in extract_book_titles(text) {
        insert_candidate_term(&mut terms, term, "work");
    }
    for term in extract_english_terms(text) {
        insert_candidate_term(&mut terms, term, "english");
    }
    for term in extract_cjk_terms(text) {
        insert_candidate_term(&mut terms, term, "cjk");
    }
    terms.into_values().collect()
}

fn insert_candidate_term(
    terms: &mut BTreeMap<String, CandidateTerm>,
    raw_title: String,
    kind: &str,
) {
    let title = clean_candidate_title(&raw_title);
    let normalized = normalize_candidate_title(&title);
    if !is_valid_candidate_title(&title, &normalized) {
        return;
    }
    terms.entry(normalized).or_insert_with(|| CandidateTerm {
        title,
        kind: kind.to_string(),
    });
}


fn confidence_for_candidate(candidate: &CandidateDraft) -> f64 {
    let source_bonus = (candidate.source_card_ids.len().saturating_sub(1) as f64 * 0.08).min(0.18);
    let evidence_bonus =
        (candidate.evidence_chunk_ids.len().saturating_sub(1) as f64 * 0.04).min(0.12);
    let type_bonus = match candidate.card_type.as_str() {
        "entity" => 0.04,
        "event" => 0.02,
        _ => 0.0,
    };
    (0.52 + source_bonus + evidence_bonus + type_bonus).min(0.84)
}

fn render_candidate_body(candidate: &CandidateDraft) -> String {
    let mut output = String::new();
    output.push_str("### 自动候选\n");
    output.push_str(&candidate.summary);
    output.push_str("\n\n");
    if !candidate.snippets.is_empty() {
        output.push_str("### 触发片段\n");
        for snippet in &candidate.snippets {
            output.push_str("- ");
            output.push_str(snippet);
            output.push('\n');
        }
    }
    output
}

fn candidate_card_id(book_id: &str, candidate: &CandidateDraft) -> String {
    format!(
        "kb-auto-{}",
        stable_hash(&format!(
            "{book_id}:{}:{}:{}",
            candidate.card_type, candidate.kind, candidate.normalized_title
        ))
    )
}

fn edge_id(
    book_id: &str,
    source_card_id: &str,
    target_card_id: &str,
    edge_type: &str,
    evidence_chunk_ids: &[String],
) -> String {
    format!(
        "kb-edge-{}",
        stable_hash(&format!(
            "{book_id}:{source_card_id}:{target_card_id}:{edge_type}:{}",
            evidence_chunk_ids.join("|")
        ))
    )
}

fn label_for_edge_type(edge_type: &str) -> &'static str {
    match edge_type {
        "mentions" => "提及候选",
        "same_evidence" => "共享原文证据",
        "nearby" => "章节邻近",
        "supports" => "支持",
        "contrasts" => "对比",
        "causes" => "因果",
        "part_of" => "章节包含",
        "alias_of" => "同名/别名线索",
        "sequel" => "阅读顺序",
        _ => "关联",
    }
}

fn first_page_index(card: &KnowledgeCard) -> Option<u32> {
    card.evidence
        .iter()
        .filter_map(|item| item.page_index)
        .min()
}

fn ordered_pair<'a>(left: &'a str, right: &'a str) -> (&'a str, &'a str) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn cards_share_evidence(left: &KnowledgeCard, right: &KnowledgeCard) -> bool {
    let left_ids = left
        .evidence
        .iter()
        .map(|item| item.chunk_id.as_str())
        .collect::<BTreeSet<_>>();
    right
        .evidence
        .iter()
        .any(|item| left_ids.contains(item.chunk_id.as_str()))
}

fn union_evidence_chunk_ids(
    left: &KnowledgeCard,
    right: &KnowledgeCard,
    limit: usize,
) -> Vec<String> {
    let mut ids = BTreeSet::<String>::new();
    for evidence in left.evidence.iter().chain(right.evidence.iter()) {
        ids.insert(evidence.chunk_id.clone());
        if ids.len() >= limit {
            break;
        }
    }
    ids.into_iter().collect()
}

const KNOWLEDGE_STOPWORDS: &[&str] = &[
    "问题",
    "回答",
    "选区",
    "解读",
    "作者",
    "这句话",
    "为什么",
    "怎么理解",
    "原文",
    "知识",
    "自动候选",
    "长期过程",
    "单次收益",
];

struct CardUpsert<'a> {
    card_id: &'a str,
    book_id: &'a str,
    card_type: &'a str,
    title: &'a str,
    summary: &'a str,
    body_markdown: &'a str,
    payload_json: &'a str,
    status: &'a str,
    source: &'a str,
    confidence: f64,
}

fn upsert_card(conn: &Connection, input: CardUpsert<'_>) -> Result<()> {
    conn.execute(
        "INSERT INTO kb_cards(
           card_id,
           book_id,
           card_type,
           title,
           summary,
           body_markdown,
           payload_json,
           status,
           source,
           confidence,
           source_version,
           user_locked,
           created_at,
           updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, datetime('now'), datetime('now'))
         ON CONFLICT(card_id) DO UPDATE SET
           card_type = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.card_type ELSE kb_cards.card_type END,
           title = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.title ELSE kb_cards.title END,
           summary = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.summary ELSE kb_cards.summary END,
           body_markdown = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.body_markdown ELSE kb_cards.body_markdown END,
           payload_json = CASE WHEN kb_cards.user_locked = 0 THEN excluded.payload_json ELSE kb_cards.payload_json END,
           confidence = CASE WHEN kb_cards.user_locked = 0 AND kb_cards.status != 'confirmed' AND kb_cards.status != 'rejected' THEN excluded.confidence ELSE kb_cards.confidence END,
           source_version = excluded.source_version,
           updated_at = datetime('now')",
        params![
            input.card_id,
            input.book_id,
            input.card_type,
            input.title,
            input.summary,
            input.body_markdown,
            input.payload_json,
            input.status,
            input.source,
            input.confidence,
            KB_SOURCE_VERSION
        ],
    )
    .context("failed to upsert knowledge card")?;
    Ok(())
}

fn replace_evidence(
    conn: &Connection,
    card_id: &str,
    book_id: &str,
    evidence_chunk_ids: &[String],
    snapshots: &[EvidenceChunkSnapshot],
    fallback_quote: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM kb_evidence WHERE card_id = ?1",
        params![card_id],
    )
    .context("failed to clear knowledge evidence")?;
    for chunk_id in evidence_chunk_ids {
        let chunk = load_chunk_evidence(conn, book_id, chunk_id)?;
        if chunk.is_none() {
            continue;
        }
        let snapshot_hash = snapshots
            .iter()
            .find(|snapshot| snapshot.chunk_id == *chunk_id)
            .and_then(|snapshot| snapshot.content_hash.clone());
        let quote = fallback_quote.trim().chars().take(240).collect::<String>();
        let page_index = chunk.as_ref().map(|item| item.page_index);
        let chunk_quote = chunk
            .as_ref()
            .map(|item| item.quote.clone())
            .unwrap_or_default();
        let content_hash =
            snapshot_hash.or_else(|| chunk.as_ref().and_then(|item| item.content_hash.clone()));
        conn.execute(
            "INSERT OR REPLACE INTO kb_evidence(
               card_id,
               book_id,
               chunk_id,
               page_index,
               quote,
               role,
               content_hash,
               created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, 'support', ?6, datetime('now'))",
            params![
                card_id,
                book_id,
                chunk_id,
                page_index,
                if quote.is_empty() {
                    chunk_quote.as_str()
                } else {
                    quote.as_str()
                },
                content_hash
            ],
        )
        .context("failed to insert knowledge evidence")?;
    }
    Ok(())
}

struct ChunkEvidence {
    page_index: u32,
    quote: String,
    content_hash: Option<String>,
}

fn load_chunk_evidence(
    conn: &Connection,
    book_id: &str,
    chunk_id: &str,
) -> Result<Option<ChunkEvidence>> {
    let row = conn
        .query_row(
            "SELECT page_index, text FROM chunks WHERE book_id = ?1 AND chunk_id = ?2",
            params![book_id, chunk_id],
            |row| Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .context("failed to load knowledge evidence chunk")?;
    Ok(row.map(|(page_index, text)| ChunkEvidence {
        page_index,
        quote: summary_from_text(&text, 240),
        content_hash: Some(crate::chunk_id::content_hash(&text)),
    }))
}

fn set_card_status(
    db_path: &Path,
    book_id: &str,
    card_id: &str,
    status: &str,
) -> Result<KnowledgeCard> {
    validate_card_status(status)?;
    let conn = storage::open_database(db_path)?;
    let changed = conn
        .execute(
            "UPDATE kb_cards
             SET status = ?3,
                 user_locked = 1,
                 updated_at = datetime('now'),
                 deleted_at = NULL
             WHERE book_id = ?1 AND card_id = ?2 AND deleted_at IS NULL",
            params![book_id, card_id, status],
        )
        .context("failed to update knowledge card status")?;
    if changed == 0 {
        return Err(anyhow!("knowledge card not found"));
    }
    get_card(db_path, book_id, card_id)?.ok_or_else(|| anyhow!("knowledge card not found"))
}

fn validate_card_status(status: &str) -> Result<()> {
    if matches!(status, "candidate" | "confirmed" | "rejected") {
        Ok(())
    } else {
        Err(anyhow!("invalid knowledge card status: {status}"))
    }
}

fn validate_card_type(card_type: &str) -> Result<()> {
    if matches!(
        card_type,
        "note"
            | "highlight"
            | "interpretation"
            | "concept"
            | "entity"
            | "event"
            | "claim"
            | "question"
            | "summary"
    ) {
        Ok(())
    } else {
        Err(anyhow!("invalid knowledge card type: {card_type}"))
    }
}

fn drift_count_for_card(conn: &Connection, card: &KnowledgeCard) -> Result<usize> {
    let mut count = 0;
    for evidence in &card.evidence {
        if evidence_is_drifted(conn, evidence)? {
            count += 1;
        }
    }
    Ok(count)
}

fn list_drift_for_conn(conn: &Connection, book_id: &str) -> Result<Vec<KnowledgeDrift>> {
    let mut cards = list_cards_for_conn(conn, book_id)?;
    let mut drift = Vec::new();
    for card in &mut cards {
        for evidence in &card.evidence {
            let current_hash = current_chunk_hash(conn, book_id, &evidence.chunk_id)?;
            let drifted = evidence
                .content_hash
                .as_deref()
                .zip(current_hash.as_deref())
                .is_some_and(|(stored, current)| stored != current);
            if drifted || (evidence.content_hash.is_some() && current_hash.is_none()) {
                drift.push(KnowledgeDrift {
                    card_id: card.card_id.clone(),
                    title: card.title.clone(),
                    chunk_id: evidence.chunk_id.clone(),
                    page_index: evidence.page_index,
                    stored_content_hash: evidence.content_hash.clone(),
                    current_content_hash: current_hash,
                    quote: evidence.quote.clone(),
                });
            }
        }
    }
    Ok(drift)
}

fn evidence_is_drifted(conn: &Connection, evidence: &KnowledgeEvidence) -> Result<bool> {
    let Some(stored_hash) = evidence.content_hash.as_deref() else {
        return Ok(false);
    };
    let current_hash = current_chunk_hash(conn, &evidence.book_id, &evidence.chunk_id)?;
    Ok(current_hash
        .as_deref()
        .is_some_and(|current| current != stored_hash)
        || current_hash.is_none())
}

fn current_chunk_hash(conn: &Connection, book_id: &str, chunk_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT text FROM chunks WHERE book_id = ?1 AND chunk_id = ?2",
        params![book_id, chunk_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .context("failed to load current chunk hash")
    .map(|text| text.map(|value| crate::chunk_id::content_hash(&value)))
}

fn search_knowledge_cards_for_conn(
    conn: &Connection,
    book_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<KnowledgeSearchHit>> {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let mut cards = list_cards_for_conn(conn, book_id)?;
    let mut scored = Vec::new();
    for card in cards.drain(..) {
        let haystack =
            format!("{}\n{}\n{}", card.title, card.summary, card.body_markdown).to_lowercase();
        let mut score = 0.0;
        for token in &tokens {
            if card.title.to_lowercase().contains(token) {
                score += 4.0;
            }
            if card.summary.to_lowercase().contains(token) {
                score += 2.0;
            }
            if haystack.contains(token) {
                score += 1.0;
            }
        }
        if score <= 0.0 {
            continue;
        }
        score += card.confidence;
        if card.status == "confirmed" {
            score += 0.75;
        }
        let evidence_chunk_ids = card
            .evidence
            .iter()
            .map(|item| item.chunk_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        if evidence_chunk_ids.is_empty() {
            continue;
        }
        scored.push(KnowledgeSearchHit {
            card_id: card.card_id,
            title: card.title,
            card_type: card.card_type,
            status: card.status,
            source: card.source,
            confidence: card.confidence,
            score,
            evidence_chunk_ids,
        });
    }
    scored.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.title.cmp(&right.title))
    });
    scored.truncate(limit.max(1));
    Ok(scored)
}

fn query_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let lower = query.to_lowercase();
    for token in lower
        .split(|ch: char| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    ',' | '.'
                        | ';'
                        | ':'
                        | '!'
                        | '?'
                        | '，'
                        | '。'
                        | '；'
                        | '：'
                        | '！'
                        | '？'
                        | '、'
                        | '('
                        | ')'
                        | '['
                        | ']'
                )
        })
        .map(str::trim)
        .filter(|token| token.chars().count() >= 2)
    {
        tokens.push(token.to_string());
    }
    let cjk = lower
        .chars()
        .filter(|ch| is_cjk_char(*ch))
        .collect::<String>();
    for window in 2..=4 {
        let chars = cjk.chars().collect::<Vec<_>>();
        if chars.len() < window {
            continue;
        }
        for slice in chars.windows(window).take(24) {
            tokens.push(slice.iter().collect::<String>());
        }
    }
    tokens.sort();
    tokens.dedup();
    tokens.truncate(48);
    tokens
}

fn search_hit_for_chunk(
    conn: &Connection,
    book_id: &str,
    chunk_id: &str,
    score: f64,
) -> Result<Option<storage::SearchHit>> {
    let row = conn
        .query_row(
            "SELECT chunk_id, page_index, text, markdown, rects_json, coordinate_version
             FROM chunks
             WHERE book_id = ?1 AND chunk_id = ?2",
            params![book_id, chunk_id],
            |row| {
                let text: String = row.get(2)?;
                let rects_json: String = row.get(4)?;
                let rects = serde_json::from_str::<Vec<storage::NormalizedRectInput>>(&rects_json)
                    .map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(err),
                        )
                    })?;
                Ok(storage::SearchHit {
                    chunk_id: row.get(0)?,
                    page_index: row.get(1)?,
                    markdown: row.get(3)?,
                    rects,
                    coordinate_version: row.get(5)?,
                    snippet: summary_from_text(&text, 180),
                    text,
                    score,
                })
            },
        )
        .optional()
        .context("failed to load knowledge search chunk")?;
    Ok(row)
}

fn line_id_for_page(page_index: Option<u32>) -> String {
    page_index
        .map(|page| format!("line-{:04}", page / 10))
        .unwrap_or_else(|| "line-unknown".to_string())
}

fn string_payload(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn string_vec_payload(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn render_markdown(
    book_id: &str,
    cards: &[KnowledgeCard],
    edges: &[KnowledgeEdge],
    generated_at: &str,
) -> String {
    let mut output = String::new();
    output.push_str("# 阅读知识册\n\n");
    output.push_str(&format!("- book_id: `{book_id}`\n"));
    output.push_str(&format!("- generated_at: `{generated_at}`\n"));
    output.push_str(&format!("- card_count: `{}`\n\n", cards.len()));
    if cards.is_empty() {
        output.push_str("这本书还没有知识卡片。保存高亮、解读或笔记后再导出，会在这里形成可追溯的阅读沉淀。\n\n");
        return output;
    }
    output.push_str("## 总览\n\n");
    output.push_str("| 类型 | 标题 | 状态 | 来源 | 置信度 | 漂移 | 证据 |\n");
    output.push_str("|---|---|---|---|---:|---:|---:|\n");
    for card in cards {
        output.push_str(&format!(
            "| {} | {} | {} | {} | {:.2} | {} | {} |\n",
            escape_markdown_table(&card.card_type),
            escape_markdown_table(&card.title),
            escape_markdown_table(&card.status),
            escape_markdown_table(&card.source),
            card.confidence,
            card.drift_count,
            escape_markdown_table(&card.evidence.len().to_string())
        ));
    }
    let index_cards = cards
        .iter()
        .filter(|card| matches!(card.card_type.as_str(), "entity" | "concept"))
        .collect::<Vec<_>>();
    if !index_cards.is_empty() {
        output.push_str("\n## 实体 / 概念索引\n\n");
        output.push_str("| 类型 | 名称 | 状态 | 证据 chunk |\n");
        output.push_str("|---|---|---|---|\n");
        for card in index_cards {
            output.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                escape_markdown_table(&card.card_type),
                escape_markdown_table(&card.title),
                escape_markdown_table(&card.status),
                escape_markdown_table(
                    &card
                        .evidence
                        .iter()
                        .map(|item| item.chunk_id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            ));
        }
    }
    let timeline_cards = cards
        .iter()
        .filter(|card| matches!(card.card_type.as_str(), "event" | "claim"))
        .collect::<Vec<_>>();
    if !timeline_cards.is_empty() {
        output.push_str("\n## 时间线 / 地图站点\n\n");
        output.push_str("| 顺序 | 类型 | 标题 | 页码 | 状态 |\n");
        output.push_str("|---:|---|---|---:|---|\n");
        let mut rows = timeline_cards;
        rows.sort_by(|left, right| {
            first_page_index(left)
                .cmp(&first_page_index(right))
                .then_with(|| left.title.cmp(&right.title))
        });
        for (index, card) in rows.iter().enumerate() {
            output.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                index + 1,
                escape_markdown_table(&card.card_type),
                escape_markdown_table(&card.title),
                first_page_index(card)
                    .map(|page| (page + 1).to_string())
                    .unwrap_or_else(|| "-".to_string()),
                escape_markdown_table(&card.status)
            ));
        }
    }
    if !edges.is_empty() {
        output.push_str("\n## 关系 / 反链摘要\n\n");
        output.push_str("| 类型 | 来源 | 目标 | 状态 | 证据 |\n");
        output.push_str("|---|---|---|---|---|\n");
        let card_titles = cards
            .iter()
            .map(|card| (card.card_id.as_str(), card.title.as_str()))
            .collect::<BTreeMap<_, _>>();
        for edge in edges.iter().take(240) {
            output.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                escape_markdown_table(&edge.edge_type),
                escape_markdown_table(
                    card_titles
                        .get(edge.source_card_id.as_str())
                        .copied()
                        .unwrap_or(edge.source_card_id.as_str())
                ),
                escape_markdown_table(
                    card_titles
                        .get(edge.target_card_id.as_str())
                        .copied()
                        .unwrap_or(edge.target_card_id.as_str())
                ),
                escape_markdown_table(&edge.status),
                escape_markdown_table(&edge.evidence_chunk_ids.join(", "))
            ));
        }
    }
    output.push_str("\n## 详情\n\n");
    for card in cards {
        output.push_str(&format!("### {}\n\n", card.title.trim()));
        output.push_str(&format!(
            "- card_id: `{}`\n- type: `{}`\n- source: `{}`\n- status: `{}`\n- confidence: `{:.2}`\n- user_locked: `{}`\n- drift_count: `{}`\n\n",
            card.card_id,
            card.card_type,
            card.source,
            card.status,
            card.confidence,
            card.user_locked,
            card.drift_count
        ));
        if !card.summary.trim().is_empty() {
            output.push_str(&format!("**摘要**：{}\n\n", card.summary.trim()));
        }
        if !card.body_markdown.trim().is_empty() {
            output.push_str(card.body_markdown.trim());
            output.push_str("\n\n");
        }
        if !card.evidence.is_empty() {
            output.push_str("**原文证据**\n\n");
            for evidence in &card.evidence {
                output.push_str(&format!(
                    "- [{}] page={} role={} hash={}\n",
                    evidence.chunk_id,
                    evidence
                        .page_index
                        .map(|page| (page + 1).to_string())
                        .unwrap_or_else(|| "unknown".to_string()),
                    evidence.role,
                    evidence.content_hash.as_deref().unwrap_or("unknown")
                ));
                if !evidence.quote.trim().is_empty() {
                    output.push_str(&format!(
                        "  > {}\n",
                        evidence.quote.trim().replace('\n', " ")
                    ));
                }
            }
            output.push('\n');
        }
    }
    output
}

fn sqlite_timestamp(conn: &Connection) -> Result<String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
        row.get::<_, String>(0)
    })
    .context("failed to get SQLite timestamp")
}

fn source_card_id(prefix: &str, source_id: &str) -> String {
    format!("kb-{prefix}-{}", stable_hash(source_id))
}

fn stable_hash(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn title_from_text(value: &str, fallback: &str) -> String {
    let title = summary_from_text(value, 42);
    if title.is_empty() {
        fallback.to_string()
    } else {
        title
    }
}

fn title_from_markdown_heading(markdown: &str) -> Option<String> {
    markdown
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('#'))
        .map(|line| line.trim_start_matches('#').trim())
        .filter(|line| !line.is_empty())
        .map(|line| title_from_text(line, "书内片段"))
}

fn summary_from_text(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut summary = normalized.chars().take(max_chars).collect::<String>();
    summary.push_str("...");
    summary
}

fn escape_markdown_table(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

#[cfg(test)]
mod tests {
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
}
