import { resolveTextQuoteSelector } from "@/core/text-quote-selector"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { ParsedPage, SavedHighlight, TextSelectionAnchor } from "@/stores/reader-store"

export type HighlightRestoreTarget = {
  pageIndex: number
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  interpretation: string | null
  strategy: "quote" | "geometry" | "stored-page" | "current-page"
}

export function restoreTargetForSavedHighlight(
  highlight: SavedHighlight,
  pages: ParsedPage[],
  currentPage: number,
): HighlightRestoreTarget {
  const pagesByIndex = new Map(pages.map((page) => [page.pageIndex, page]))
  const preferredPages = highlightPreferredPages(highlight, pages)
  for (const pageIndex of preferredPages) {
    const page = pagesByIndex.get(pageIndex)
    if (!page) continue
    const resolved = resolveTextQuoteSelector(page.text, {
      exact: highlight.selectionText,
      prefix: highlight.prefix,
      suffix: highlight.suffix,
      positionStart: highlight.positionStart ?? null,
      positionEnd: highlight.positionEnd ?? null,
    })
    if (!resolved) continue
    return {
      pageIndex,
      selectionText: highlight.selectionText,
      selectionRects: [],
      selectionAnchor: {
        pageIndex,
        positionStart: resolved.positionStart,
        positionEnd: resolved.positionEnd,
      },
      interpretation: highlight.interpretation ?? null,
      strategy: "quote",
    }
  }

  const geometryPageIndex = highlight.rects[0]?.pageIndex
  if (geometryPageIndex !== undefined) {
    return {
      pageIndex: geometryPageIndex,
      selectionText: highlight.selectionText,
      selectionRects: highlight.rects,
      selectionAnchor: null,
      interpretation: highlight.interpretation ?? null,
      strategy: "geometry",
    }
  }

  if (highlight.pageIndex !== null && highlight.pageIndex !== undefined) {
    return {
      pageIndex: highlight.pageIndex,
      selectionText: highlight.selectionText,
      selectionRects: [],
      selectionAnchor: null,
      interpretation: highlight.interpretation ?? null,
      strategy: "stored-page",
    }
  }

  return {
    pageIndex: Math.max(0, currentPage - 1),
    selectionText: highlight.selectionText,
    selectionRects: [],
    selectionAnchor: null,
    interpretation: highlight.interpretation ?? null,
    strategy: "current-page",
  }
}

function highlightPreferredPages(highlight: SavedHighlight, pages: ParsedPage[]) {
  const preferred = [
    highlight.pageIndex,
    highlight.rects[0]?.pageIndex,
    ...highlight.rects.map((rect) => rect.pageIndex),
    ...pages.map((page) => page.pageIndex),
  ].filter((pageIndex): pageIndex is number => pageIndex !== null && pageIndex !== undefined)

  const seen = new Set<number>()
  return preferred.filter((pageIndex) => {
    if (seen.has(pageIndex)) return false
    seen.add(pageIndex)
    return true
  })
}
