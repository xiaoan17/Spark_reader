import { searchBook, type SearchBookHit } from "@/core/library-api"
import {
  evidenceSnapshotsForChunkIds as evidenceSnapshotsForChunkIdsCore,
  focusChunkIds as focusChunkIdsCore,
  focusPageIndexes as focusPageIndexesCore,
  localFallbackChunks as localFallbackChunksCore,
  type CurrentThreadFocus,
} from "@/core/interpretation-focus"
import { useReaderStore, type ParsedChunk } from "@/stores/reader-store"

/**
 * 聚焦选区基础设施：把当前 Spark 线程/裸选区从 store 组装成 CurrentThreadFocus，
 * 并提供聚焦页码 / 聚焦 chunk / 证据快照 / 本地兜底排序等派生。纯计算委托给
 * core/interpretation-focus，这里只负责绑定 store 快照。被解读域和高亮域共用。
 */
export function useReaderFocus() {
  const {
    selectionText,
    selectionRects,
    selectionAnchor,
    currentThreadSelectionText,
    currentThreadSelectionRects,
    currentThreadSelectionAnchor,
    currentThreadPageIndex,
    currentPage,
    bookId,
    libraryStatus,
    parsedChunks,
    parsedPages,
  } = useReaderStore()

  function currentThreadFocus(): CurrentThreadFocus {
    const text = (currentThreadSelectionText || selectionText).trim()
    const rects =
      currentThreadSelectionText.trim().length > 0
        ? currentThreadSelectionRects
        : selectionRects
    const anchor =
      currentThreadSelectionText.trim().length > 0
        ? currentThreadSelectionAnchor
        : selectionAnchor
    const pageIndex =
      currentThreadPageIndex ??
      anchor?.pageIndex ??
      rects[0]?.pageIndex ??
      Math.max(0, currentPage - 1)
    return {
      text,
      rects,
      anchor,
      pageIndex,
    }
  }

  async function findEvidenceChunks(): Promise<SearchBookHit[]> {
    const focus = currentThreadFocus().text
    if (!bookId || libraryStatus !== "indexed" || !focus) {
      return []
    }

    try {
      return await searchBook(bookId, focus.slice(0, 120), 6)
    } catch {
      return []
    }
  }

  function focusPageIndexes() {
    return focusPageIndexesCore(currentThreadFocus(), currentPage)
  }

  function focusChunkIds() {
    return focusChunkIdsCore(currentThreadFocus(), currentPage, parsedChunks, parsedPages)
  }

  function evidenceSnapshotsForChunkIds(chunkIds: string[]) {
    return evidenceSnapshotsForChunkIdsCore(chunkIds, parsedChunks)
  }

  function localFallbackChunks(indexedChunks: ParsedChunk[]) {
    return localFallbackChunksCore(indexedChunks, focusChunkIds(), parsedChunks)
  }

  return {
    currentThreadFocus,
    findEvidenceChunks,
    focusPageIndexes,
    focusChunkIds,
    evidenceSnapshotsForChunkIds,
    localFallbackChunks,
  }
}

export type ReaderFocus = ReturnType<typeof useReaderFocus>
