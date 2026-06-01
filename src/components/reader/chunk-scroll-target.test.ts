import { describe, expect, it } from "vitest"
import { pageIndexForActiveChunk } from "./chunk-scroll-target"

describe("pageIndexForActiveChunk", () => {
  it("finds the explicit page that contains the active chunk", () => {
    const chunksByPage = new Map([
      [0, [{ chunkId: "p1-c1", pageIndex: 0, text: "第一页", markdown: "", rects: [] }]],
      [4, [{ chunkId: "p5-c2", pageIndex: 4, text: "第五页", markdown: "", rects: [] }]],
    ])

    expect(pageIndexForActiveChunk("p5-c2", chunksByPage)).toBe(4)
  })

  it("returns null when the active chunk is missing", () => {
    expect(pageIndexForActiveChunk("missing", new Map())).toBeNull()
    expect(
      pageIndexForActiveChunk(
        "",
        new Map([[0, [{ chunkId: "p1-c1", pageIndex: 0, text: "第一页", markdown: "", rects: [] }]]]),
      ),
    ).toBeNull()
  })
})
