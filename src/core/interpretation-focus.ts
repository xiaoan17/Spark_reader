import { focusChunkIdsForSelection } from "@/core/selection-chunks"
import { focusPageIndexesForSelection } from "@/core/selection-pages"
import { orderLocalFallbackChunks } from "@/core/local-fallback-chunks"
import {
  chunkContentHash,
  isLegacyChunkId,
  isNamespacedChunkId,
} from "@/core/chunk-id"
import type { NormalizedPageRect } from "@/core/coordinates"
import type {
  ParsedChunk,
  ParsedPage,
  TextSelectionAnchor,
} from "@/stores/reader-store"

/**
 * 当前 Spark 线程聚焦的选区快照：文本、命中矩形、锚点、主页码。
 * 由 useReaderFocus 从 store 组装后传入下列纯函数。
 */
export type CurrentThreadFocus = {
  text: string
  rects: NormalizedPageRect[]
  anchor: TextSelectionAnchor | null
  pageIndex: number
}

export function focusPageIndexes(focus: CurrentThreadFocus, currentPage: number) {
  return focusPageIndexesForSelection({
    selectionRects: focus.rects,
    selectionAnchor: focus.anchor,
    currentPage,
  })
}

export function focusChunkIds(
  focus: CurrentThreadFocus,
  currentPage: number,
  parsedChunks: ParsedChunk[],
  parsedPages: ParsedPage[],
) {
  return focusChunkIdsForSelection({
    selectionText: focus.text,
    selectionRects: focus.rects,
    selectionAnchor: focus.anchor,
    currentPage,
    chunks: parsedChunks,
    pages: parsedPages,
  })
}

export function evidenceSnapshotsForChunkIds(chunkIds: string[], parsedChunks: ParsedChunk[]) {
  return chunkIds.map((chunkId) => {
    const chunk = parsedChunks.find((candidate) => candidate.chunkId === chunkId)
    return {
      chunkId,
      chunkIdVersion: isNamespacedChunkId(chunkId) ? 2 : isLegacyChunkId(chunkId) ? 1 : 0,
      contentHash: chunk ? chunkContentHash(chunk.text) : null,
    }
  })
}

export function localFallbackChunks(
  indexedChunks: ParsedChunk[],
  focusChunkIdList: string[],
  parsedChunks: ParsedChunk[],
) {
  return orderLocalFallbackChunks({
    focusChunkIds: focusChunkIdList,
    indexedChunks,
    parsedChunks,
  })
}
