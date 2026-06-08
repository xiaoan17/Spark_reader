import type { EvidencePreview } from "@/stores/reader-store"
import {
  chunkIdsInCitation,
  citationLabelForChunkId,
  internalCitationPattern,
  sanitizeInternalReferenceText,
} from "@/core/citation-display"

export function renderMarkdownTextWithCitations(
  text: string,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
  citationEvidence?: ReadonlyMap<string, EvidencePreview>,
) {
  const sanitizedText = sanitizeInternalReferenceText(text, citationLabels)
  internalCitationPattern.lastIndex = 0
  if (!internalCitationPattern.test(text) && sanitizedText === text) {
    internalCitationPattern.lastIndex = 0
    return text
  }
  internalCitationPattern.lastIndex = 0

  const nodes = []
  let lastIndex = 0

  for (const match of text.matchAll(internalCitationPattern)) {
    const matchIndex = match.index ?? 0
    const chunkIds = chunkIdsInCitation(match[1] ?? "").filter(
      (chunkId) => !clickableCitations || clickableCitations.has(chunkId),
    )
    if (chunkIds.length === 0) {
      continue
    }
    if (matchIndex > lastIndex) {
      nodes.push(
        <span key={`text-${lastIndex}`}>
          {sanitizeInternalReferenceText(text.slice(lastIndex, matchIndex), citationLabels)}
        </span>,
      )
    }
    for (const chunkId of chunkIds) {
      nodes.push(
        <CitationButton
          key={`${chunkId}-${matchIndex}-${nodes.length}`}
          chunkId={chunkId}
          label={citationLabelForChunkId(chunkId, citationLabels)}
          evidence={citationEvidence?.get(chunkId)}
          onClick={onCitationClick}
        />,
      )
    }
    lastIndex = matchIndex + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(
      <span key={`text-${lastIndex}`}>
        {sanitizeInternalReferenceText(text.slice(lastIndex), citationLabels)}
      </span>,
    )
  }

  return nodes
}

function CitationButton({
  chunkId,
  evidence,
  label,
  onClick,
}: {
  chunkId: string
  evidence?: EvidencePreview
  label: string
  onClick?: (chunkId: string) => void
}) {
  const previewTitle = sanitizeCitationPreview(evidence?.title)
  const pageLabel =
    evidence?.pageIndex === null || evidence?.pageIndex === undefined
      ? ""
      : `第 ${evidence.pageIndex + 1} 页`
  // 浮层标题优先用页码（最可定位），正文用章节/来源标题；二者都缺时回退到引用标签。
  const previewHeading = pageLabel || label
  const previewBody = previewTitle && previewTitle !== previewHeading ? previewTitle : ""
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="mx-1 inline-flex translate-y-[-1px] rounded border bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground transition-[background-color,box-shadow,transform] duration-interactive ease-reader hover:bg-accent/80 hover:shadow-sm hover:ring-1 hover:ring-primary/25 focus:outline-none focus:ring-2 focus:ring-ring active:scale-95"
        onClick={() => onClick?.(chunkId)}
        aria-label={`${label}，点击回到原文`}
      >
        {label}
      </button>
      {/* 悬浮/聚焦即时预览（自绘浮层，不用原生 title，避免 1.5s 延迟与双浮层）。 */}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-left text-xs leading-5 text-popover-foreground shadow-lg group-focus-within:block group-hover:block">
        <span className="block font-medium">{previewHeading}</span>
        {previewBody ? <span className="mt-1 block text-muted-foreground">{previewBody}</span> : null}
        <span className="mt-1.5 block text-[10px] text-muted-foreground/70">点击回到原文高亮</span>
      </span>
    </span>
  )
}

function sanitizeCitationPreview(value?: string | null) {
  return sanitizeInternalReferenceText(value ?? "")
    .replace(/[A-Za-z0-9]{6,}-p\d+-c\d+-[A-Za-z0-9]{6,}/g, "引用")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}
