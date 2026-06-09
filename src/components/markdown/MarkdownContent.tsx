import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { cn } from "@/lib/utils"
import type { EvidencePreview } from "@/stores/reader-store"
import {
  citationLabelMap,
} from "@/core/citation-display"
import { markdownImageSrc } from "@/core/markdown-assets"
import { normalizeWhitespace, resolveTextQuoteSelector } from "@/core/text-quote-selector"
import { renderMarkdownTextWithCitations } from "./markdown-citations"

type MarkdownContentProps = {
  content: string
  evidence?: EvidencePreview[]
  citationChunkIds?: string[]
  onCitationClick?: (chunkId: string) => void
  className?: string
  emptyText?: string
  allowRawHtml?: boolean
  highlightSourceText?: string
  highlights?: MarkdownTextHighlight[]
  headingAnchor?: MarkdownHeadingAnchor | null
}

type MarkdownTextHighlight = {
  id: string
  selectionText: string
  prefix?: string
  suffix?: string
  positionStart?: number | null
  positionEnd?: number | null
}

type MarkdownHeadingAnchor = {
  id: string
  text: string
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

function MarkdownContentBase({
  content,
  evidence = [],
  citationChunkIds,
  onCitationClick,
  className,
  emptyText = "",
  allowRawHtml = false,
  highlightSourceText,
  highlights = [],
  headingAnchor = null,
}: MarkdownContentProps) {
  const clickableCitations = citationChunkIds
    ? new Set(citationChunkIds)
    : evidence.length > 0
      ? new Set(evidence.map((item) => item.chunkId))
      : undefined
  const citationLabels = citationLabelMap(evidence)
  const citationEvidence = citationEvidenceMap(evidence)
  const source = allowRawHtml
    ? content.trim() || emptyText
    : sanitizeRawHtmlTags(content.trim() || emptyText)
  const markdownSource = normalizeStandaloneDisplayMath(source)
  const highlightState = createMarkdownHighlightState(
    highlightSourceText?.trim() ? highlightSourceText : source,
    highlights,
  )

  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={
          allowRawHtml
            ? [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], [rehypeKatex, katexOptions]]
            : [[rehypeKatex, katexOptions]]
        }
        components={markdownComponents({
          clickableCitations,
          citationEvidence,
          citationLabels,
          headingAnchor,
          highlightState,
          onCitationClick,
        })}
        urlTransform={markdownUrlTransform}
      >
        {markdownSource}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentBase, areMarkdownContentPropsEqual)

function areMarkdownContentPropsEqual(left: MarkdownContentProps, right: MarkdownContentProps) {
  return (
    left.content === right.content &&
    left.className === right.className &&
    left.emptyText === right.emptyText &&
    left.allowRawHtml === right.allowRawHtml &&
    left.highlightSourceText === right.highlightSourceText &&
    left.headingAnchor?.id === right.headingAnchor?.id &&
    left.headingAnchor?.text === right.headingAnchor?.text &&
    left.onCitationClick === right.onCitationClick &&
    shallowEvidenceEqual(left.evidence, right.evidence) &&
    shallowStringArrayEqual(left.citationChunkIds, right.citationChunkIds) &&
    shallowHighlightsEqual(left.highlights, right.highlights)
  )
}

function shallowEvidenceEqual(left: EvidencePreview[] = [], right: EvidencePreview[] = []) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every(
    (item, index) =>
      item.chunkId === right[index].chunkId &&
      item.title === right[index].title &&
      item.pageIndex === right[index].pageIndex,
  )
}

function citationEvidenceMap(evidence: EvidencePreview[]) {
  return new Map(evidence.map((item) => [item.chunkId, item]))
}

function shallowStringArrayEqual(left: string[] = [], right: string[] = []) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function shallowHighlightsEqual(
  left: MarkdownTextHighlight[] = [],
  right: MarkdownTextHighlight[] = [],
) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return (
      item.id === other.id &&
      item.selectionText === other.selectionText &&
      item.prefix === other.prefix &&
      item.suffix === other.suffix &&
      item.positionStart === other.positionStart &&
      item.positionEnd === other.positionEnd
    )
  })
}

function markdownComponents({
  clickableCitations,
  citationEvidence,
  citationLabels,
  headingAnchor,
  highlightState,
  onCitationClick,
}: {
  clickableCitations?: ReadonlySet<string>
  citationEvidence?: ReadonlyMap<string, EvidencePreview>
  citationLabels?: ReadonlyMap<string, string>
  headingAnchor?: MarkdownHeadingAnchor | null
  highlightState?: MarkdownHighlightState
  onCitationClick?: (chunkId: string) => void
}): Components {
  const renderChildren = (children: ReactNode) =>
    renderMarkdownChildrenWithCitations(
      children,
      onCitationClick,
      clickableCitations,
      citationLabels,
      citationEvidence,
      highlightState,
    )

  return {
    p: ({ children }) => <p className="my-3 leading-7">{renderChildren(children)}</p>,
    h1: ({ children }) => (
      <h1
        className="mb-4 mt-5 text-xl font-semibold leading-8"
        {...headingAnchorAttributes(children, headingAnchor)}
      >
        {renderChildren(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className="mb-3 mt-5 text-lg font-semibold leading-7"
        {...headingAnchorAttributes(children, headingAnchor)}
      >
        {renderChildren(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className="mb-2 mt-4 text-base font-semibold leading-7"
        {...headingAnchorAttributes(children, headingAnchor)}
      >
        {renderChildren(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4
        className="mb-2 mt-4 text-sm font-semibold leading-6"
        {...headingAnchorAttributes(children, headingAnchor)}
      >
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
    th: ({ children, colSpan, rowSpan }) => (
      <th colSpan={colSpan} rowSpan={rowSpan} className="border-b px-3 py-2 font-semibold">
        {renderChildren(children)}
      </th>
    ),
    td: ({ children, colSpan, rowSpan }) => (
      <td colSpan={colSpan} rowSpan={rowSpan} className="border-t px-3 py-2 align-top">
        {renderChildren(children)}
      </td>
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
    img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
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

function headingAnchorAttributes(children: ReactNode, headingAnchor?: MarkdownHeadingAnchor | null) {
  if (!headingAnchor?.id || !headingAnchor.text.trim()) {
    return {}
  }
  if (!markdownHeadingMatchesAnchor(reactNodeText(children), headingAnchor.text)) {
    return {}
  }
  return {
    "data-outline-anchor-id": headingAnchor.id,
  }
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(reactNodeText).join("")
  }
  if (isValidElement(node)) {
    return reactNodeText((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ""
}

function markdownHeadingMatchesAnchor(heading: string, anchor: string) {
  const headingKey = normalizeMarkdownHeadingKey(heading)
  const anchorKey = normalizeMarkdownHeadingKey(anchor)
  return (
    Boolean(headingKey && anchorKey) &&
    (headingKey === anchorKey || headingKey.endsWith(anchorKey) || anchorKey.endsWith(headingKey))
  )
}

function normalizeMarkdownHeadingKey(value: string) {
  return value
    .replace(/[\s.#*_`~:：、，,;；\-–—()[\]{}]+/g, "")
    .toLowerCase()
}

function MarkdownImage({ src, alt }: { src?: string | null; alt?: string | null }) {
  const [loadFailed, setLoadFailed] = useState(false)
  const resolvedSrc = markdownImageSrc(src)

  useEffect(() => {
    setLoadFailed(false)
  }, [resolvedSrc])

  if (!resolvedSrc) {
    return null
  }
  if (loadFailed) {
    return (
      <span className="my-4 block rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        图片加载失败。
      </span>
    )
  }
  return (
    <img
      src={resolvedSrc}
      alt={alt ?? ""}
      className="my-4 max-h-[70vh] max-w-full rounded border object-contain"
      loading="lazy"
      decoding="async"
      onError={() => setLoadFailed(true)}
    />
  )
}

function markdownUrlTransform(value: string, key: string, node: { tagName?: string }) {
  if (key === "src" && node.tagName === "img" && isAllowedMarkdownImageUrl(value)) {
    return value
  }
  return defaultUrlTransform(value)
}

function isAllowedMarkdownImageUrl(value: string) {
  const trimmed = value.trim()
  return (
    /^(?:file|asset):/i.test(trimmed) ||
    /^https?:\/\/asset\.localhost(?::\d+)?(?:[/?#]|$)/i.test(trimmed) ||
    /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(trimmed)
  )
}

function renderMarkdownChildrenWithCitations(
  children: ReactNode,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
  citationEvidence?: ReadonlyMap<string, EvidencePreview>,
  highlightState?: MarkdownHighlightState,
): ReactNode {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === "string" || typeof child === "number") {
      return renderMarkdownTextWithHighlights(
        String(child),
        onCitationClick,
        clickableCitations,
        citationLabels,
        citationEvidence,
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
          citationEvidence,
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
  citationEvidence?: ReadonlyMap<string, EvidencePreview>,
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
      citationEvidence,
    )
  }

  return segments.map((segment, index) => {
    const rendered = renderMarkdownTextWithCitations(
      segment.text,
      onCitationClick,
      clickableCitations,
      citationLabels,
      citationEvidence,
    )
    if (!segment.highlightId) {
      return <span key={`text-${keyPrefix}-${index}`}>{rendered}</span>
    }
    return (
      <mark
        key={`highlight-${segment.highlightId}-${keyPrefix}-${index}`}
        className={markdownHighlightClassName(segment.highlightId)}
        data-highlight-id={segment.highlightId}
        data-highlight-type={markdownHighlightType(segment.highlightId)}
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
    return "reader-current-text-selection box-decoration-clone rounded-sm bg-amber-200/80 text-foreground ring-1 ring-amber-500/35 dark:bg-amber-300/35"
  }
  if (id === "active-citation-target") {
    return "box-decoration-clone rounded-sm bg-sky-200/75 text-foreground ring-1 ring-sky-500/25 animate-citation-pulse dark:bg-sky-300/30"
  }
  if (id.startsWith("spark-anchor-")) {
    return "reader-spark-text-anchor"
  }
  return "box-decoration-clone rounded-sm bg-teal-300/35 text-foreground dark:bg-teal-300/25"
}

function markdownHighlightType(id: string) {
  if (id === "current-text-selection") return "selection"
  if (id === "active-citation-target") return "citation"
  return "saved"
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

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    td: [
      ...(defaultSchema.attributes?.td ?? []),
      "colSpan",
      "rowSpan",
      "align",
      "valign",
    ],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      "colSpan",
      "rowSpan",
      "align",
      "valign",
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "file", "data", "asset"],
  },
}

const katexOptions = {
  strict: false,
  throwOnError: false,
}

function sanitizeRawHtmlTags(source: string) {
  return source
    .replace(/<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/g, "&lt;/$1&gt;")
    .replace(/<([A-Za-z][A-Za-z0-9:-]*)(?:\s[^>]*)?\s*\/?>/g, "&lt;$1&gt;")
}

function normalizeStandaloneDisplayMath(source: string) {
  return source.replace(
    /^([ \t]*)\$\$[ \t]*(\S[\s\S]*?\S|\S)[ \t]*\$\$[ \t]*$/gm,
    (_match, indent: string, formula: string) => `${indent}$$\n${formula}\n${indent}$$`,
  )
}
