import type { ParsedChunk } from "@/stores/reader-store"

export function pageIndexForActiveChunk(
  activeChunkId: string,
  chunksByPage: Map<number, ParsedChunk[]>,
) {
  if (!activeChunkId) {
    return null
  }
  for (const [pageIndex, chunks] of chunksByPage) {
    if (chunks.some((chunk) => chunk.chunkId === activeChunkId)) {
      return pageIndex
    }
  }
  return null
}
