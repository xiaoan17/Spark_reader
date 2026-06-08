//! Lazy, on-demand completion for knowledge cards (P3).
//!
//! These helpers generate a highlight note (`body_markdown`) or a one-sentence
//! summary (`summary`) for a card *only when explicitly requested* — never
//! silently on highlight save. They follow the TLDR cache pattern: a populated
//! field at the current `KB_SOURCE_VERSION` is treated as a cache hit and
//! returned as-is. `force` re-generates, but NEVER overwrites a user-locked
//! card (append-only iron law).

use anyhow::{anyhow, Context, Result};
use rusqlite::params;

use crate::llm;
use crate::storage;

use super::{get_card, KnowledgeCard, KB_SOURCE_VERSION, MAX_TEXT_PER_CARD_CHARS};

const CARD_NOTE_MAX_TOKENS: u32 = 700;
const CARD_SUMMARY_MAX_TOKENS: u32 = 200;

/// Generate (or return cached) an explanatory note for a card's `body_markdown`.
///
/// Cache hit: card already has non-empty `body_markdown` at the current source
/// version and `force` is false. User-locked cards are returned untouched even
/// when `force` is true.
pub async fn get_or_generate_highlight_note(
    db_path: &std::path::Path,
    book_id: &str,
    card_id: &str,
    force: bool,
) -> Result<KnowledgeCard> {
    let card = load_card(db_path, book_id, card_id)?;

    if card.user_locked {
        // Iron law: never overwrite user-locked content, even on force.
        return Ok(card);
    }
    if !force && is_fresh(&card, &card.body_markdown) {
        return Ok(card);
    }

    let prompt = build_note_prompt(&card);
    let generated = generate(prompt, CARD_NOTE_MAX_TOKENS).await?;
    write_card_field(db_path, book_id, card_id, "body_markdown", &generated)?;
    load_card(db_path, book_id, card_id)
}

/// Generate (or return cached) a one-sentence `summary` for a long/multi-evidence card.
///
/// Same cache + user-lock semantics as [`get_or_generate_highlight_note`], but
/// targets the `summary` field.
pub async fn get_or_generate_card_summary(
    db_path: &std::path::Path,
    book_id: &str,
    card_id: &str,
    force: bool,
) -> Result<KnowledgeCard> {
    let card = load_card(db_path, book_id, card_id)?;

    if card.user_locked {
        return Ok(card);
    }
    if !force && is_fresh(&card, &card.summary) {
        return Ok(card);
    }

    let prompt = build_summary_prompt(&card);
    let generated = generate(prompt, CARD_SUMMARY_MAX_TOKENS).await?;
    let one_line = first_line(&generated);
    write_card_field(db_path, book_id, card_id, "summary", &one_line)?;
    load_card(db_path, book_id, card_id)
}

fn load_card(db_path: &std::path::Path, book_id: &str, card_id: &str) -> Result<KnowledgeCard> {
    get_card(db_path, book_id, card_id)?
        .ok_or_else(|| anyhow!("knowledge card not found: {card_id}"))
}

/// A field counts as a fresh cache hit when it is non-empty AND the card was
/// last written at the current knowledge source version.
fn is_fresh(card: &KnowledgeCard, field: &str) -> bool {
    !field.trim().is_empty() && card.source_version == KB_SOURCE_VERSION
}

/// Persist a generated field and bump the card's source version + updated_at.
/// Re-checks `user_locked` inside the UPDATE so a concurrent lock cannot be
/// clobbered (defense in depth alongside the early return in the callers).
fn write_card_field(
    db_path: &std::path::Path,
    book_id: &str,
    card_id: &str,
    column: &str,
    value: &str,
) -> Result<()> {
    // `column` is a fixed internal literal, never user input.
    let sql = format!(
        "UPDATE kb_cards
         SET {column} = ?1,
             source_version = ?2,
             updated_at = datetime('now')
         WHERE book_id = ?3
           AND card_id = ?4
           AND user_locked = 0
           AND deleted_at IS NULL"
    );
    let conn = storage::open_database(db_path)?;
    conn.execute(&sql, params![value, KB_SOURCE_VERSION, book_id, card_id])
        .with_context(|| format!("failed to write generated {column} for card {card_id}"))?;
    Ok(())
}

async fn generate(prompt: CardPrompt, max_tokens: u32) -> Result<String> {
    let messages = vec![
        llm::ChatMessage::system(prompt.system),
        llm::ChatMessage::user(prompt.user),
    ];
    let output = llm::chat(messages, max_tokens)
        .await
        .map_err(|err| anyhow!("LLM generation failed: {err}"))?;
    let trimmed = output.trim().to_string();
    if trimmed.is_empty() {
        return Err(anyhow!("LLM returned empty content"));
    }
    Ok(trimmed)
}

struct CardPrompt {
    system: String,
    user: String,
}

fn build_note_prompt(card: &KnowledgeCard) -> CardPrompt {
    CardPrompt {
        system: "你是一位精读助手。基于给定的原文摘录，为这条阅读卡片写一段有帮助的笔记，\
                 解释它在讲什么、为什么重要。只输出笔记正文，不要标题、不要客套。"
            .to_string(),
        user: format!(
            "卡片标题：{title}\n\n原文摘录与已有内容：\n{context}\n\n请写一段笔记。",
            title = card.title.trim(),
            context = gather_card_text(card),
        ),
    }
}

fn build_summary_prompt(card: &KnowledgeCard) -> CardPrompt {
    CardPrompt {
        system: "你是一位精读助手。用一句话概括这条阅读卡片的核心，便于在列表中快速辨认。\
                 只输出这一句话，不要标题、不要列表、不要客套。"
            .to_string(),
        user: format!(
            "卡片标题：{title}\n\n卡片内容与原文摘录：\n{context}\n\n请用一句话概括。",
            title = card.title.trim(),
            context = gather_card_text(card),
        ),
    }
}

/// Gather the card's title, body and evidence quotes into a bounded prompt blob.
fn gather_card_text(card: &KnowledgeCard) -> String {
    let mut parts = vec![
        card.title.trim().to_string(),
        card.body_markdown.trim().to_string(),
    ];
    for evidence in &card.evidence {
        let quote = evidence.quote.trim();
        if !quote.is_empty() {
            parts.push(format!("[{}] {}", evidence.chunk_id, quote));
        }
    }
    let joined = parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    joined.chars().take(MAX_TEXT_PER_CARD_CHARS).collect()
}

fn first_line(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string()
}
