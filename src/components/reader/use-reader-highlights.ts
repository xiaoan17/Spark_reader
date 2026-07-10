import {
  deleteHighlight,
  deleteInterpretation,
  getChunk,
  isTauriRuntime,
  listHighlights,
  listInterpretations,
  saveHighlight,
  searchHitToChunk,
} from "@/core/library-api"
import {
  browserLibraryAvailable,
  deleteBrowserHighlight,
  deleteBrowserInterpretation,
  listBrowserHighlights,
  listBrowserInterpretations,
  saveBrowserHighlight,
} from "@/core/browser-library"
import { makeTextQuoteSelector } from "@/core/text-quote-selector"
import { pageTextByIndex } from "@/core/page-lookup"
import { primaryPageIndexForSelection } from "@/core/selection-pages"
import {
  lightweightFromSavedInterpretation,
  restoreTargetForSavedInterpretation,
} from "@/core/interpretation-history"
import { restoreTargetForSavedHighlight } from "@/core/highlight-restore"
import { resolveCitationTarget } from "@/core/citation-target"
import {
  useReaderStore,
  type SavedHighlight,
  type SavedInterpretation,
} from "@/stores/reader-store"
import type { ReaderRequestLifecycle } from "./use-reader-request-lifecycle"
import type { ReaderFocus } from "./use-reader-focus"

type UseReaderHighlightsDeps = {
  stopActiveRequest: ReaderRequestLifecycle["stopActiveRequest"]
  focus: ReaderFocus
  refreshKnowledge: (bookIdToLoad: string) => void
}

/**
 * 高亮与解读历史：保存/打开/删除高亮，打开解读或 Spark 解读、引用回跳，以及
 * 高亮/解读历史的加载。回跳统一落在转换文本视图，PDF 只作几何/校准视图。
 */
export function useReaderHighlights({ stopActiveRequest, focus, refreshKnowledge }: UseReaderHighlightsDeps) {
  const {
    bookId,
    selectionText,
    selectionRects,
    selectionAnchor,
    interpretation,
    currentPage,
    parsedPages,
    parsedChunks,
    evidence,
    interpretationHistory,
    setCurrentPage,
    setSelection,
    setInterpretation,
    setPhase,
    focusChunk,
    setVisiblePage,
    setActiveChunk,
    setCurrentThreadSelection,
    setEvidence,
    setAgentTrace,
    setAnswerSource,
    setFollowUps,
    setActiveInterpretationSessionId,
    setCurrentThreadLightweight,
    setCurrentThreadError,
    setWorkbenchTab,
    addHighlight,
    removeHighlight,
    removeInterpretationHistory,
    setHighlights,
    setInterpretationHistory,
  } = useReaderStore()

  async function handleSaveHighlight() {
    if (!bookId || selectionText.trim().length === 0) {
      return false
    }

    try {
      const pageIndex = primaryPageIndexForSelection({ selectionRects, selectionAnchor, currentPage })
      if (pageIndex === null) {
        return false
      }
      const preferredPositionStart =
        selectionAnchor?.pageIndex === pageIndex ? selectionAnchor.positionStart : null
      const selector = makeTextQuoteSelector(
        pageTextByIndex(parsedPages, pageIndex),
        selectionText,
        preferredPositionStart,
      )
      const evidenceChunkIds = focus.focusChunkIds()
      const request = {
        bookId,
        selectionText,
        prefix: selector.prefix,
        suffix: selector.suffix,
        pageIndex,
        positionStart: selector.positionStart,
        positionEnd: selector.positionEnd,
        rects: selectionRects,
        interpretation: interpretation || null,
        evidenceChunkIds,
        evidenceChunkSnapshots: focus.evidenceSnapshotsForChunkIds(evidenceChunkIds),
      }
      const highlight = isTauriRuntime()
        ? await saveHighlight(request)
        : browserLibraryAvailable()
          ? await saveBrowserHighlight(request)
          : null
      if (!highlight) {
        return false
      }
      addHighlight(highlight)
      if (isTauriRuntime()) {
        refreshKnowledge(bookId)
      }
      return true
    } catch {
      // Browser-only dev mode cannot persist through Tauri. Keep current UI stable.
      return false
    }
  }

  function handleOpenHighlight(highlight: SavedHighlight) {
    stopActiveRequest()
    const restored = restoreTargetForSavedHighlight(highlight, parsedPages, currentPage)
    setCurrentPage(restored.pageIndex + 1)
    setSelection(
      restored.selectionText,
      restored.selectionRects,
      restored.selectionAnchor,
    )
    if (restored.interpretation) {
      setInterpretation(restored.interpretation)
    }
    setPhase("reading")
  }

  async function handleCitationClick(chunkId: string) {
    stopActiveRequest()
    const target = await resolveCitationTarget({
      chunkId,
      bookId,
      parsedChunks,
      evidence,
      loadChunk: isTauriRuntime()
        ? async (targetBookId, targetChunkId) => {
            const hit = await getChunk(targetBookId, targetChunkId)
            return hit ? searchHitToChunk(hit) : null
          }
        : undefined,
    })
    if (!target) {
      return
    }

    // Citation jumps land in the converted text view; PDF is only a geometry/calibration view.
    if (target.kind === "chunk") {
      focusChunk(
        target.pageNumber,
        target.chunk.chunkId,
        target.chunk.text,
        target.chunk.rects,
        true,
      )
    } else {
      setVisiblePage(target.pageNumber)
      setActiveChunk(target.chunkId)
    }
  }

  function handleOpenInterpretation(item: SavedInterpretation) {
    stopActiveRequest()
    const restored = restoreTargetForSavedInterpretation(
      item,
      parsedChunks,
      parsedPages,
      interpretationHistory,
    )
    focusChunk(
      restored.pageNumber,
      restored.activeChunkId,
      restored.selectionText,
      restored.selectionRects,
      true,
    )
    setCurrentThreadSelection(
      restored.selectionText,
      restored.selectionRects,
      restored.selectionAnchor,
      restored.pageNumber - 1,
    )
    setActiveChunk(restored.activeChunkId)
    setEvidence(restored.evidence)
    // Restore the saved retrieval trace so reopening history shows the same
    // 检索过程 panel; legacy/local-fallback rows have none.
    setAgentTrace(item.trace ?? [])
    setInterpretation(restored.interpretation)
    setAnswerSource(item.answerSource ?? "llm")
    setFollowUps(restored.followUps)
    setActiveInterpretationSessionId(item.sessionId || item.id)
    // 优先用 mode 恢复轻重（plain=轻量）；旧记录无 mode 时回退到 kind==="spark"。
    setCurrentThreadLightweight(lightweightFromSavedInterpretation(item))
    setCurrentThreadError("")
    setWorkbenchTab("spark")
    setPhase("reading")
  }

  function handleOpenSparkInterpretation(item: SavedInterpretation, sourceView?: "text" | "translation" | "pdf" | "tldr") {
    const restored = restoreTargetForSavedInterpretation(
      item,
      parsedChunks,
      parsedPages,
      interpretationHistory,
    )
    if (sourceView === "translation") {
      setVisiblePage(restored.pageNumber)
      setCurrentThreadSelection(
        restored.selectionText,
        restored.selectionRects,
        restored.selectionAnchor,
        restored.pageNumber - 1,
      )
      setActiveChunk(restored.activeChunkId)
      setEvidence(restored.evidence)
      setAgentTrace(item.trace ?? [])
      setInterpretation(restored.interpretation)
      setAnswerSource(item.answerSource ?? "llm")
      setFollowUps(restored.followUps)
      setPhase("reading")
    } else {
      handleOpenInterpretation(item)
    }
    setActiveInterpretationSessionId(item.sessionId || item.id)
    // 优先用 mode 恢复轻重（plain=轻量）；旧记录无 mode 时回退到 kind==="spark"。
    setCurrentThreadLightweight(lightweightFromSavedInterpretation(item))
    setCurrentThreadError("")
    setWorkbenchTab("spark")
  }

  async function handleDeleteHighlight(highlightId: string) {
    removeHighlight(highlightId)
    try {
      if (isTauriRuntime()) {
        await deleteHighlight(highlightId)
      } else if (browserLibraryAvailable()) {
        await deleteBrowserHighlight(highlightId)
      }
      if (bookId && isTauriRuntime()) {
        refreshKnowledge(bookId)
      }
    } catch {
      // Ignore browser fallback failures; local state already reflects the user action.
    }
  }

  async function handleDeleteInterpretation(interpretationId: string) {
    removeInterpretationHistory(interpretationId)
    try {
      if (isTauriRuntime()) {
        await deleteInterpretation(interpretationId)
      } else if (browserLibraryAvailable()) {
        await deleteBrowserInterpretation(interpretationId)
      }
      if (bookId && isTauriRuntime()) {
        refreshKnowledge(bookId)
      }
    } catch {
      // Ignore browser fallback failures; local state already reflects the user action.
    }
  }

  async function loadHighlights(bookIdToLoad: string) {
    try {
      const rows = isTauriRuntime()
        ? await listHighlights(bookIdToLoad)
        : browserLibraryAvailable()
          ? await listBrowserHighlights(bookIdToLoad)
          : []
      setHighlights(rows)
    } catch {
      setHighlights([])
    }
  }

  async function loadInterpretationHistory(bookIdToLoad: string) {
    try {
      const rows = isTauriRuntime()
        ? await listInterpretations(bookIdToLoad)
        : browserLibraryAvailable()
          ? await listBrowserInterpretations(bookIdToLoad)
          : []
      setInterpretationHistory(rows)
    } catch {
      setInterpretationHistory([])
    }
  }

  return {
    handleSaveHighlight,
    handleOpenHighlight,
    handleCitationClick,
    handleOpenInterpretation,
    handleOpenSparkInterpretation,
    handleDeleteHighlight,
    handleDeleteInterpretation,
    loadHighlights,
    loadInterpretationHistory,
  }
}

export type ReaderHighlights = ReturnType<typeof useReaderHighlights>
