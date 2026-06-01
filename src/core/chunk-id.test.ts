import { describe, expect, it } from "vitest"
import {
  isLegacyChunkId,
  isNamespacedChunkId,
  makeChunkId,
  normalizeParsedChunkIds,
} from "./chunk-id"

describe("chunk id helpers", () => {
  it("creates namespaced chunk ids and rejects legacy ids for citations", () => {
    const chunkId = makeChunkId("book-123", 2, 4, "复利 来自 时间")

    expect(chunkId).toBe("b88a20f70-p3-c5-2a84c8da")
    expect(chunkId).toMatch(/^b[0-9a-f]{8}-p3-c5-[0-9a-f]{8}$/)
    expect(isNamespacedChunkId(chunkId)).toBe(true)
    expect(isNamespacedChunkId("p3-c5")).toBe(false)
    expect(isLegacyChunkId("p3-c5")).toBe(true)
  })

  it("normalizes legacy parsed chunks and rewrites markdown headings", () => {
    const chunks = normalizeParsedChunkIds("book-1", [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "第一段",
        markdown: "### [p1-c1] Page 1\n\n第一段",
      },
    ])

    expect(chunks[0].chunkId).toMatch(/^b[0-9a-f]{8}-p1-c1-[0-9a-f]{8}$/)
    expect(chunks[0].markdown).toContain(`[${chunks[0].chunkId}]`)
    expect(chunks[0].markdown).not.toContain("[p1-c1]")
  })
})
