import { useRef } from "react"
import { ReaderShell } from "@/components/reader/ReaderShell"
import { useReaderStore } from "@/stores/reader-store"
import {
  cancelInterpretation,
  deleteHighlight,
  deleteInterpretation,
  getChunk,
  interpretSelection,
  isTauriRuntime,
  listenInterpretationStream,
  listHighlights,
  listInterpretations,
  saveHighlight,
  saveInterpretation,
  searchBook,
  searchHitToChunk,
  type InterpretEvidenceItem,
  type AnswerSource,
  type SearchBookHit,
} from "@/core/library-api"
import {
  browserLibraryAvailable,
  deleteBrowserHighlight,
  deleteBrowserInterpretation,
  listBrowserHighlights,
  listBrowserInterpretations,
  saveBrowserHighlight,
  saveBrowserInterpretation,
} from "@/core/browser-library"
import {
  makeLocalEvidence,
  makeLocalFollowUpAnswer,
  makeLocalInterpretation,
} from "@/core/local-interpreter"
import { makeTextQuoteSelector } from "@/core/text-quote-selector"
import { createRequestGuard } from "@/core/async-request-guard"
import { focusChunkIdsForSelection } from "@/core/selection-chunks"
import { focusPageIndexesForSelection, primaryPageIndexForSelection } from "@/core/selection-pages"
import { inferTextSelectionAnchor } from "@/core/selection-anchor"
import { pageTextByIndex } from "@/core/page-lookup"
import {
  restoreTargetForSavedInterpretation,
  summarizeInterpretationSessions,
} from "@/core/interpretation-history"
import { restoreTargetForSavedHighlight } from "@/core/highlight-restore"
import {
  makeInterpretationSessionId,
  planInterpretationTurn,
} from "@/core/interpretation-session"
import { shouldUseBackendInterpretation } from "@/core/interpretation-runtime"
import { orderLocalFallbackChunks } from "@/core/local-fallback-chunks"
import { resolveCitationTarget } from "@/core/citation-target"
import type {
  EvidencePreview,
  ParsedChunk,
  SavedInterpretation,
  TextSelectionAnchor,
} from "@/stores/reader-store"

export function App() {
  const timers = useRef<number[]>([])
  const requestGuard = useRef(createRequestGuard())
  const streamUnlisten = useRef<(() => void) | null>(null)
  const activeInterpretationRequestId = useRef<string>("")
  const {
    phase,
    bookId,
    libraryStatus,
    libraryMessage,
    bookTitle,
    currentPage,
    totalPages,
    selectionText,
    selectionRects,
    selectionAnchor,
    evidence,
    agentTrace,
    interpretation,
    answerSource,
    interpretationError,
    followUps,
    highlights,
    interpretationHistory,
    parsedPages,
    parsedChunks,
    parserEngine,
    coordinateMode,
    activeChunkId,
    textQuality,
    zoom,
    setBook,
    setCurrentPage,
    setZoom,
    setSelection,
    setPhase,
    setLibraryStatus,
    setVisiblePage,
    setEvidence,
    setAgentTrace,
    setInterpretation,
    setAnswerSource,
    setInterpretationError,
    setInterpretationSessionId,
    setHighlights,
    setInterpretationHistory,
    setFollowUps,
    addHighlight,
    addInterpretationHistory,
    removeHighlight,
    removeInterpretationHistory,
    addFollowUp,
    clearSelection,
    clearInterpretation,
    setActiveChunk,
    focusChunk,
    setParsedDocument,
  } = useReaderStore()

  function clearTimers() {
    for (const timer of timers.current) {
      window.clearTimeout(timer)
    }
    timers.current = []
  }

  function schedule(callback: () => void, delay: number) {
    const timer = window.setTimeout(callback, delay)
    timers.current.push(timer)
  }

  function startRequest() {
    return requestGuard.current.start()
  }

  function isCurrentRequest(version: number) {
    return requestGuard.current.isCurrent(version)
  }

  function stopActiveRequest() {
    const requestId = activeInterpretationRequestId.current
    if (requestId) {
      void cancelInterpretation(requestId).catch(() => undefined)
    }
    requestGuard.current.stop()
    clearTimers()
    clearStreamListener()
    activeInterpretationRequestId.current = ""
  }

  function clearStreamListener() {
    streamUnlisten.current?.()
    streamUnlisten.current = null
  }

  async function findEvidenceChunks(): Promise<SearchBookHit[]> {
    const focus = selectionText.trim()
    if (!bookId || libraryStatus !== "indexed" || !focus) {
      return []
    }

    try {
      return await searchBook(bookId, focus.slice(0, 120), 6)
    } catch {
      return []
    }
  }

  function runLocalInterpretation(mode: "deep" | "plain" = "deep") {
    if (!selectionText.trim()) {
      return
    }

    const version = startRequest()
    clearTimers()
    clearInterpretation()
    setPhase("planning")
    schedule(() => {
      void runBackendInterpretation(mode, version)
    }, 300)
  }

  function makeRequestId(version: number) {
    return `interpret-${Date.now()}-${version}-${Math.random().toString(36).slice(2)}`
  }

  function previewEvidence(items: InterpretEvidenceItem[]): EvidencePreview[] {
    return items.map((item) => ({
      chunkId: item.chunkId,
      title: item.title,
      pageIndex: item.pageIndex,
    }))
  }

  async function attachInterpretationStream(
    requestId: string,
    version: number,
    question?: string,
    followUpId?: string,
  ) {
    clearStreamListener()
    streamUnlisten.current = await listenInterpretationStream((event) => {
      if (event.requestId !== requestId || !isCurrentRequest(version)) {
        return
      }
      if (event.stage === "planning") {
        setPhase("planning")
      }
      if (event.stage === "retrieving") {
        setPhase("retrieving")
      }
      if (event.stage === "synthesizing") {
        setPhase("streaming")
        if (!question) {
          setInterpretation("")
        }
      }
      if (event.evidence.length > 0) {
        setEvidence(previewEvidence(event.evidence))
      }
      if (event.trace.length > 0) {
        setAgentTrace(event.trace)
      }
      if (event.stage === "delta" && event.delta) {
        setPhase("streaming")
        if (question) {
          appendStreamingFollowUp(followUpId ?? requestId, question, event.delta)
        } else {
          useReaderStore.setState((state) => ({
            interpretation: `${state.interpretation}${event.delta ?? ""}`,
          }))
        }
      }
      if (event.stage === "done" && event.answer) {
        setPhase("streaming")
        activeInterpretationRequestId.current = ""
        setAnswerSource(event.answerSource ?? "llm")
        if (question) {
          replaceStreamingFollowUp(followUpId ?? requestId, question, event.answer)
        } else {
          setInterpretation(event.answer)
        }
      }
      if (event.stage === "cancelled") {
        activeInterpretationRequestId.current = ""
        setPhase("reading")
      }
      if (event.stage === "failed") {
        activeInterpretationRequestId.current = ""
        setInterpretationError(event.message || "解读失败")
        setPhase("error")
      }
    })
  }

  function appendStreamingFollowUp(id: string, question: string, delta: string) {
    useReaderStore.setState((state) => {
      const existing = state.followUps.find((turn) => turn.id === id)
      if (!existing) {
        return {
          followUps: [
            ...state.followUps,
            {
              id,
              question,
              answer: delta,
            },
          ],
        }
      }
      return {
        followUps: state.followUps.map((turn) =>
          turn.id === id ? { ...turn, answer: `${turn.answer}${delta}` } : turn,
        ),
      }
    })
  }

  function replaceStreamingFollowUp(id: string, question: string, answer: string) {
    useReaderStore.setState((state) => {
      const existing = state.followUps.find((turn) => turn.id === id)
      if (!existing) {
        return {
          followUps: [
            ...state.followUps,
            {
              id,
              question,
              answer,
            },
          ],
        }
      }
      return {
        followUps: state.followUps.map((turn) =>
          turn.id === id ? { ...turn, question, answer } : turn,
        ),
      }
    })
  }

  function handleQuestionSubmit(question: string) {
    if (!selectionText) {
      return
    }
    const version = startRequest()
    clearTimers()
    void answerFollowUp(question, version)
  }

  function handleStop() {
    stopActiveRequest()
    setPhase("reading")
  }

  function handlePageChange(page: number) {
    stopActiveRequest()
    setCurrentPage(page)
  }

  function handleSelection(
    text: string,
    rects: typeof selectionRects,
    anchor?: TextSelectionAnchor | null,
  ) {
    stopActiveRequest()
    setSelection(text, rects, anchor ?? inferSelectionAnchor(text, rects))
  }

  function handleClearSelection() {
    stopActiveRequest()
    clearSelection()
  }

  function inferSelectionAnchor(
    text: string,
    rects: typeof selectionRects,
  ): TextSelectionAnchor | null {
    return inferTextSelectionAnchor({
      selectionText: text,
      selectionRects: rects,
      currentPage,
      pages: parsedPages,
    })
  }

  function handleChunkFocus(
    page: number,
    chunkId: string,
    text: string,
    rects: typeof selectionRects,
    preserveInterpretation?: boolean,
  ) {
    stopActiveRequest()
    focusChunk(page, chunkId, text, rects, preserveInterpretation)
  }

  async function runBackendInterpretation(mode: "deep" | "plain", version: number) {
    if (!shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() })) {
      await runFallbackInterpretation(mode, version)
      return
    }
    try {
      if (!isCurrentRequest(version)) {
        return
      }
      setPhase("retrieving")
      const requestId = makeRequestId(version)
      activeInterpretationRequestId.current = requestId
      await attachInterpretationStream(requestId, version)
      const result = await interpretSelection({
        bookId,
        selectionText,
        pageIndexes: focusPageIndexes(),
        focusChunkIds: focusChunkIds(),
        mode,
      }, requestId)
      if (!isCurrentRequest(version)) {
        return
      }
      activeInterpretationRequestId.current = ""
      clearStreamListener()
      const evidencePreview = previewEvidence(result.evidence)
      setEvidence(evidencePreview)
      setAgentTrace(result.trace)
      setAnswerSource(result.answerSource)
      setInterpretation(result.answer)
      void persistInterpretation(result.answer, { evidencePreview, version, answerSource: result.answerSource })
      setPhase("streaming")
      schedule(() => {
        if (isCurrentRequest(version)) setPhase("reading")
      }, 350)
    } catch (error) {
      activeInterpretationRequestId.current = ""
      clearStreamListener()
      if (!isCurrentRequest(version)) {
        return
      }
      setInterpretationError(
        `后端解读失败，已切换到本地兜底：${error instanceof Error ? error.message : String(error)}`,
      )
      await runFallbackInterpretation(mode, version)
    }
  }

  async function runFallbackInterpretation(mode: "deep" | "plain", version: number) {
    if (!isCurrentRequest(version)) {
      return
    }
    const hits = await findEvidenceChunks()
    if (!isCurrentRequest(version)) {
      return
    }
    const indexedChunks = hits.map(searchHitToChunk)
    const chunks = localFallbackChunks(indexedChunks)
    const fallbackPages = selectionRects.length === 0 ? focusPageIndexes() : []
    const evidencePreview = makeLocalEvidence(selectionRects, parsedPages, chunks, fallbackPages)
    setEvidence(evidencePreview)
    setAgentTrace([])
    setAnswerSource("local_fallback")
    setPhase("retrieving")
    const text = makeLocalInterpretation(
      selectionText,
      selectionRects,
      parsedPages,
      chunks,
      shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() }),
      fallbackPages[0],
    )
    const answer =
      mode === "plain"
        ? `${text}\n\n简要来说：这段话已经被定位到转换后的正文；当前环境会先使用转换稿文本给出可核对解释。`
        : text
    setInterpretation(answer)
    void persistInterpretation(answer, { evidencePreview, version, answerSource: "local_fallback" })
    setPhase("streaming")
    schedule(() => {
      if (isCurrentRequest(version)) setPhase("reading")
    }, 350)
  }

  async function answerFollowUp(question: string, version: number) {
    if (!isCurrentRequest(version)) {
      return
    }
    setPhase("planning")
    if (!shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() })) {
      await answerFallbackFollowUp(question, version)
      return
    }
    try {
      setPhase("retrieving")
      const requestId = makeRequestId(version)
      const followUpId = `follow-up-${requestId}`
      const followUpIndex = useReaderStore.getState().followUps.length
      activeInterpretationRequestId.current = requestId
      await attachInterpretationStream(requestId, version, question, followUpId)
      const result = await interpretSelection({
        bookId,
        selectionText,
        pageIndexes: focusPageIndexes(),
        focusChunkIds: focusChunkIds(),
        question,
        priorAnswer: interpretation || undefined,
        priorEvidenceChunkIds: evidence.map((item) => item.chunkId),
        followUpHistory: followUps,
        mode: "plain",
      }, requestId)
      if (!isCurrentRequest(version)) {
        return
      }
      activeInterpretationRequestId.current = ""
      clearStreamListener()
      const evidencePreview = previewEvidence(result.evidence)
      setEvidence(evidencePreview)
      setAgentTrace(result.trace)
      setAnswerSource(result.answerSource)
      void persistInterpretation(result.answer, {
        question,
        evidencePreview,
        version,
        followUpIndex,
        answerSource: result.answerSource,
      })
      replaceStreamingFollowUp(followUpId, question, result.answer)
      setPhase("streaming")
      schedule(() => {
        if (isCurrentRequest(version)) setPhase("reading")
      }, 350)
    } catch (error) {
      activeInterpretationRequestId.current = ""
      clearStreamListener()
      setInterpretationError(
        `后端追问失败，已切换到本地兜底：${error instanceof Error ? error.message : String(error)}`,
      )
      await answerFallbackFollowUp(question, version)
    }
  }

  async function answerFallbackFollowUp(question: string, version: number) {
    if (!isCurrentRequest(version)) {
      return
    }
    const hits = await findEvidenceChunks()
    if (!isCurrentRequest(version)) {
      return
    }
    const indexedChunks = hits.map(searchHitToChunk)
    const fallbackPages = selectionRects.length === 0 ? focusPageIndexes() : []
    const chunks = localFallbackChunks(indexedChunks)
    const evidencePreview = makeLocalEvidence(selectionRects, parsedPages, chunks, fallbackPages)
    setEvidence(evidencePreview)
    setAgentTrace([])
    setAnswerSource("local_fallback")
    const answer = makeLocalFollowUpAnswer(
      question,
      selectionText,
      parsedPages,
      selectionRects,
      chunks,
      shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() }),
      fallbackPages[0],
    )
    const followUpIndex = useReaderStore.getState().followUps.length
    addFollowUp(question, answer)
    void persistInterpretation(answer, {
      question,
      evidencePreview,
      version,
      followUpIndex,
      answerSource: "local_fallback",
    })
    setPhase("streaming")
    schedule(() => {
      if (isCurrentRequest(version)) setPhase("reading")
    }, 350)
  }

  async function persistInterpretation(
    answer: string,
    options: {
      question?: string
      evidencePreview?: EvidencePreview[]
      version?: number
      followUpIndex?: number
      answerSource?: AnswerSource
    } = {},
  ) {
    const { question, evidencePreview = evidence, version, followUpIndex, answerSource: savedAnswerSource = answerSource } = options
    if (version !== undefined && !isCurrentRequest(version)) {
      return
    }
    if (!bookId || libraryStatus !== "indexed" || !selectionText.trim() || !answer.trim()) {
      return
    }

    try {
      const pageIndexes = focusPageIndexes()
      const pageIndex = pageIndexes[0] ?? currentPage - 1
      const preferredPositionStart =
        selectionAnchor?.pageIndex === pageIndex ? selectionAnchor.positionStart : null
      const selector = makeTextQuoteSelector(
        pageTextByIndex(parsedPages, pageIndex),
        selectionText,
        preferredPositionStart,
      )
      const turn = planInterpretationTurn({
        currentSessionId: useReaderStore.getState().interpretationSessionId,
        intent: question ? "follow_up" : "initial",
        followUpCount: followUpIndex ?? useReaderStore.getState().followUps.length,
        createSessionId: makeInterpretationSessionId,
      })
      if (turn.createdSession) {
        setInterpretationSessionId(turn.sessionId)
      }
      const request = {
        bookId,
        selectionText,
        sessionId: turn.sessionId,
        turnIndex: turn.turnIndex,
        prefix: selector.prefix,
        suffix: selector.suffix,
        pageIndex,
        positionStart: selector.positionStart,
        positionEnd: selector.positionEnd,
        pageIndexes,
        evidenceChunkIds: evidencePreview.map((item) => item.chunkId),
        question: question ?? null,
        answer,
        answerSource: savedAnswerSource,
      }
      const saved = isTauriRuntime()
        ? await saveInterpretation(request)
        : browserLibraryAvailable()
          ? await saveBrowserInterpretation(request)
          : null
      if (!saved) {
        return
      }
      if (version !== undefined && !isCurrentRequest(version)) {
        return
      }
      setInterpretationSessionId(saved.sessionId)
      addInterpretationHistory(saved)
      return saved
    } catch {
      // Browser-only preview cannot persist history through Tauri.
    }
  }

  function focusPageIndexes() {
    return focusPageIndexesForSelection({ selectionRects, selectionAnchor, currentPage })
  }

  function focusChunkIds() {
    return focusChunkIdsForSelection({
      selectionText,
      selectionRects,
      selectionAnchor,
      currentPage,
      chunks: parsedChunks,
      pages: parsedPages,
    })
  }

  function localFallbackChunks(indexedChunks: ParsedChunk[]) {
    return orderLocalFallbackChunks({
      focusChunkIds: focusChunkIds(),
      indexedChunks,
      parsedChunks,
    })
  }

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
      return true
    } catch {
      // Browser-only dev mode cannot persist through Tauri. Keep current UI stable.
      return false
    }
  }

  function handleOpenHighlight(highlight: (typeof highlights)[number]) {
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
    setSelection(restored.selectionText, restored.selectionRects, restored.selectionAnchor)
    setActiveChunk(restored.activeChunkId)
    setEvidence(restored.evidence)
    setAgentTrace([])
    setInterpretation(restored.interpretation)
    setAnswerSource(item.answerSource ?? "llm")
    setFollowUps(restored.followUps)
    setInterpretationSessionId(item.sessionId || item.id)
    setPhase("reading")
  }

  async function handleDeleteHighlight(highlightId: string) {
    removeHighlight(highlightId)
    try {
      if (isTauriRuntime()) {
        await deleteHighlight(highlightId)
      } else if (browserLibraryAvailable()) {
        await deleteBrowserHighlight(highlightId)
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

  const citationChunkIds = [
    ...new Set([
      ...parsedChunks.map((chunk) => chunk.chunkId),
      ...evidence.map((item) => item.chunkId),
    ]),
  ]

  return (
    <ReaderShell
      phase={phase}
      bookId={bookId}
      libraryStatus={libraryStatus}
      libraryMessage={libraryMessage}
      bookTitle={bookTitle}
      currentPage={currentPage}
      totalPages={totalPages}
      selectionText={selectionText}
      selectionRects={selectionRects}
      selectionAnchor={selectionAnchor}
      evidence={evidence}
      citationChunkIds={citationChunkIds}
      agentTrace={agentTrace}
      interpretation={interpretation}
      answerSource={answerSource}
      interpretationError={interpretationError}
      followUps={followUps}
      highlights={highlights}
      interpretationHistory={summarizeInterpretationSessions(interpretationHistory)}
      parsedPages={parsedPages}
      parsedChunks={parsedChunks}
      parserEngine={parserEngine}
      coordinateMode={coordinateMode}
      activeChunkId={activeChunkId}
      textQuality={textQuality}
      zoom={zoom}
      onBookLoaded={setBook}
      onLibraryStatus={(status, message, indexedBookId) => {
        setLibraryStatus(status, message, indexedBookId)
        if (indexedBookId && status === "indexed") {
          void loadHighlights(indexedBookId)
          void loadInterpretationHistory(indexedBookId)
        }
      }}
      onParsedDocument={setParsedDocument}
      onPageChange={handlePageChange}
      onVisiblePageChange={setVisiblePage}
      onZoomChange={setZoom}
      onSelection={handleSelection}
      onClearSelection={handleClearSelection}
      onActiveChunk={setActiveChunk}
      onChunkFocus={handleChunkFocus}
      onPhaseChange={setPhase}
      onDeepInterpret={() => runLocalInterpretation("deep")}
      onPlainExplain={() => runLocalInterpretation("plain")}
      onQuestionSubmit={handleQuestionSubmit}
      onSaveHighlight={handleSaveHighlight}
      onOpenHighlight={handleOpenHighlight}
      onDeleteHighlight={handleDeleteHighlight}
      onOpenInterpretation={handleOpenInterpretation}
      onDeleteInterpretation={handleDeleteInterpretation}
      onCitationClick={handleCitationClick}
      onRegenerate={() => runLocalInterpretation("deep")}
      onStop={handleStop}
    />
  )
}
