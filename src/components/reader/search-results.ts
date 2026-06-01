import type { ParsedChunk } from "@/stores/reader-store"
import type { SearchBookHit } from "@/core/library-api"
import { searchHitToChunk } from "@/core/library-api"

export type ReaderChunkSearchResult = {
  chunk: ParsedChunk
  score: number
  snippet: string
}

export function readerChunkSearchResults({
  backendHits,
  localResults,
  searchStatus,
}: {
  backendHits: SearchBookHit[]
  localResults: ReaderChunkSearchResult[]
  searchStatus: "idle" | "searching" | "fallback"
}) {
  if (searchStatus === "searching" || searchStatus === "fallback") {
    return localResults
  }
  const indexedResults = backendHits.map((hit) => ({
    chunk: searchHitToChunk(hit),
    score: Math.abs(hit.score),
    snippet: hit.snippet,
  }))
  return indexedResults.length > 0 ? indexedResults : localResults
}
