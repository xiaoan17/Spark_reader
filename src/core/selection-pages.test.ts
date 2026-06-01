import { describe, expect, it } from "vitest"
import { focusPageIndexesForSelection, primaryPageIndexForSelection } from "./selection-pages"

describe("selection page resolution", () => {
  it("prefers PDF geometry pages when rects exist", () => {
    expect(
      focusPageIndexesForSelection({
        selectionRects: [
          { pageIndex: 2, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 },
          { pageIndex: 3, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 },
        ],
        selectionAnchor: { pageIndex: 8, positionStart: 0, positionEnd: 2 },
        currentPage: 10,
      }),
    ).toEqual([2, 3])
  })

  it("uses the text selection anchor page before the visible page fallback", () => {
    expect(
      primaryPageIndexForSelection({
        selectionRects: [],
        selectionAnchor: { pageIndex: 8, positionStart: 0, positionEnd: 2 },
        currentPage: 10,
      }),
    ).toBe(8)
  })

  it("falls back to current page when selection has no geometry or text anchor", () => {
    expect(
      focusPageIndexesForSelection({
        selectionRects: [],
        selectionAnchor: null,
        currentPage: 10,
      }),
    ).toEqual([9])
  })
})
