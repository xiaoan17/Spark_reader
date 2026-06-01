import { describe, expect, it } from "vitest"
import { focusChunkIdsForSelection } from "./selection-chunks"

describe("focusChunkIdsForSelection", () => {
  it("prefers the chunk containing the exact selected text on the active page", () => {
    expect(
      focusChunkIdsForSelection({
        selectionText: "现金流和耐心",
        selectionRects: [],
        selectionAnchor: { pageIndex: 0, positionStart: 16, positionEnd: 22 },
        currentPage: 1,
        chunks: [
          { chunkId: "p1-c1", pageIndex: 0, text: "复利来自时间。", markdown: "", rects: [] },
          {
            chunkId: "p1-c2",
            pageIndex: 0,
            text: "长期收益依赖现金流和耐心。",
            markdown: "",
            rects: [],
          },
          { chunkId: "p2-c1", pageIndex: 1, text: "现金流在下一页重复。", markdown: "", rects: [] },
        ],
      }),
    ).toEqual(["p1-c2"])
  })

  it("uses PDF/text geometry overlap when exact text is unavailable", () => {
    expect(
      focusChunkIdsForSelection({
        selectionText: "难以直接匹配的 OCR 文本",
        selectionRects: [{ pageIndex: 0, x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 }],
        selectionAnchor: null,
        currentPage: 1,
        chunks: [
          {
            chunkId: "p1-c1",
            pageIndex: 0,
            text: "左侧块",
            markdown: "",
            rects: [{ pageIndex: 0, x0: 0.08, y0: 0.18, x1: 0.55, y1: 0.32 }],
          },
          {
            chunkId: "p1-c2",
            pageIndex: 0,
            text: "右侧块",
            markdown: "",
            rects: [{ pageIndex: 0, x0: 0.7, y0: 0.18, x1: 0.9, y1: 0.32 }],
          },
        ],
      }),
    ).toEqual(["p1-c1"])
  })

  it("uses text anchors to disambiguate repeated text on the same page", () => {
    expect(
      focusChunkIdsForSelection({
        selectionText: "重复概念",
        selectionRects: [],
        selectionAnchor: { pageIndex: 0, positionStart: 15, positionEnd: 19 },
        currentPage: 1,
        pages: [
          {
            pageIndex: 0,
            text: "重复概念在开头。\n\n中间解释。\n\n重复概念在结尾，真正被选中。",
            markdown: "",
          },
        ],
        chunks: [
          { chunkId: "p1-c1", pageIndex: 0, text: "重复概念在开头。", markdown: "", rects: [] },
          { chunkId: "p1-c2", pageIndex: 0, text: "中间解释。", markdown: "", rects: [] },
          {
            chunkId: "p1-c3",
            pageIndex: 0,
            text: "重复概念在结尾，真正被选中。",
            markdown: "",
            rects: [],
          },
        ],
      }),
    ).toEqual(["p1-c3", "p1-c1"])
  })

  it("keeps cross-page geometry hits from both selected pages in stable order", () => {
    expect(
      focusChunkIdsForSelection({
        selectionText: "跨页概念",
        selectionRects: [
          { pageIndex: 0, x0: 0.1, y0: 0.8, x1: 0.9, y1: 0.95 },
          { pageIndex: 1, x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.2 },
        ],
        selectionAnchor: null,
        currentPage: 1,
        chunks: [
          {
            chunkId: "p1-c1",
            pageIndex: 0,
            text: "跨页概念的前半段",
            markdown: "",
            rects: [{ pageIndex: 0, x0: 0.1, y0: 0.78, x1: 0.9, y1: 0.96 }],
          },
          {
            chunkId: "p2-c1",
            pageIndex: 1,
            text: "跨页概念的后半段",
            markdown: "",
            rects: [{ pageIndex: 1, x0: 0.1, y0: 0.04, x1: 0.9, y1: 0.21 }],
          },
          {
            chunkId: "p3-c1",
            pageIndex: 2,
            text: "跨页概念但不在选区页",
            markdown: "",
            rects: [{ pageIndex: 2, x0: 0.1, y0: 0.04, x1: 0.9, y1: 0.21 }],
          },
        ],
      }),
    ).toEqual(["p1-c1", "p2-c1"])
  })

  it("does not let a wrong-page exact match outrank the anchor page", () => {
    expect(
      focusChunkIdsForSelection({
        selectionText: "同一句话",
        selectionRects: [],
        selectionAnchor: { pageIndex: 2, positionStart: 0, positionEnd: 4 },
        currentPage: 1,
        chunks: [
          { chunkId: "p1-c1", pageIndex: 0, text: "同一句话在第一页。", markdown: "", rects: [] },
          { chunkId: "p3-c1", pageIndex: 2, text: "同一句话在第三页。", markdown: "", rects: [] },
        ],
      }),
    ).toEqual(["p3-c1"])
  })
})
