import type { NormalizedPageRect } from "@/core/coordinates"
import type { TextSelectionAnchor } from "@/stores/reader-store"

export function shouldRenderCurrentTextSelection(
  pageIndex: number,
  currentPage: number,
  selectionText: string,
  selectionAnchor: TextSelectionAnchor | null,
  selectionRects: NormalizedPageRect[],
) {
  if (!selectionText.trim()) {
    return false
  }
  if (selectionAnchor) {
    return selectionAnchor.pageIndex === pageIndex
  }
  if (selectionRects.length > 0) {
    return selectionRects.some((rect) => rect.pageIndex === pageIndex)
  }
  return currentPage === pageIndex + 1
}
