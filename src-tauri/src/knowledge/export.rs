//! Markdown rendering for knowledge-book export.
//! Split out of knowledge/mod.rs (P10 architecture refactor).

use super::*;

pub(super) fn render_markdown(
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

pub(super) fn escape_markdown_table(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}
