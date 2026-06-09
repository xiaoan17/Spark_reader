import type { EvidencePreview } from "@/stores/reader-store"
import { isNamespacedChunkId } from "@/core/chunk-id"

const chunkIdPatternSource = "b[0-9a-f]{8}-p\\d+-c\\d+-[0-9a-f]{8}"
const internalCitationPattern = new RegExp(
  `[\\[【](${chunkIdPatternSource}(?:\\s*[,，;；、|]\\s*${chunkIdPatternSource})*)[\\]】]`,
  "gi",
)
const legacyCitationPattern = /[\[【](p(\d+)-c\d+)[\]】]/gi

export function citationLabelMap(evidence: EvidencePreview[]) {
  return new Map(evidence.map((item, index) => [item.chunkId, evidenceLabel(item, evidence, index)]))
}

export function citationMarkerLabelMap(evidence: EvidencePreview[]) {
  return citationMarkerLabelMapForChunkIds(evidence.map((item) => item.chunkId))
}

export function citationMarkerLabelMapForChunkIds(chunkIds: string[]) {
  const labels = new Map<string, string>()
  for (const chunkId of chunkIds) {
    if (!labels.has(chunkId)) {
      labels.set(chunkId, citationMarkerLabel(labels.size))
    }
  }
  return labels
}

export function citationLabelForChunkId(chunkId: string, labels?: ReadonlyMap<string, string>) {
  const knownLabel = labels?.get(chunkId)
  if (knownLabel) {
    return knownLabel
  }
  const pageMatch = /(?:^|-)p(\d+)-/i.exec(chunkId)
  if (pageMatch) {
    return "引用"
  }
  return "引用"
}

export function evidenceLabel(item: EvidencePreview, allEvidence: EvidencePreview[], index?: number) {
  const suffix = allEvidence.length > 1 && typeof index === "number" ? ` · 引用 ${index + 1}` : ""
  return `相关段落${suffix}`
}

export function citationMarkerLabel(index?: number) {
  return typeof index === "number" ? `[${index + 1}]` : "[?]"
}

/**
 * Differentiated label for a retrieval-phase evidence chip: prefer the source's
 * own title (chapter/section / planned sub-query), then a page number, and only
 * fall back to a generic "第 N 段" so the agentic process feels alive rather than
 * a row of identical spinners (UI-UX §3.3, BRAND §10 原则 5).
 */
export function retrievalEvidenceLabel(
  item: { title?: string | null; pageIndex?: number | null },
  index = 0,
): string {
  const title = (item.title ?? "").replace(/\s+/g, " ").trim()
  const looksLikeRawId = /^Chunk\s/i.test(title) || isNamespacedChunkId(title)
  if (title && title !== "当前选区" && !looksLikeRawId) {
    return summarizeQuote(title, 18)
  }
  if (title === "当前选区") {
    return title
  }
  if (item.pageIndex !== null && item.pageIndex !== undefined) {
    return `第 ${item.pageIndex + 1} 页`
  }
  return `第 ${index + 1} 段`
}

/**
 * Human-facing label for a knowledge-card evidence chunk, e.g. "第 3 页 · 复利来自时间…".
 * Keeps the internal `chunkId` out of the UI surface (BRAND §7 "安静、可信"): the raw
 * id stays available only via tooltip/校对 folds. Falls back gracefully when page or
 * quote is missing.
 */
export function knowledgeEvidenceLabel(item: {
  pageIndex?: number | null
  quote?: string | null
}): string {
  const pageLabel =
    item.pageIndex === null || item.pageIndex === undefined
      ? "未知页"
      : `第 ${item.pageIndex + 1} 页`
  const snippet = summarizeQuote(item.quote)
  return snippet ? `${pageLabel} · ${snippet}` : `${pageLabel} · 原文片段`
}

/** Trim a quote into a compact, single-line snippet for inline labels. */
export function summarizeQuote(quote?: string | null, maxLength = 14): string {
  const normalized = (quote ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) {
    return ""
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

/**
 * Human-facing label derived from a bare chunk id (when no page/quote object is
 * available, e.g. graph edges only carry `evidenceChunkIds`). Surfaces the page
 * number parsed from the id, never the id itself.
 */
export function chunkIdEvidenceLabel(chunkId: string): string {
  const pageMatch = /(?:^|-)p(\d+)-/i.exec(chunkId)
  if (pageMatch) {
    return `第 ${Number(pageMatch[1])} 页 · 原文证据`
  }
  return "原文证据"
}

export function chunkIdsInCitation(value: string) {
  return value
    .split(/[\s,，;；、|]+/)
    .map((part) => part.trim())
    .filter(isNamespacedChunkId)
}

export function replaceInternalCitationsWithReadableLabels(
  text: string,
  labels?: ReadonlyMap<string, string>,
) {
  return text.replace(internalCitationPattern, (match, rawIds: string) => {
    const citationIds = chunkIdsInCitation(rawIds).filter((chunkId) => !labels || labels.has(chunkId))
    if (citationIds.length === 0) {
      return match
    }
    return citationIds.map((chunkId) => `（${citationLabelForChunkId(chunkId, labels)}）`).join("")
  })
}

export function sanitizeInternalReferenceText(text: string, labels?: ReadonlyMap<string, string>) {
  return replaceInternalCitationsWithReadableLabels(text, labels)
    .replace(internalCitationPattern, "（未核验引用）")
    .replace(legacyCitationPattern, "（引用）")
    .replace(/文本\s*chunks?/gi, "转换文本")
    .replace(/(\d+)\s*个\s*chunks?\b/gi, "$1 段正文")
    .replace(/(\d+)\s*chunks?\b/gi, "$1 段正文")
    .replace(/\bchunks?\b/gi, "正文段落")
    .replace(/\bchunk_id\b/gi, "引用")
    .replace(/本页\s*正文段落/gi, "本页相关段落")
}

export { internalCitationPattern }
