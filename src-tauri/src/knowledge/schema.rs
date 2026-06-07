//! Knowledge-layer SQLite schema: table DDL, column migrations, version.
//! Split out of knowledge/mod.rs (P10 architecture refactor).

use super::*;

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
