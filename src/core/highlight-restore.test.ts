import { describe, expect, it } from "vitest"
import { restoreTargetForSavedHighlight } from "./highlight-restore"
import type { SavedHighlight } from "@/stores/reader-store"

describe("restoreTargetForSavedHighlight", () => {
  it("uses persisted quote context to reopen repeated text at the right occurrence", () => {
    const restored = restoreTargetForSavedHighlight(
      highlight({
        selectionText: "重复",
        prefix: "中间改写。",
        suffix: "。后文。",
        pageIndex: 0,
        positionStart: 3,
        positionEnd: 5,
        rects: [{ pageIndex: 0, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }],
      }),
      [{ pageIndex: 0, text: "前缀。重复。中间改写。重复。后文。", markdown: "" }],
      1,
    )

    expect(restored).toMatchObject({
      pageIndex: 0,
      selectionRects: [],
      selectionAnchor: {
        pageIndex: 0,
        positionStart: 11,
        positionEnd: 13,
      },
      strategy: "quote",
    })
  })

  it("searches other converted pages before falling back to stale geometry", () => {
    const restored = restoreTargetForSavedHighlight(
      highlight({
        selectionText: "目标文本",
        pageIndex: 0,
        rects: [{ pageIndex: 0, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }],
      }),
      [
        { pageIndex: 0, text: "第一页没有了", markdown: "" },
        { pageIndex: 2, text: "第三页包含目标文本。", markdown: "" },
      ],
      1,
    )

    expect(restored).toMatchObject({
      pageIndex: 2,
      selectionRects: [],
      selectionAnchor: {
        pageIndex: 2,
        positionStart: 5,
        positionEnd: 9,
      },
      strategy: "quote",
    })
  })

  it("falls back to geometry when the quote cannot be resolved", () => {
    const rect = { pageIndex: 4, x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.4 }
    const restored = restoreTargetForSavedHighlight(
      highlight({
        selectionText: "消失文本",
        pageIndex: 0,
        rects: [rect],
      }),
      [{ pageIndex: 0, text: "另一段内容", markdown: "" }],
      1,
    )

    expect(restored).toMatchObject({
      pageIndex: 4,
      selectionRects: [rect],
      selectionAnchor: null,
      strategy: "geometry",
    })
  })
})

function highlight(overrides: Partial<SavedHighlight>): SavedHighlight {
  return {
    id: "highlight-1",
    bookId: "book-1",
    selectionText: "目标文本",
    prefix: "",
    suffix: "",
    pageIndex: null,
    positionStart: null,
    positionEnd: null,
    rects: [],
    interpretation: null,
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  }
}
