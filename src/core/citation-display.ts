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

export function citationLabelForChunkId(chunkId: string, labels?: ReadonlyMap<string, string>) {
  const knownLabel = labels?.get(chunkId)
  if (knownLabel) {
    return knownLabel
  }
  const pageMatch = /(?:^|-)p(\d+)-/i.exec(chunkId)
  if (pageMatch) {
    return `第 ${pageMatch[1]} 页 · 引用`
  }
  return "引用"
}

export function evidenceLabel(item: EvidencePreview, allEvidence: EvidencePreview[], index?: number) {
  const samePageCount = allEvidence.filter((candidate) => candidate.pageIndex === item.pageIndex).length
  const suffix = samePageCount > 1 && typeof index === "number" ? ` · 引用 ${index + 1}` : ""
  return `第 ${item.pageIndex + 1} 页 · 相关段落${suffix}`
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
    .replace(legacyCitationPattern, (_match, _chunkId, pageNumber: string) => `（第 ${pageNumber} 页 · 引用）`)
    .replace(/文本\s*chunks?/gi, "转换文本")
    .replace(/(\d+)\s*个\s*chunks?\b/gi, "$1 段正文")
    .replace(/(\d+)\s*chunks?\b/gi, "$1 段正文")
    .replace(/\bchunks?\b/gi, "正文段落")
    .replace(/\bchunk_id\b/gi, "引用")
    .replace(/本页\s*正文段落/gi, "本页相关段落")
}

export { internalCitationPattern }
