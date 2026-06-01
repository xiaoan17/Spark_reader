import type { EvidencePreview, ParsedChunk } from "@/stores/reader-store"

export type CitationTarget =
  | {
      kind: "chunk"
      pageNumber: number
      chunk: ParsedChunk
    }
  | {
      kind: "page"
      pageNumber: number
      chunkId: string
    }

export type ResolveCitationTargetOptions = {
  chunkId: string
  bookId: string
  parsedChunks: ParsedChunk[]
  evidence: EvidencePreview[]
  loadChunk?: (bookId: string, chunkId: string) => Promise<ParsedChunk | null>
}

export async function resolveCitationTarget({
  chunkId,
  bookId,
  parsedChunks,
  evidence,
  loadChunk,
}: ResolveCitationTargetOptions): Promise<CitationTarget | null> {
  const localChunk = parsedChunks.find((item) => item.chunkId === chunkId)
  if (localChunk) {
    return chunkTarget(localChunk)
  }

  if (bookId && loadChunk) {
    try {
      const loadedChunk = await loadChunk(bookId, chunkId)
      if (loadedChunk) {
        return chunkTarget(loadedChunk)
      }
    } catch {
      // Fall back to the page-level evidence preview below.
    }
  }

  const evidenceItem = evidence.find((item) => item.chunkId === chunkId)
  if (evidenceItem) {
    return {
      kind: "page",
      pageNumber: evidenceItem.pageIndex + 1,
      chunkId,
    }
  }

  return null
}

function chunkTarget(chunk: ParsedChunk): CitationTarget {
  return {
    kind: "chunk",
    pageNumber: chunk.pageIndex + 1,
    chunk,
  }
}
