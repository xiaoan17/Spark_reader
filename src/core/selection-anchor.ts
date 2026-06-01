import { makeTextQuoteSelector } from "@/core/text-quote-selector"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { ParsedPage, TextSelectionAnchor } from "@/stores/reader-store"

export function inferTextSelectionAnchor({
  selectionText,
  selectionRects,
  currentPage,
  pages,
}: {
  selectionText: string
  selectionRects: NormalizedPageRect[]
  currentPage: number
  pages: ParsedPage[]
}): TextSelectionAnchor | null {
  const pageIndex = selectionRects[0]?.pageIndex ?? (currentPage > 0 ? currentPage - 1 : null)
  if (pageIndex === null || pageIndex === undefined) {
    return null
  }

  const pageText = pages.find((page) => page.pageIndex === pageIndex)?.text ?? ""
  const selector = makeTextQuoteSelector(pageText, selectionText)
  if (selector.positionStart === null || selector.positionEnd === null) {
    return null
  }

  return {
    pageIndex,
    positionStart: selector.positionStart,
    positionEnd: selector.positionEnd,
  }
}
