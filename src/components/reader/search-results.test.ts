import { describe, expect, it } from "vitest"
import { readerChunkSearchResults } from "./search-results"
import type { SearchBookHit } from "@/core/library-api"

const staleBackendHit: SearchBookHit = {
  chunkId: "old-c1",
  pageIndex: 0,
  text: "旧查询结果",
  markdown: "",
  rects: [],
  snippet: "旧查询",
  score: 10,
}

const freshLocalResult = {
  chunk: { chunkId: "new-c1", pageIndex: 1, text: "新查询本地结果", markdown: "", rects: [] },
  score: 1,
  snippet: "",
}

describe("readerChunkSearchResults", () => {
  it("keeps stale backend hits hidden while a new search is running", () => {
    expect(
      readerChunkSearchResults({
        backendHits: [staleBackendHit],
        localResults: [freshLocalResult],
        searchStatus: "searching",
      }).map((result) => result.chunk.chunkId),
    ).toEqual(["new-c1"])
  })

  it("uses local results when backend search falls back", () => {
    expect(
      readerChunkSearchResults({
        backendHits: [staleBackendHit],
        localResults: [freshLocalResult],
        searchStatus: "fallback",
      }).map((result) => result.chunk.chunkId),
    ).toEqual(["new-c1"])
  })

  it("uses backend hits after a completed indexed search", () => {
    expect(
      readerChunkSearchResults({
        backendHits: [staleBackendHit],
        localResults: [freshLocalResult],
        searchStatus: "idle",
      }).map((result) => result.chunk.chunkId),
    ).toEqual(["old-c1"])
  })
})
