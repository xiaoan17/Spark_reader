import type { ParsedChunk } from "@/stores/reader-store"

export function orderLocalFallbackChunks({
  focusChunkIds,
  indexedChunks,
  parsedChunks,
}: {
  focusChunkIds: string[]
  indexedChunks: ParsedChunk[]
  parsedChunks: ParsedChunk[]
}) {
  if (focusChunkIds.length === 0) {
    return indexedChunks.length > 0 ? indexedChunks : parsedChunks
  }

  const chunksById = new Map<string, ParsedChunk>()
  for (const chunk of parsedChunks) {
    chunksById.set(chunk.chunkId, chunk)
  }
  for (const chunk of indexedChunks) {
    chunksById.set(chunk.chunkId, chunk)
  }

  const ordered: ParsedChunk[] = []
  const seen = new Set<string>()
  for (const chunkId of focusChunkIds) {
    const chunk = chunksById.get(chunkId)
    if (chunk && !seen.has(chunk.chunkId)) {
      ordered.push(chunk)
      seen.add(chunk.chunkId)
    }
  }

  const remaining = indexedChunks.length > 0 ? indexedChunks : parsedChunks
  for (const chunk of remaining) {
    if (!seen.has(chunk.chunkId)) {
      ordered.push(chunk)
      seen.add(chunk.chunkId)
    }
  }

  return ordered
}
