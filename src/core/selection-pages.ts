import type { NormalizedPageRect } from "@/core/coordinates"
import type { TextSelectionAnchor } from "@/stores/reader-store"

export function focusPageIndexesForSelection({
  selectionRects,
  selectionAnchor,
  currentPage,
}: {
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  currentPage: number
}) {
  const rectPages = [...new Set(selectionRects.map((rect) => rect.pageIndex))]
  if (rectPages.length > 0) {
    return rectPages
  }
  if (selectionAnchor) {
    return [selectionAnchor.pageIndex]
  }
  return currentPage > 0 ? [currentPage - 1] : []
}

export function primaryPageIndexForSelection({
  selectionRects,
  selectionAnchor,
  currentPage,
}: {
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  currentPage: number
}) {
  return focusPageIndexesForSelection({ selectionRects, selectionAnchor, currentPage })[0] ?? null
}
