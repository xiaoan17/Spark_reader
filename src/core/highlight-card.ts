import type { KnowledgeCard } from "@/stores/reader-store"

/**
 * 在已加载的知识卡里，按沉淀来源反查某条高亮对应的知识卡 id。
 *
 * 高亮会沉淀为 cardType="highlight" 的卡，其 payloadJson 记录
 * `{ sourceTable: "highlights", sourceId: <highlight.id> }`。这里按来源匹配，
 * 避免在前端复现后端的 stable_hash（Rust DefaultHasher，不可移植）。
 *
 * 反查不到（知识库尚未构建、或该高亮尚未沉淀）时返回 null，调用方据此隐藏
 * 「生成 AI 笔记」入口。
 */
export function findHighlightCardId(cards: KnowledgeCard[], highlightId: string): string | null {
  for (const card of cards) {
    if (card.cardType !== "highlight") {
      continue
    }
    let payload: unknown
    try {
      payload = JSON.parse(card.payloadJson || "{}")
    } catch {
      continue
    }
    if (
      payload &&
      typeof payload === "object" &&
      (payload as { sourceTable?: unknown }).sourceTable === "highlights" &&
      (payload as { sourceId?: unknown }).sourceId === highlightId
    ) {
      return card.cardId
    }
  }
  return null
}

/**
 * 从反查到的卡片里取「已生成的 AI 笔记」文本；取不到返回 null。
 *
 * 高亮卡的 body_markdown 初始被后端预填为引用原文（选区文字 [+ 解读]）。团队约定
 * 「预填引文体不算笔记」，因此这里把以选区原文开头的正文视作未生成，仅在正文是
 * 真正的解读笔记时才返回，用于折叠展示。
 */
export function generatedHighlightNote(
  card: KnowledgeCard | null | undefined,
  selectionText: string,
): string | null {
  if (!card) {
    return null
  }
  const body = card.bodyMarkdown.trim()
  if (!body) {
    return null
  }
  const quote = selectionText.trim()
  if (quote && body.startsWith(quote)) {
    return null
  }
  return card.bodyMarkdown
}
