import { describe, expect, it } from "vitest"
import { orderLocalFallbackChunks } from "./local-fallback-chunks"
import type { ParsedChunk } from "@/stores/reader-store"

const parsedChunks: ParsedChunk[] = [
  { chunkId: "p1-c1", pageIndex: 0, text: "开头", markdown: "", rects: [] },
  { chunkId: "p1-c2", pageIndex: 0, text: "中间", markdown: "", rects: [] },
  { chunkId: "p1-c3", pageIndex: 0, text: "用户真正选中的段落", markdown: "", rects: [] },
]

describe("orderLocalFallbackChunks", () => {
  it("moves focused parsed chunks to the front for local interpretation evidence", () => {
    const ordered = orderLocalFallbackChunks({
      focusChunkIds: ["p1-c3"],
      indexedChunks: [],
      parsedChunks,
    })

    expect(ordered.map((chunk) => chunk.chunkId)).toEqual(["p1-c3", "p1-c1", "p1-c2"])
  })

  it("keeps indexed search context while preserving focused chunks", () => {
    const ordered = orderLocalFallbackChunks({
      focusChunkIds: ["p1-c3"],
      indexedChunks: [
        { chunkId: "p9-c1", pageIndex: 8, text: "全书检索命中", markdown: "", rects: [] },
        { chunkId: "p1-c1", pageIndex: 0, text: "本页开头", markdown: "", rects: [] },
      ],
      parsedChunks,
    })

    expect(ordered.map((chunk) => chunk.chunkId)).toEqual(["p1-c3", "p9-c1", "p1-c1"])
  })

  it("keeps the existing source order when there is no focused chunk", () => {
    const indexedChunks = [
      { chunkId: "p2-c1", pageIndex: 1, text: "搜索命中 A", markdown: "", rects: [] },
      { chunkId: "p4-c1", pageIndex: 3, text: "搜索命中 B", markdown: "", rects: [] },
    ]

    expect(
      orderLocalFallbackChunks({
        focusChunkIds: [],
        indexedChunks,
        parsedChunks,
      }),
    ).toBe(indexedChunks)
  })
})
