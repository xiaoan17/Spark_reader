import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import type { EvidencePreview } from "@/stores/reader-store"
import {
  chunkIdsInCitation,
  citationLabelForChunkId,
  citationLabelMap,
  internalCitationPattern,
  sanitizeInternalReferenceText,
} from "@/core/citation-display"
import { normalizeWhitespace, resolveTextQuoteSelector } from "@/core/text-quote-selector"

type MarkdownContentProps = {
  content: string
  evidence?: EvidencePreview[]
  citationChunkIds?: string[]
  onCitationClick?: (chunkId: string) => void
  className?: string
  emptyText?: string
  highlightSourceText?: string
  highlights?: MarkdownTextHighlight[]
}

type MarkdownTextHighlight = {
  id: string
  selectionText: string
  prefix?: string
  suffix?: string
  positionStart?: number | null
  positionEnd?: number | null
}

type MarkdownHighlightRange = {
  id: string
  start: number
  end: number
}

type MarkdownHighlightState = {
  normalizedSource: string
  ranges: MarkdownHighlightRange[]
  cursor: number
}

export function MarkdownContent({
  content,
  evidence = [],
  citationChunkIds,
  onCitationClick,
  className,
  emptyText = "",
  highlightSourceText,
  highlights = [],
}: MarkdownContentProps) {
  const clickableCitations = citationChunkIds
    ? new Set(citationChunkIds)
    : evidence.length > 0
      ? new Set(evidence.map((item) => item.chunkId))
      : undefined
  const citationLabels = citationLabelMap(evidence)
  const source = sanitizeRawHtmlTags(content.trim() || emptyText)
  const highlightState = createMarkdownHighlightState(
    highlightSourceText?.trim() ? highlightSourceText : source,
    highlights,
  )

  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents({
          clickableCitations,
          citationLabels,
          highlightState,
          onCitationClick,
        })}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}

export function renderMarkdownTextWithCitations(
  text: string,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
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

function markdownComponents({
  clickableCitations,
  citationLabels,
  highlightState,
  onCitationClick,
}: {
  clickableCitations?: ReadonlySet<string>
  citationLabels?: ReadonlyMap<string, string>
  highlightState?: MarkdownHighlightState
  onCitationClick?: (chunkId: string) => void
}): Components {
  const renderChildren = (children: ReactNode) =>
    renderMarkdownChildrenWithCitations(
      children,
      onCitationClick,
      clickableCitations,
      citationLabels,
      highlightState,
    )

  return {
    p: ({ children }) => <p className="my-3 leading-7">{renderChildren(children)}</p>,
    h1: ({ children }) => (
      <h1 className="mb-4 mt-5 text-xl font-semibold leading-8">
        {renderChildren(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-3 mt-5 text-lg font-semibold leading-7">
        {renderChildren(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 mt-4 text-base font-semibold leading-7">
        {renderChildren(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-2 mt-4 text-sm font-semibold leading-6">
        {renderChildren(children)}
      </h4>
    ),
    ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="leading-7">{renderChildren(children)}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-primary/50 pl-3 text-muted-foreground">
        {renderChildren(children)}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b px-3 py-2 font-semibold">{renderChildren(children)}</th>
    ),
    td: ({ children }) => (
      <td className="border-t px-3 py-2 align-top">{renderChildren(children)}</td>
    ),
    code: ({ children, className }) => (
      <code className={cn("rounded bg-muted px-1 py-0.5 text-[0.92em]", className)}>
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-sm leading-6">
        {children}
      </pre>
    ),
    img: ({ src, alt }) => (
      <img
        src={src ?? ""}
        alt={alt ?? ""}
        className="my-4 max-h-[70vh] max-w-full rounded border object-contain"
        loading="lazy"
      />
    ),
    strong: ({ children }) => <strong>{renderChildren(children)}</strong>,
    em: ({ children }) => <em>{renderChildren(children)}</em>,
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-primary underline-offset-2 hover:underline"
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noreferrer" : undefined}
      >
        {renderChildren(children)}
      </a>
    ),
  }
}

function renderMarkdownChildrenWithCitations(
  children: ReactNode,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
  highlightState?: MarkdownHighlightState,
): ReactNode {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === "string" || typeof child === "number") {
      return renderMarkdownTextWithHighlights(
        String(child),
        onCitationClick,
        clickableCitations,
        citationLabels,
        highlightState,
        index,
      )
    }
    if (isValidElement(child)) {
      const element = child as ReactElement<{ children?: ReactNode }>
      if (!element.props.children) {
        return element
      }
      return cloneElement(element, {
        children: renderMarkdownChildrenWithCitations(
          element.props.children,
          onCitationClick,
          clickableCitations,
          citationLabels,
          highlightState,
        ),
      })
    }
    return child
  })
}

function createMarkdownHighlightState(
  sourceText: string,
  highlights: MarkdownTextHighlight[],
): MarkdownHighlightState | undefined {
  const normalizedSource = normalizeWhitespace(sourceText)
  if (!normalizedSource || highlights.length === 0) {
    return undefined
  }

  const ranges = preferCurrentSelectionRanges(
    highlights
    .map((highlight) => {
      const exact = normalizeWhitespace(highlight.selectionText)
      if (!exact) return null
      const resolved = resolveTextQuoteSelector(sourceText, {
        exact,
        prefix: highlight.prefix ?? "",
        suffix: highlight.suffix ?? "",
        positionStart: highlight.positionStart ?? null,
        positionEnd: highlight.positionEnd ?? null,
      })
      const start = resolved?.positionStart ?? normalizedSource.indexOf(exact)
      if (start < 0) return null
      const end = resolved?.positionEnd ?? start + exact.length
      if (end <= start) return null
      return {
        id: highlight.id,
        start,
        end,
      }
    })
    .filter((range): range is MarkdownHighlightRange => range !== null),
  )
    .sort(
      (left, right) =>
        left.start - right.start ||
        highlightPriority(right.id) - highlightPriority(left.id) ||
        right.end - left.end,
    )

  return ranges.length > 0
    ? {
        normalizedSource,
        ranges,
        cursor: 0,
      }
    : undefined
}

function renderMarkdownTextWithHighlights(
  text: string,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
  highlightState?: MarkdownHighlightState,
  keyPrefix = 0,
) {
  const segments = splitMarkdownTextByHighlights(text, highlightState)
  if (segments.length === 1 && !segments[0].highlightId) {
    return renderMarkdownTextWithCitations(
      text,
      onCitationClick,
      clickableCitations,
      citationLabels,
    )
  }

  return segments.map((segment, index) => {
    const rendered = renderMarkdownTextWithCitations(
      segment.text,
      onCitationClick,
      clickableCitations,
      citationLabels,
    )
    if (!segment.highlightId) {
      return <span key={`text-${keyPrefix}-${index}`}>{rendered}</span>
    }
    return (
      <mark
        key={`highlight-${segment.highlightId}-${keyPrefix}-${index}`}
        className={markdownHighlightClassName(segment.highlightId)}
        data-highlight-id={segment.highlightId}
        data-current-selection={
          segment.highlightId === "current-text-selection" ? "true" : undefined
        }
      >
        {rendered}
      </mark>
    )
  })
}

function splitMarkdownTextByHighlights(
  text: string,
  highlightState?: MarkdownHighlightState,
): Array<{ text: string; highlightId?: string }> {
  if (!highlightState) {
    return [{ text }]
  }
  const normalizedText = normalizeWhitespace(text)
  if (!normalizedText) {
    return [{ text }]
  }
  const nodeStart = findMarkdownTextNodeStart(highlightState, normalizedText)
  if (nodeStart < 0) {
    return [{ text }]
  }
  const nodeEnd = nodeStart + normalizedText.length
  highlightState.cursor = Math.max(highlightState.cursor, nodeEnd)

  const overlapping = highlightState.ranges
    .filter((range) => range.start < nodeEnd && range.end > nodeStart)
    .sort(
      (left, right) =>
        left.start - right.start ||
        highlightPriority(right.id) - highlightPriority(left.id) ||
        right.end - left.end,
    )
  if (overlapping.length === 0) {
    return [{ text }]
  }

  const segments: Array<{ text: string; highlightId?: string }> = []
  let cursor = 0
  let rawCursor = 0
  for (const range of overlapping) {
    const normalizedStart = Math.max(0, range.start - nodeStart)
    const normalizedEnd = Math.min(normalizedText.length, range.end - nodeStart)
    if (normalizedEnd <= normalizedStart || normalizedStart < cursor) {
      continue
    }
    const rawStart = rawOffsetForNormalizedMarkdownOffset(text, normalizedStart)
    const rawEnd = rawOffsetForNormalizedMarkdownOffset(text, normalizedEnd)
    if (rawEnd <= rawStart || rawStart < rawCursor) {
      continue
    }
    if (rawStart > rawCursor) {
      segments.push({ text: text.slice(rawCursor, rawStart) })
    }
    segments.push({ text: text.slice(rawStart, rawEnd), highlightId: range.id })
    cursor = normalizedEnd
    rawCursor = rawEnd
  }
  if (rawCursor < text.length) {
    segments.push({ text: text.slice(rawCursor) })
  }
  return segments.length > 0 ? segments : [{ text }]
}

function findMarkdownTextNodeStart(state: MarkdownHighlightState, normalizedText: string) {
  const afterCursor = state.normalizedSource.indexOf(normalizedText, state.cursor)
  if (afterCursor >= 0) {
    return afterCursor
  }
  return state.normalizedSource.indexOf(normalizedText)
}

function rawOffsetForNormalizedMarkdownOffset(text: string, normalizedOffset: number) {
  let normalizedCursor = 0
  let inWhitespace = false

  for (let rawOffset = 0; rawOffset < text.length; rawOffset += 1) {
    if (normalizedCursor >= normalizedOffset) {
      return rawOffset
    }
    const char = text[rawOffset]
    if (/\s/.test(char)) {
      if (!inWhitespace && normalizedCursor > 0) {
        normalizedCursor += 1
        inWhitespace = true
      }
      continue
    }
    normalizedCursor += 1
    inWhitespace = false
  }

  return text.length
}

function markdownHighlightClassName(id: string) {
  if (id === "current-text-selection") {
    return "reader-current-text-selection box-decoration-clone rounded-sm bg-amber-200/80 px-0.5 text-foreground ring-1 ring-amber-500/35 dark:bg-amber-300/35"
  }
  if (id === "active-citation-target") {
    return "box-decoration-clone rounded-sm bg-sky-200/65 px-0.5 text-foreground dark:bg-sky-300/30"
  }
  return "box-decoration-clone rounded-sm bg-teal-300/35 px-0.5 text-foreground dark:bg-teal-300/25"
}

function highlightPriority(id: string) {
  if (id === "current-text-selection") return 3
  if (id === "active-citation-target") return 2
  return 1
}

function preferCurrentSelectionRanges(ranges: MarkdownHighlightRange[]) {
  const currentSelection = ranges.find((range) => range.id === "current-text-selection")
  if (!currentSelection) {
    return ranges
  }
  return ranges.filter(
    (range) => range.id === currentSelection.id || !rangesOverlap(range, currentSelection),
  )
}

function rangesOverlap(left: MarkdownHighlightRange, right: MarkdownHighlightRange) {
  return left.start < right.end && left.end > right.start
}

function sanitizeRawHtmlTags(source: string) {
  return source
    .replace(/<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/g, "&lt;/$1&gt;")
    .replace(/<([A-Za-z][A-Za-z0-9:-]*)(?:\s[^>]*)?\s*\/?>/g, "&lt;$1&gt;")
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
    <button
      type="button"
      className="mx-1 inline-flex translate-y-[-1px] rounded border bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground"
      onClick={() => onClick?.(chunkId)}
      title={chunkId}
    >
      {label}
    </button>
  )
}
