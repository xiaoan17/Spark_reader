import {
  chunkIdsInCitation,
  citationMarkerLabel,
  internalCitationPattern,
  sanitizeInternalReferenceText,
} from "@/core/citation-display"

export function renderMarkdownTextWithCitations(
  text: string,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
  citationEvidence?: ReadonlyMap<string, unknown>,
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
  const localCitationLabels = new Map<string, string>()
  let nextCitationIndex = 0
  const labelForCitation = (chunkId: string) => {
    const knownLabel = citationLabels?.get(chunkId)
    if (knownLabel) {
      return knownLabel
    }
    const existingLabel = localCitationLabels.get(chunkId)
    if (existingLabel) {
      return existingLabel
    }
    const label = citationMarkerLabel(nextCitationIndex)
    nextCitationIndex += 1
    localCitationLabels.set(chunkId, label)
    return label
  }

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
          label={labelForCitation(chunkId)}
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
  label,
  onClick,
}: {
  chunkId: string
  label: string
  onClick?: (chunkId: string) => void
}) {
  return (
    <span className="inline-flex">
      <button
        type="button"
        className="mx-0.5 inline-flex align-super text-[0.72em] font-semibold leading-none text-primary underline-offset-2 transition-colors duration-subtle ease-reader hover:text-primary/80 hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
        onClick={() => onClick?.(chunkId)}
        aria-label={`${label}，点击回到原文`}
      >
        {label}
      </button>
    </span>
  )
}
