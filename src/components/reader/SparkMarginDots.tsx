import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import {
  normalizeWhitespace,
  resolveTextQuoteSelector,
} from "@/core/text-quote-selector"
import type { SavedHighlight, SavedInterpretation } from "@/stores/reader-store"

type SparkMarginDotsProps = {
  pageIndex: number
  pageText: string
  items: SavedInterpretation[]
  pageSelector: string
  className?: string
  onOpen?: (item: SavedInterpretation) => void
}

export function SparkMarginDots({
  pageIndex,
  pageText,
  items,
  pageSelector,
  className = "pointer-events-none absolute -right-7 top-0 z-20 h-full w-5",
  onOpen,
}: SparkMarginDotsProps) {
  const pageItems = items.filter((item) => sparkItemBelongsToPage(item, pageIndex)).slice(0, 24)
  const marginRef = useRef<HTMLDivElement | null>(null)
  const anchorPercents = useSparkDotAnchorPercents(marginRef, pageItems, pageSelector, pageText)
  if (pageItems.length === 0) {
    return null
  }
  const textLength = Math.max(1, normalizeWhitespace(pageText).length)
  return (
    <div ref={marginRef} data-spark-margin-dots className={className}>
      {pageItems.map((item, index) => {
        const kind = item.kind ?? "interpretation"
        const normalizedStart =
          item.pageIndex === pageIndex && typeof item.positionStart === "number"
            ? item.positionStart
            : Math.round((index + 1) * (textLength / (pageItems.length + 1)))
        const topPercent =
          anchorPercents.get(item.id) ?? clampSparkDotPercent((normalizedStart / textLength) * 100)
        return (
          <button
            key={item.id}
            type="button"
            aria-label={kind === "note" ? "打开 Note" : "打开 Spark"}
            title={kind === "note" ? "Note" : "Spark"}
            className={`pointer-events-auto absolute h-2.5 w-2.5 -translate-y-1/2 rounded-full border shadow-sm transition hover:scale-125 ${
              kind === "note"
                ? "border-amber-600 bg-amber-400"
                : "border-violet-700 bg-violet-500"
            }`}
            style={{ top: `${topPercent}%` }}
            onClick={() => onOpen?.(item)}
          />
        )
      })}
    </div>
  )
}

function useSparkDotAnchorPercents(
  marginRef: RefObject<HTMLElement | null>,
  items: SavedInterpretation[],
  pageSelector: string,
  pageText: string,
) {
  const [anchorPercents, setAnchorPercents] = useState(new Map<string, number>())
  const itemSignature = items
    .map((item) =>
      [
        item.id,
        item.pageIndex ?? "",
        item.positionStart ?? "",
        item.positionEnd ?? "",
        item.selectionText,
        item.prefix ?? "",
        item.suffix ?? "",
        item.pageIndexes.join(","),
      ].join("\u0001"),
    )
    .join("\u0000")

  useLayoutEffect(() => {
    const marginElement = marginRef.current
    const pageRef = marginRef.current?.closest<HTMLElement>(pageSelector) ?? null
    if (!marginElement || !pageRef || items.length === 0) {
      setAnchorPercents(new Map())
      return
    }

    const measure = () => {
      const next = new Map<string, number>()
      for (const item of items) {
        const percent =
          sparkDotTopPercentFromDom(pageRef, marginElement, sparkItemHighlightId(item.id)) ??
          sparkDotTopPercentFromTextAnchor(pageRef, marginElement, item, pageText) ??
          sparkDotTopPercentFromCurrentSelection(pageRef, marginElement, item)
        if (percent !== null) {
          next.set(item.id, percent)
        }
      }
      setAnchorPercents((current) => (sparkDotPercentMapsEqual(current, next) ? current : next))
    }

    measure()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(pageRef)
    observer.observe(marginElement)
    const renderedTextRoot = sparkPageRenderedTextRoot(pageRef)
    if (renderedTextRoot && renderedTextRoot !== pageRef && renderedTextRoot !== marginElement) {
      observer.observe(renderedTextRoot)
    }
    return () => observer.disconnect()
  }, [itemSignature, marginRef, pageSelector, pageText])

  return anchorPercents
}

export function sparkItemBelongsToPage(item: SavedInterpretation, pageIndex: number) {
  const kind = item.kind ?? "interpretation"
  return (
    (kind === "interpretation" || kind === "spark" || kind === "note") &&
    (item.pageIndex === pageIndex || item.pageIndexes.includes(pageIndex))
  )
}

export function sparkItemHighlight(item: SavedInterpretation, pageIndex: number): SavedHighlight {
  return {
    id: sparkItemHighlightId(item.id),
    bookId: item.bookId,
    selectionText: item.selectionText,
    prefix: item.prefix ?? "",
    suffix: item.suffix ?? "",
    pageIndex,
    positionStart: item.pageIndex === pageIndex ? item.positionStart ?? null : null,
    positionEnd: item.pageIndex === pageIndex ? item.positionEnd ?? null : null,
    rects: [],
    interpretation: null,
    createdAt: item.createdAt,
  }
}

export function sparkItemHighlightId(itemId: string) {
  return `spark-anchor-${itemId}`
}

function sparkDotTopPercentFromDom(
  pageRef: HTMLElement | null,
  marginElement: HTMLElement,
  highlightId: string,
) {
  const mark = pageRef?.querySelector<HTMLElement>(`[data-highlight-id="${cssEscape(highlightId)}"]`)
  if (!mark || !pageRef) {
    return null
  }
  return sparkDotTopPercentForElement(marginElement, mark)
}

function sparkDotTopPercentFromCurrentSelection(
  pageRef: HTMLElement | null,
  marginElement: HTMLElement,
  item: SavedInterpretation,
) {
  const currentSelection = pageRef?.querySelector<HTMLElement>("[data-current-selection='true']")
  if (!currentSelection) {
    return null
  }
  const selectedText = normalizeWhitespace(currentSelection.textContent ?? "")
  if (!selectedText || selectedText !== normalizeWhitespace(item.selectionText)) {
    return null
  }
  return sparkDotTopPercentForElement(marginElement, currentSelection)
}

function sparkDotTopPercentFromTextAnchor(
  pageRef: HTMLElement | null,
  marginElement: HTMLElement,
  item: SavedInterpretation,
  pageText: string,
) {
  if (!pageRef || item.pageIndex === null || item.pageIndex === undefined) {
    return null
  }
  const pageIndex = Number(pageRef.dataset.pageIndex)
  if (pageIndex !== item.pageIndex) {
    return null
  }
  const sourceText = pageTextForSparkAnchor(pageRef, pageText)
  if (!sourceText) {
    return null
  }
  const resolved = resolveTextQuoteSelector(sourceText, {
    exact: item.selectionText,
    prefix: item.prefix ?? "",
    suffix: item.suffix ?? "",
    positionStart: item.positionStart ?? null,
    positionEnd: item.positionEnd ?? null,
  })
  const normalizedStart = resolved?.positionStart ?? item.positionStart
  const normalizedEnd = resolved?.positionEnd ?? item.positionEnd
  if (
    normalizedStart === null ||
    normalizedStart === undefined ||
    normalizedEnd === null ||
    normalizedEnd === undefined ||
    normalizedEnd <= normalizedStart
  ) {
    return null
  }

  const renderedTextRoot = sparkPageRenderedTextRoot(pageRef)
  if (!renderedTextRoot) {
    return null
  }
  const range = rangeForNormalizedTextOffsets(
    renderedTextRoot,
    sourceText,
    normalizedStart,
    normalizedEnd,
  )
  if (!range) {
    return null
  }
  const percent = sparkDotTopPercentForRange(marginElement, range)
  range.detach()
  return percent
}

function sparkDotTopPercentForElement(container: HTMLElement, element: HTMLElement) {
  const markRect = element.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  if (containerRect.height <= 0 || markRect.height <= 0) {
    return null
  }
  return clampSparkDotPercent(
    ((markRect.top + markRect.height / 2 - containerRect.top) / containerRect.height) * 100,
  )
}

function sparkDotTopPercentForRange(container: HTMLElement, range: Range) {
  const rangeWithRects = range as Range & {
    getClientRects?: () => DOMRectList
    getBoundingClientRect?: () => DOMRect
  }
  if (
    typeof rangeWithRects.getClientRects !== "function" ||
    typeof rangeWithRects.getBoundingClientRect !== "function"
  ) {
    return null
  }
  const rects = Array.from(rangeWithRects.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  )
  const firstRect = rects[0] ?? rangeWithRects.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  if (containerRect.height <= 0 || firstRect.height <= 0) {
    return null
  }
  return clampSparkDotPercent(
    ((firstRect.top + firstRect.height / 2 - containerRect.top) / containerRect.height) * 100,
  )
}

function pageTextForSparkAnchor(pageRef: HTMLElement, pageText: string) {
  if (pageText.trim()) {
    return pageText
  }
  const sourceElement = pageRef.querySelector<HTMLElement>("[data-source-text]")
  return sourceElement?.dataset.sourceText ?? pageRef.textContent ?? ""
}

function sparkPageRenderedTextRoot(pageRef: HTMLElement) {
  return pageRef.querySelector<HTMLElement>("[data-spark-text-root]") ?? pageRef
}

function rangeForNormalizedTextOffsets(
  root: HTMLElement,
  sourceText: string,
  normalizedStart: number,
  normalizedEnd: number,
) {
  const normalizedSource = normalizeWhitespace(sourceText)
  if (!normalizedSource || normalizedEnd > normalizedSource.length) {
    return null
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return textNodeBelongsToSparkContent(root, node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })
  const range = document.createRange()
  let sourceCursor = 0
  let start: TextOffset | null = null
  let end: TextOffset | null = null
  let lastTextNode: Text | null = null

  const capture = (node: Text, offset: number) => {
    if (!start && sourceCursor >= normalizedStart) {
      start = { node, offset }
    }
    if (!end && sourceCursor >= normalizedEnd) {
      end = { node, offset }
    }
  }

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text
    lastTextNode = textNode
    for (let offset = 0; offset < textNode.data.length; offset += 1) {
      capture(textNode, offset)
      if (start && end) break
      const char = textNode.data[offset]
      if (/\s/.test(char)) {
        if (normalizedSource[sourceCursor] === " ") {
          sourceCursor += 1
          capture(textNode, offset + 1)
        }
        continue
      }

      while (normalizedSource[sourceCursor] === " ") {
        sourceCursor += 1
        capture(textNode, offset)
      }
      sourceCursor = nextSourceCursorAfterChar(normalizedSource, sourceCursor, char)
      capture(textNode, offset + 1)
    }
    capture(textNode, textNode.data.length)
    if (start && end) {
      break
    }
  }

  const resolvedStart = start as TextOffset | null
  let resolvedEnd = end as TextOffset | null
  if (!resolvedStart || !resolvedEnd) {
    if (!resolvedStart || !lastTextNode || sourceCursor < normalizedEnd) {
      range.detach()
      return null
    }
    resolvedEnd = { node: lastTextNode, offset: lastTextNode.data.length }
  }
  if (resolvedStart.node === resolvedEnd.node && resolvedEnd.offset <= resolvedStart.offset) {
    range.detach()
    return null
  }
  range.setStart(resolvedStart.node, resolvedStart.offset)
  range.setEnd(resolvedEnd.node, resolvedEnd.offset)
  return range
}

function nextSourceCursorAfterChar(source: string, sourceCursor: number, char: string) {
  if (sourceCursor >= source.length) {
    return sourceCursor
  }
  if (source[sourceCursor] === char) {
    return sourceCursor + 1
  }
  const nearbyMatch = source.indexOf(char, sourceCursor + 1)
  if (nearbyMatch >= 0 && nearbyMatch - sourceCursor <= 4) {
    return nearbyMatch + 1
  }
  return sourceCursor + 1
}

type TextOffset = {
  node: Text
  offset: number
}

function textNodeBelongsToSparkContent(root: HTMLElement, node: Node) {
  const parent = node.parentElement
  if (!parent) {
    return false
  }
  if (!root.contains(parent)) {
    return false
  }
  if (parent.closest("[data-spark-margin-dots], [data-testid='selection-toolbar']")) {
    return false
  }
  return true
}

function sparkDotPercentMapsEqual(left: Map<string, number>, right: Map<string, number>) {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function clampSparkDotPercent(value: number) {
  return Math.max(1, Math.min(99, value))
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, "\\$&")
}
