import { useRef } from "react"
import { ReaderShell } from "@/components/reader/ReaderShell"
import { useReaderStore } from "@/stores/reader-store"
import {
  MockAgentTaskRunner,
  agentTaskToKnowledgeCardRequests,
  createAgentTaskRunner,
  type AgentTaskKind,
  type AgentTaskRunner,
} from "@/core/agent-task"
import {
  buildKnowledgeGraph,
  cancelInterpretation,
  confirmKnowledgeCard,
  normalizeCommandError,
  deleteHighlight,
  deleteInterpretation,
  deleteKnowledgeCard,
  getAgentHostUrl,
  getDocumentTldr,
  getBookKnowledgeMap,
  getChunk,
  getKnowledgeHealth,
  getLlmSettings,
  exportBookKnowledgeJson,
  exportBookKnowledgeMarkdown,
  interpretSelection,
  isTauriRuntime,
  listKnowledgeDrift,
  listenInterpretationStream,
  listHighlights,
  listInterpretations,
  listKnowledgeCards,
  getKnowledgeGraph,
  rejectKnowledgeCard,
  saveHighlight,
  saveInterpretation,
  searchBook,
  searchHitToChunk,
  regenerateDocumentTldr,
  upsertKnowledgeCard,
  type InterpretEvidenceItem,
  type AnswerSource,
  type InterpretMode,
  type SearchBookHit,
  type UpsertKnowledgeCardRequest,
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
  lightweightFromSavedInterpretation,
  restoreTargetForSavedInterpretation,
} from "@/core/interpretation-history"
import { restoreTargetForSavedHighlight } from "@/core/highlight-restore"
import {
  chunkContentHash,
  isLegacyChunkId,
  isNamespacedChunkId,
} from "@/core/chunk-id"
import {
  makeInterpretationSessionId,
  planInterpretationTurn,
} from "@/core/interpretation-session"
import { llmKeyReadiness, shouldUseBackendInterpretation } from "@/core/interpretation-runtime"
import { orderLocalFallbackChunks } from "@/core/local-fallback-chunks"
import { resolveCitationTarget } from "@/core/citation-target"
import { createSampleBook } from "@/core/sample-book"
import { knowledgeExportFilename } from "@/core/knowledge-export"
import type {
  EvidencePreview,
  ParsedChunk,
  SavedInterpretation,
  TextSelectionAnchor,
} from "@/stores/reader-store"

function localFallbackNotice(error?: unknown, action: "解读" | "追问" = "解读") {
  if (!error) {
    return "当前环境暂时不能使用完整 LLM 解读，已改用本地转换稿生成可核对回答；配置 LLM API Key 并确认网络后可恢复完整能力。"
  }
  const commandError = normalizeCommandError(error)
  const suggestion =
    commandError.suggestion ||
    "请在设置中检查 LLM API Key、Base URL 和网络连接；本地兜底仍会保留选区、证据和引用回跳。"
  switch (commandError.code) {
    case "authentication":
      return `完整 LLM ${action}需要有效的 API Key，当前已改用本地兜底。${suggestion}`
    case "network":
    case "timeout":
      return `完整 LLM ${action}暂时连接不上云端服务，当前已改用本地兜底。${suggestion}`
    default:
      return `完整 LLM ${action}暂时不可用，当前已改用本地兜底。${suggestion}`
  }
}

export function App() {
  const timers = useRef<number[]>([])
  const agentTaskRunner = useRef<AgentTaskRunner>(new MockAgentTaskRunner())
  const agentRunnerResolved = useRef(false)
  const agentTaskUnsubscribers = useRef(new Map<string, () => void>())
  const persistedAgentTaskIds = useRef(new Set<string>())
  const requestGuard = useRef(createRequestGuard())
  const streamUnlisten = useRef<(() => void) | null>(null)
  const activeInterpretationRequestId = useRef<string>("")
  const tldrRequestBookId = useRef("")
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
    tldr,
    tldrLoading,
    tldrError,
    tldrLlmReady,
    activeInterpretationSessionId,
    workbenchTab,
    currentThreadLightweight,
    currentThreadSelectionText,
    currentThreadSelectionRects,
    currentThreadSelectionAnchor,
    currentThreadPageIndex,
    currentNoteDraft,
    currentNoteOpen,
    currentNoteSaving,
    currentThreadError,
    agentTasks,
    highlights,
    interpretationHistory,
    knowledgeCards,
    knowledgeGraph,
    knowledgeHealth,
    knowledgeDrift,
    knowledgeMap,
    knowledgeLoading,
    knowledgeGraphLoading,
    knowledgeGraphBuilding,
    knowledgeError,
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
    setActiveInterpretationSessionId,
    setWorkbenchTab,
    setCurrentThreadLightweight,
    setCurrentThreadSelection,
    setCurrentNoteDraft,
    setCurrentNoteOpen,
    setCurrentNoteSaving,
    setCurrentThreadError,
    upsertAgentTask,
    setHighlights,
    setInterpretationHistory,
    setKnowledgeCards,
    setKnowledgeGraph,
    setKnowledgeHealth,
    setKnowledgeDrift,
    setKnowledgeMap,
    setKnowledgeLoading,
    setKnowledgeGraphLoading,
    setKnowledgeGraphBuilding,
    setKnowledgeError,
    setTldr,
    setTldrLoading,
    setTldrError,
    setTldrLlmReady,
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
    mergeParsedDocumentWindow,
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

  function currentThreadFocus() {
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

  function runLocalInterpretation(mode: InterpretMode = "deep", lightweightOverride?: boolean) {
    const focus = currentThreadFocus()
    if (!focus.text) {
      return
    }

    const version = startRequest()
    const lightweight = lightweightOverride ?? useReaderStore.getState().currentThreadLightweight
    clearTimers()
    setCurrentThreadSelection(focus.text, focus.rects, focus.anchor, focus.pageIndex)
    clearInterpretation()
    setCurrentThreadLightweight(lightweight)
    setWorkbenchTab("spark")
    setPhase("planning")
    schedule(() => {
      void runBackendInterpretation(mode, version, lightweight)
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
        // Reset the current turn's streaming draft. This also discards any
        // partial deltas already streamed by an OpenCode attempt that failed
        // and fell back to the Rust pipeline (which re-emits synthesizing),
        // so the user never sees two answers concatenated.
        if (question) {
          resetStreamingFollowUp(followUpId ?? requestId, question)
        } else {
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

  // Clear a follow-up turn's streamed answer back to empty so a (re)stream
  // starts clean — used when synthesis (re)starts, e.g. after an OpenCode
  // attempt fell back to the Rust pipeline.
  function resetStreamingFollowUp(id: string, question: string) {
    replaceStreamingFollowUp(id, question, "")
  }

  function handleQuestionSubmit(question: string) {
    if (!currentThreadFocus().text) {
      return
    }
    const version = startRequest()
    const lightweight = useReaderStore.getState().currentThreadLightweight
    clearTimers()
    void answerFollowUp(question, version, lightweight)
  }

  function handleCurrentThreadLightweightChange(enabled: boolean) {
    setCurrentThreadLightweight(enabled)
  }

  function handleStartComment() {
    const focus = currentThreadFocus()
    if (!focus.text) {
      return
    }
    stopActiveRequest()
    clearInterpretation()
    setCurrentThreadSelection(focus.text, focus.rects, focus.anchor, focus.pageIndex)
    setCurrentThreadLightweight(false)
    setCurrentThreadError("")
    setCurrentNoteOpen(true)
    setWorkbenchTab("spark")
    setPhase("reading")
  }

  async function handleSaveCurrentNote() {
    if (!currentThreadFocus().text) {
      setCurrentThreadError("请先框选一段文字")
      return
    }
    const note = currentNoteDraft.trim()
    if (!note) {
      setCurrentThreadError("Note 不能为空")
      return
    }
    setCurrentThreadError("")
    setCurrentNoteSaving(true)
    try {
      const saved = await persistInterpretation(note, {
        evidencePreview: [],
        answerSource: "local_fallback",
        kind: "note",
        sessionId: activeInterpretationSessionId || makeInterpretationSessionId(),
        turnIndex: activeThreadItems.length,
      })
      if (saved) {
        setActiveInterpretationSessionId(saved.sessionId)
        setCurrentNoteDraft("")
        setCurrentNoteOpen(false)
      }
    } finally {
      setCurrentNoteSaving(false)
    }
  }

  async function ensureAgentTaskRunner() {
    // Lazily swap the Mock runner for the real OpenCode runner once, the first
    // time an agent task is started, if the sidecar is up. Keeps the no-useEffect
    // bootstrap architecture intact.
    if (agentRunnerResolved.current) {
      return
    }
    agentRunnerResolved.current = true
    const status = await getAgentHostUrl()
    if (status?.ready && status.hostUrl) {
      agentTaskRunner.current = createAgentTaskRunner({
        hostUrl: status.hostUrl,
        ready: status.ready,
      })
    }
  }

  async function handleRunAgentTask(kind: AgentTaskKind, prompt?: string) {
    if (!bookId) {
      return
    }
    await ensureAgentTaskRunner()
    const taskId = await agentTaskRunner.current.run(kind, { bookId, prompt })
    const unsubscribe = agentTaskRunner.current.subscribe(taskId, (task) => {
      upsertAgentTask(task)
      if (task.status === "done" && !persistedAgentTaskIds.current.has(task.id)) {
        persistedAgentTaskIds.current.add(task.id)
        // Persist artifacts back to the book the task was STARTED for, not the
        // book currently open — the user may have switched books while a long
        // task was running. So bind bookId explicitly here instead of routing
        // through handleSaveKnowledgeCard (which uses the current bookId).
        const requests = agentTaskToKnowledgeCardRequests(task, bookId)
        if (requests.length > 0) {
          void persistAgentTaskCards(bookId, task.id, requests)
        }
      }
      // App.tsx manages side effects explicitly (no useEffect); release the
      // subscription as soon as the task reaches a terminal state so real
      // runners (OpenCode) don't leak listeners.
      if (task.status === "done" || task.status === "stopped" || task.status === "error") {
        agentTaskUnsubscribers.current.get(taskId)?.()
        agentTaskUnsubscribers.current.delete(taskId)
      }
    })
    agentTaskUnsubscribers.current.set(taskId, unsubscribe)
    setWorkbenchTab("tasks")
  }

  function handleStopAgentTask(taskId: string) {
    agentTaskRunner.current.stop(taskId)
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

  function handleOpenSampleBook() {
    stopActiveRequest()
    const sample = createSampleBook()
    setBook(sample.title, sample.pages.length)
    setParsedDocument(sample.pages, sample.chunks, sample.text, sample.markdown, sample.metadata)
    setLibraryStatus("memory-only", "示例书已载入；无需配置 key，可直接体验本地兜底解读")
    setSelection(sample.initialSelection.text, [], sample.initialSelection.anchor)
    setEvidence(sample.evidence)
    setAgentTrace(sample.agentTrace)
    setAnswerSource("local_fallback")
    setInterpretation(sample.interpretation)
    setFollowUps([])
    setInterpretationError("")
    setPhase("reading")
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

  async function runBackendInterpretation(mode: InterpretMode, version: number, lightweight: boolean) {
    if (!shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() })) {
      setInterpretationError(localFallbackNotice(undefined, "解读"))
      await runFallbackInterpretation(mode, version, lightweight)
      return
    }
    try {
      if (!isCurrentRequest(version)) {
        return
      }
      const readiness = await backendLlmReadiness("解读")
      if (!isCurrentRequest(version)) {
        return
      }
      if (!readiness.ready) {
        setInterpretationError(readiness.message)
        await runFallbackInterpretation(mode, version, lightweight)
        return
      }
      setPhase("retrieving")
      const requestId = makeRequestId(version)
      activeInterpretationRequestId.current = requestId
      await attachInterpretationStream(requestId, version)
      const result = await interpretSelection({
        bookId,
        selectionText: currentThreadFocus().text,
        pageIndexes: focusPageIndexes(),
        selectionRects: currentThreadFocus().rects,
        focusChunkIds: focusChunkIds(),
        lightweight,
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
      void persistInterpretation(result.answer, {
        evidencePreview,
        version,
        answerSource: result.answerSource,
        kind: lightweight ? "spark" : "interpretation",
        mode,
      })
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
      setInterpretationError(localFallbackNotice(error, "解读"))
      await runFallbackInterpretation(mode, version, lightweight)
    }
  }

  async function runFallbackInterpretation(mode: InterpretMode, version: number, lightweight: boolean) {
    if (!isCurrentRequest(version)) {
      return
    }
    const hits = await findEvidenceChunks()
    if (!isCurrentRequest(version)) {
      return
    }
    const indexedChunks = hits.map(searchHitToChunk)
    const chunks = localFallbackChunks(indexedChunks)
    const focus = currentThreadFocus()
    const fallbackPages = focus.rects.length === 0 ? focusPageIndexes() : []
    const evidencePreview = makeLocalEvidence(focus.rects, parsedPages, chunks, fallbackPages)
    setEvidence(evidencePreview)
    setAgentTrace([])
    setAnswerSource("local_fallback")
    setPhase("retrieving")
    const text = makeLocalInterpretation(
      focus.text,
      focus.rects,
      parsedPages,
      chunks,
      shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() }),
      fallbackPages[0],
    )
    const answer =
      mode === "plain"
        ? `${text}\n\n简要来说：这段话已经被定位到转换后的正文；当前环境会先使用转换稿文本给出可核对解释。`
        : mode === "apply"
          ? `${text}\n\n应用/迁移提示：当前环境只能基于转换稿做本地兜底，不能替代完整 LLM 的迁移分析；请优先核对上面的原文依据。`
        : text
    setInterpretation(answer)
    void persistInterpretation(answer, {
      evidencePreview,
      version,
      answerSource: "local_fallback",
      kind: lightweight ? "spark" : "interpretation",
      mode,
    })
    setPhase("streaming")
    schedule(() => {
      if (isCurrentRequest(version)) setPhase("reading")
    }, 350)
  }

  async function answerFollowUp(
    question: string,
    version: number,
    lightweight: boolean,
  ) {
    if (!isCurrentRequest(version)) {
      return
    }
    setPhase("planning")
    if (!shouldUseBackendInterpretation({ bookId, libraryStatus, tauriRuntime: isTauriRuntime() })) {
      setInterpretationError(localFallbackNotice(undefined, "追问"))
      await answerFallbackFollowUp(question, version, lightweight)
      return
    }
    try {
      const readiness = await backendLlmReadiness("追问")
      if (!isCurrentRequest(version)) {
        return
      }
      if (!readiness.ready) {
        setInterpretationError(readiness.message)
        await answerFallbackFollowUp(question, version, lightweight)
        return
      }
      setPhase("retrieving")
      const requestId = makeRequestId(version)
      const followUpId = `follow-up-${requestId}`
      const followUpIndex = useReaderStore.getState().followUps.length
      activeInterpretationRequestId.current = requestId
      await attachInterpretationStream(requestId, version, question, followUpId)
      const result = await interpretSelection({
        bookId,
        selectionText: currentThreadFocus().text,
        pageIndexes: focusPageIndexes(),
        selectionRects: currentThreadFocus().rects,
        focusChunkIds: focusChunkIds(),
        question,
        priorAnswer: interpretation || undefined,
        priorEvidenceChunkIds: evidence.map((item) => item.chunkId),
        followUpHistory: followUps,
        lightweight,
        mode: lightweight ? "plain" : "deep",
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
        kind: lightweight ? "spark" : "interpretation",
        mode: lightweight ? "plain" : "deep",
      })
      replaceStreamingFollowUp(followUpId, question, result.answer)
      setPhase("streaming")
      schedule(() => {
        if (isCurrentRequest(version)) setPhase("reading")
      }, 350)
    } catch (error) {
      activeInterpretationRequestId.current = ""
      clearStreamListener()
      setInterpretationError(localFallbackNotice(error, "追问"))
      await answerFallbackFollowUp(question, version, lightweight)
    }
  }

  async function answerFallbackFollowUp(
    question: string,
    version: number,
    lightweight: boolean,
  ) {
    if (!isCurrentRequest(version)) {
      return
    }
    const hits = await findEvidenceChunks()
    if (!isCurrentRequest(version)) {
      return
    }
    const indexedChunks = hits.map(searchHitToChunk)
    const focus = currentThreadFocus()
    const fallbackPages = focus.rects.length === 0 ? focusPageIndexes() : []
    const chunks = localFallbackChunks(indexedChunks)
    const evidencePreview = makeLocalEvidence(focus.rects, parsedPages, chunks, fallbackPages)
    setEvidence(evidencePreview)
    setAgentTrace([])
    setAnswerSource("local_fallback")
    const answer = makeLocalFollowUpAnswer(
      question,
      focus.text,
      parsedPages,
      focus.rects,
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
      kind: lightweight ? "spark" : "interpretation",
      mode: lightweight ? "plain" : "deep",
    })
    setPhase("streaming")
    schedule(() => {
      if (isCurrentRequest(version)) setPhase("reading")
    }, 350)
  }

  async function backendLlmReadiness(action: "解读" | "追问") {
    try {
      return llmKeyReadiness(await getLlmSettings(), action)
    } catch (error) {
      return {
        ready: false as const,
        reason: "missing_api_key" as const,
        message: localFallbackNotice(error, action),
      }
    }
  }

  async function ensureTldr(bookIdToLoad = bookId, options: { force?: boolean; manual?: boolean } = {}) {
    if (!bookIdToLoad || !isTauriRuntime()) {
      setTldr(null)
      setTldrLoading(false)
      setTldrError("")
      setTldrLlmReady(false)
      return
    }
    if (!options.force && tldrRequestBookId.current === bookIdToLoad) {
      return
    }
    if (!options.force) {
      const cached = useReaderStore.getState().tldr
      if (cached?.text.trim() && useReaderStore.getState().bookId === bookIdToLoad) {
        return
      }
    }
    try {
      const readiness = await llmKeyReadiness(await getLlmSettings(), "解读")
      setTldrLlmReady(readiness.ready)
      if (!readiness.ready) {
        if (options.manual) {
          setTldrError(readiness.message)
        }
        return
      }
    } catch (error) {
      setTldrLlmReady(false)
      if (options.manual) {
        setTldrError(localFallbackNotice(error, "解读"))
      }
      return
    }
    tldrRequestBookId.current = bookIdToLoad
    setTldrLoading(true)
    setTldrError("")
    try {
      const result = options.force
        ? await regenerateDocumentTldr(bookIdToLoad)
        : await getDocumentTldr(bookIdToLoad)
      if (useReaderStore.getState().bookId !== bookIdToLoad) {
        return
      }
      setTldr({
        text: result.text,
        generatedAt: result.generatedAt,
        model: result.model,
        sourceVersion: result.sourceVersion,
      })
    } catch (error) {
      setTldrError(error instanceof Error ? error.message : "TLDR 生成失败")
    } finally {
      setTldrLoading(false)
      tldrRequestBookId.current = ""
    }
  }

  async function persistInterpretation(
    answer: string,
    options: {
      question?: string
      evidencePreview?: EvidencePreview[]
      version?: number
      followUpIndex?: number
      answerSource?: AnswerSource
      kind?: "interpretation" | "spark" | "note"
      mode?: InterpretMode
      sessionId?: string
      turnIndex?: number
    } = {},
  ) {
    const {
      question,
      evidencePreview = evidence,
      version,
      followUpIndex,
      answerSource: savedAnswerSource = answerSource,
      kind = "interpretation",
      mode,
      sessionId,
      turnIndex: explicitTurnIndex,
    } = options
    if (version !== undefined && !isCurrentRequest(version)) {
      return
    }
    const focus = currentThreadFocus()
    if (!bookId || libraryStatus !== "indexed" || !focus.text || !answer.trim()) {
      return
    }

    try {
      const pageIndexes = focusPageIndexes()
      const pageIndex = pageIndexes[0] ?? focus.pageIndex
      const preferredPositionStart =
        focus.anchor?.pageIndex === pageIndex ? focus.anchor.positionStart : null
      const selector = makeTextQuoteSelector(
        pageTextByIndex(parsedPages, pageIndex),
        focus.text,
        preferredPositionStart,
      )
      const turn = planInterpretationTurn({
        currentSessionId:
          sessionId ??
          useReaderStore.getState().activeInterpretationSessionId,
        intent: question ? "follow_up" : "initial",
        followUpCount:
          explicitTurnIndex !== undefined
            ? Math.max(0, explicitTurnIndex - 1)
            : followUpIndex ?? useReaderStore.getState().followUps.length,
        createSessionId: makeInterpretationSessionId,
      })
      if (turn.createdSession || !useReaderStore.getState().activeInterpretationSessionId) {
        setActiveInterpretationSessionId(turn.sessionId)
      }
      const request = {
        bookId,
        selectionText: focus.text,
        sessionId: turn.sessionId,
        turnIndex: explicitTurnIndex ?? turn.turnIndex,
        prefix: selector.prefix,
        suffix: selector.suffix,
        pageIndex,
        positionStart: selector.positionStart,
        positionEnd: selector.positionEnd,
        pageIndexes,
        evidenceChunkIds: evidencePreview.map((item) => item.chunkId),
        evidenceChunkSnapshots: evidenceSnapshotsForChunkIds(evidencePreview.map((item) => item.chunkId)),
        question: question ?? null,
        answer,
        answerSource: savedAnswerSource,
        kind,
        mode,
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
      setActiveInterpretationSessionId(saved.sessionId)
      addInterpretationHistory(saved)
      if (isTauriRuntime()) {
        refreshKnowledge(bookId)
      }
      return saved
    } catch {
      // Browser-only preview cannot persist history through Tauri.
    }
  }

  function focusPageIndexes() {
    const focus = currentThreadFocus()
    return focusPageIndexesForSelection({
      selectionRects: focus.rects,
      selectionAnchor: focus.anchor,
      currentPage,
    })
  }

  function focusChunkIds() {
    const focus = currentThreadFocus()
    return focusChunkIdsForSelection({
      selectionText: focus.text,
      selectionRects: focus.rects,
      selectionAnchor: focus.anchor,
      currentPage,
      chunks: parsedChunks,
      pages: parsedPages,
    })
  }

  function evidenceSnapshotsForChunkIds(chunkIds: string[]) {
    return chunkIds.map((chunkId) => {
      const chunk = parsedChunks.find((candidate) => candidate.chunkId === chunkId)
      return {
        chunkId,
        chunkIdVersion: isNamespacedChunkId(chunkId) ? 2 : isLegacyChunkId(chunkId) ? 1 : 0,
        contentHash: chunk ? chunkContentHash(chunk.text) : null,
      }
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
      const evidenceChunkIds = focusChunkIds()
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
        evidenceChunkSnapshots: evidenceSnapshotsForChunkIds(evidenceChunkIds),
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
    setCurrentThreadSelection(
      restored.selectionText,
      restored.selectionRects,
      restored.selectionAnchor,
      restored.pageNumber - 1,
    )
    setActiveChunk(restored.activeChunkId)
    setEvidence(restored.evidence)
    setAgentTrace([])
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
      setAgentTrace([])
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

  async function loadKnowledgeCards(bookIdToLoad: string) {
    if (!isTauriRuntime()) {
      setKnowledgeCards([])
      setKnowledgeGraph(null)
      setKnowledgeHealth(null)
      setKnowledgeDrift([])
      setKnowledgeMap(null)
      return
    }
    setKnowledgeLoading(true)
    try {
      const rows = await listKnowledgeCards(bookIdToLoad)
      setKnowledgeCards(rows)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function loadKnowledgeHealth(bookIdToLoad: string) {
    if (!isTauriRuntime()) {
      setKnowledgeHealth(null)
      setKnowledgeDrift([])
      return
    }
    try {
      const [health, drift] = await Promise.all([
        getKnowledgeHealth(bookIdToLoad),
        listKnowledgeDrift(bookIdToLoad),
      ])
      setKnowledgeHealth(health)
      setKnowledgeDrift(drift)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function loadKnowledgeGraph(bookIdToLoad: string) {
    if (!isTauriRuntime()) {
      setKnowledgeGraph(null)
      setKnowledgeMap(null)
      return
    }
    setKnowledgeGraphLoading(true)
    try {
      const [graph, map] = await Promise.all([
        getKnowledgeGraph(bookIdToLoad),
        getBookKnowledgeMap(bookIdToLoad),
      ])
      setKnowledgeGraph(graph)
      setKnowledgeMap(map)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  function refreshKnowledge(bookIdToLoad: string) {
    void loadKnowledgeCards(bookIdToLoad)
    void loadKnowledgeGraph(bookIdToLoad)
    void loadKnowledgeHealth(bookIdToLoad)
  }

  async function handleBuildKnowledge() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    setKnowledgeGraphBuilding(true)
    try {
      await buildKnowledgeGraph(bookId)
      await Promise.all([loadKnowledgeCards(bookId), loadKnowledgeGraph(bookId), loadKnowledgeHealth(bookId)])
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleExportKnowledgeMarkdown() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      const exportResult = await exportBookKnowledgeMarkdown(bookId)
      downloadMarkdownFile(
        knowledgeExportFilename(bookTitle || "reading-knowledge", "md", new Date()),
        exportResult.markdown,
      )
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleExportKnowledgeJson() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      const exportResult = await exportBookKnowledgeJson(bookId)
      downloadTextFile(
        knowledgeExportFilename(bookTitle || "reading-knowledge", "json", new Date()),
        JSON.stringify(exportResult, null, 2),
        "application/json;charset=utf-8",
      )
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleConfirmKnowledgeCard(cardId: string) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await confirmKnowledgeCard(bookId, cardId)
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleRejectKnowledgeCard(cardId: string) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await rejectKnowledgeCard(bookId, cardId)
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleDeleteKnowledgeCard(cardId: string) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await deleteKnowledgeCard(bookId, cardId)
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleSaveKnowledgeCard(request: Omit<UpsertKnowledgeCardRequest, "bookId">) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await upsertKnowledgeCard({
        ...request,
        bookId,
      })
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function persistAgentTaskCards(
    targetBookId: string,
    taskId: string,
    requests: Omit<UpsertKnowledgeCardRequest, "bookId">[],
  ) {
    if (!targetBookId || !isTauriRuntime()) {
      return
    }
    try {
      for (const request of requests) {
        await upsertKnowledgeCard({ ...request, bookId: targetBookId })
      }
      refreshKnowledge(targetBookId)
    } catch (error) {
      const message = normalizeCommandError(error).message
      const currentTask = useReaderStore.getState().agentTasks.find((task) => task.id === taskId)
      if (currentTask) {
        upsertAgentTask({
          ...currentTask,
          status: "error",
          errorMessage: `任务产物保存失败：${message}`,
        })
      }
    }
  }

  const citationChunkIds = [
    ...new Set([
      ...parsedChunks.map((chunk) => chunk.chunkId),
      ...evidence.map((item) => item.chunkId),
    ]),
  ]

  const activeThreadItems = activeInterpretationSessionId
    ? interpretationHistory
        .filter((item) => (item.sessionId || item.id) === activeInterpretationSessionId)
        .sort((left, right) => left.turnIndex - right.turnIndex || left.createdAt.localeCompare(right.createdAt))
    : []
  const runningTaskCount = agentTasks.filter((task) => task.status === "queued" || task.status === "running").length

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
      tldr={tldr}
      tldrLoading={tldrLoading}
      tldrError={tldrError}
      tldrLlmReady={tldrLlmReady}
      workbenchTab={workbenchTab}
      workbenchRunningTaskCount={runningTaskCount}
      currentThreadLightweight={currentThreadLightweight}
      currentThreadSelectionText={currentThreadSelectionText}
      currentThreadSelectionRects={currentThreadSelectionRects}
      currentNoteDraft={currentNoteDraft}
      currentNoteOpen={currentNoteOpen}
      currentNoteSaving={currentNoteSaving}
      currentThreadError={currentThreadError}
      agentTasks={agentTasks}
      highlights={highlights}
      interpretationHistory={interpretationHistory}
      knowledgeCards={knowledgeCards}
      knowledgeGraph={knowledgeGraph}
      knowledgeHealth={knowledgeHealth}
      knowledgeDrift={knowledgeDrift}
      knowledgeMap={knowledgeMap}
      knowledgeLoading={knowledgeLoading}
      knowledgeGraphLoading={knowledgeGraphLoading}
      knowledgeGraphBuilding={knowledgeGraphBuilding}
      knowledgeError={knowledgeError}
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
          refreshKnowledge(indexedBookId)
          void ensureTldr(indexedBookId)
        }
      }}
      onParsedDocument={setParsedDocument}
      onParsedDocumentWindow={mergeParsedDocumentWindow}
      onPageChange={handlePageChange}
      onVisiblePageChange={setVisiblePage}
      onZoomChange={setZoom}
      onSelection={handleSelection}
      onClearSelection={handleClearSelection}
      onActiveChunk={setActiveChunk}
      onChunkFocus={handleChunkFocus}
      onPhaseChange={setPhase}
      onDeepInterpret={() => runLocalInterpretation("deep", false)}
      onPlainExplain={() => runLocalInterpretation("plain", true)}
      onComment={handleStartComment}
      onQuestionSubmit={handleQuestionSubmit}
      onWorkbenchTabChange={setWorkbenchTab}
      onCurrentThreadLightweightChange={handleCurrentThreadLightweightChange}
      onCurrentNoteChange={setCurrentNoteDraft}
      onCurrentNoteSave={() => void handleSaveCurrentNote()}
      onRunAgentTask={(kind, prompt) => void handleRunAgentTask(kind, prompt)}
      onStopAgentTask={handleStopAgentTask}
      onGenerateTldr={() => void ensureTldr(bookId, { manual: true })}
      onRegenerateTldr={() => void ensureTldr(bookId, { force: true, manual: true })}
      onSaveHighlight={handleSaveHighlight}
      onOpenHighlight={handleOpenHighlight}
      onDeleteHighlight={handleDeleteHighlight}
      onOpenInterpretation={handleOpenInterpretation}
      onOpenSparkInterpretation={handleOpenSparkInterpretation}
      onDeleteInterpretation={handleDeleteInterpretation}
      onCitationClick={handleCitationClick}
      onRefreshKnowledge={() => {
        if (bookId) {
          refreshKnowledge(bookId)
        }
      }}
      onBuildKnowledge={() => void handleBuildKnowledge()}
      onExportKnowledge={() => void handleExportKnowledgeMarkdown()}
      onExportKnowledgeJson={() => void handleExportKnowledgeJson()}
      onConfirmKnowledgeCard={(cardId) => void handleConfirmKnowledgeCard(cardId)}
      onRejectKnowledgeCard={(cardId) => void handleRejectKnowledgeCard(cardId)}
      onDeleteKnowledgeCard={(cardId) => void handleDeleteKnowledgeCard(cardId)}
      onSaveKnowledgeCard={(request) => void handleSaveKnowledgeCard(request)}
      onRegenerate={() =>
        runLocalInterpretation(
          currentThreadLightweight ? "plain" : "deep",
          currentThreadLightweight,
        )
      }
      onStop={handleStop}
      onOpenSampleBook={handleOpenSampleBook}
    />
  )
}

function downloadMarkdownFile(filename: string, markdown: string) {
  downloadTextFile(filename, markdown, "text/markdown;charset=utf-8")
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
