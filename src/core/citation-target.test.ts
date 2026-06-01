import { describe, expect, it, vi } from "vitest"
import { resolveCitationTarget } from "./citation-target"
import type { ParsedChunk } from "@/stores/reader-store"

describe("resolveCitationTarget", () => {
  it("uses a local parsed chunk when available", async () => {
    const chunk = parsedChunk({ chunkId: "p3-c2", pageIndex: 2 })

    await expect(
      resolveCitationTarget({
        chunkId: "p3-c2",
        bookId: "book-1",
        parsedChunks: [chunk],
        evidence: [],
        loadChunk: vi.fn(),
      }),
    ).resolves.toEqual({
      kind: "chunk",
      pageNumber: 3,
      chunk,
    })
  })

  it("loads an indexed chunk from the backend when it is missing locally", async () => {
    const chunk = parsedChunk({ chunkId: "indexed-only", pageIndex: 8 })

    await expect(
      resolveCitationTarget({
        chunkId: "indexed-only",
        bookId: "book-1",
        parsedChunks: [],
        evidence: [{ chunkId: "indexed-only", title: "Chunk indexed-only", pageIndex: 8 }],
        loadChunk: async () => chunk,
      }),
    ).resolves.toEqual({
      kind: "chunk",
      pageNumber: 9,
      chunk,
    })
  })

  it("falls back to evidence page navigation when backend chunk lookup fails", async () => {
    await expect(
      resolveCitationTarget({
        chunkId: "evidence-only",
        bookId: "book-1",
        parsedChunks: [],
        evidence: [{ chunkId: "evidence-only", title: "Chunk evidence-only", pageIndex: 4 }],
        loadChunk: async () => {
          throw new Error("backend unavailable")
        },
      }),
    ).resolves.toEqual({
      kind: "page",
      pageNumber: 5,
      chunkId: "evidence-only",
    })
  })
})

function parsedChunk(overrides: Partial<ParsedChunk>): ParsedChunk {
  return {
    chunkId: "p1-c1",
    pageIndex: 0,
    text: "chunk text",
    markdown: "chunk text",
    rects: [],
    ...overrides,
  }
}
