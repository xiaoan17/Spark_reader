import { describe, expect, it } from "vitest"
import { inferTextSelectionAnchor } from "./selection-anchor"

describe("selection anchor inference", () => {
  it("bridges a PDF geometry selection back to converted page text", () => {
    expect(
      inferTextSelectionAnchor({
        selectionText: "复利来自长期坚持",
        selectionRects: [{ pageIndex: 2, x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.3 }],
        currentPage: 1,
        pages: [{ pageIndex: 2, text: "前文。复利来自长期坚持。后文。", markdown: "" }],
      }),
    ).toEqual({
      pageIndex: 2,
      positionStart: 3,
      positionEnd: 11,
    })
  })

  it("falls back to the current converted page when no geometry exists", () => {
    expect(
      inferTextSelectionAnchor({
        selectionText: "现金流",
        selectionRects: [],
        currentPage: 4,
        pages: [{ pageIndex: 3, text: "这一页讲现金流。", markdown: "" }],
      }),
    ).toEqual({
      pageIndex: 3,
      positionStart: 4,
      positionEnd: 7,
    })
  })

  it("returns null when the converted page text cannot prove the quote", () => {
    expect(
      inferTextSelectionAnchor({
        selectionText: "不存在",
        selectionRects: [{ pageIndex: 0, x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.3 }],
        currentPage: 1,
        pages: [{ pageIndex: 0, text: "真实文本", markdown: "" }],
      }),
    ).toBeNull()
  })
})
