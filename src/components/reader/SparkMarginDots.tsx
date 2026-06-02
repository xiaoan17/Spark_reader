import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { normalizeWhitespace } from "@/core/text-quote-selector"
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
  const anchorPercents = useSparkDotAnchorPercents(marginRef, pageItems, pageSelector)
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
) {
  const [anchorPercents, setAnchorPercents] = useState(new Map<string, number>())
  const itemIds = items.map((item) => item.id).join("\u0000")

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
    return () => observer.disconnect()
  }, [itemIds, marginRef, pageSelector])

  return anchorPercents
}

export function sparkItemBelongsToPage(item: SavedInterpretation, pageIndex: number) {
  const kind = item.kind ?? "interpretation"
  return (
    (kind === "spark" || kind === "note") &&
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

function sparkDotPercentMapsEqual(left: Map<string, number>, right: Map<string, number>) {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function clampSparkDotPercent(value: number) {
  return Math.max(5, Math.min(92, value))
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, "\\$&")
}
