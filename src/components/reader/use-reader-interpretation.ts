import {
  getLlmSettings,
  interpretSelection,
  isTauriRuntime,
  listenInterpretationStream,
  saveInterpretation,
  searchHitToChunk,
  type AnswerSource,
  type InterpretEvidenceItem,
  type InterpretMode,
} from "@/core/library-api"
import { browserLibraryAvailable, saveBrowserInterpretation } from "@/core/browser-library"
import {
  makeLocalEvidence,
  makeLocalFollowUpAnswer,
  makeLocalInterpretation,
} from "@/core/local-interpreter"
import { makeTextQuoteSelector } from "@/core/text-quote-selector"
import { pageTextByIndex } from "@/core/page-lookup"
import {
  makeInterpretationSessionId,
  planInterpretationTurn,
} from "@/core/interpretation-session"
import { llmKeyReadiness, shouldUseBackendInterpretation } from "@/core/interpretation-runtime"
import { localFallbackNotice } from "@/core/interpretation-fallback-notice"
import { useReaderStore, type EvidencePreview } from "@/stores/reader-store"
import type { ReaderRequestLifecycle } from "./use-reader-request-lifecycle"
import type { ReaderFocus } from "./use-reader-focus"

type UseReaderInterpretationDeps = {
  lifecycle: ReaderRequestLifecycle
  focus: ReaderFocus
  refreshKnowledge: (bookIdToLoad: string) => void
}

/**
 * Spark 解读引擎：本地/后端解读、流式监听、追问、批注笔记与解读落库。全部副作用
 * 走 lifecycle 的 ref-based requestGuard/timers/streamUnlisten 命令式模式，不改成
 * useEffect（App 编排层的 no-useEffect 硬约束原样保留）。
 */
export function useReaderInterpretation({ lifecycle, focus, refreshKnowledge }: UseReaderInterpretationDeps) {
  const {
    schedule,
    clearTimers,
    startRequest,
    isCurrentRequest,
    clearStreamListener,
    stopActiveRequest,
    streamUnlisten,
    activeInterpretationRequestId,
  } = lifecycle
  const {
    currentThreadFocus,
    findEvidenceChunks,
    focusPageIndexes,
    focusChunkIds,
    evidenceSnapshotsForChunkIds,
    localFallbackChunks,
  } = focus
  const {
    bookId,
    libraryStatus,
    interpretation,
    evidence,
    answerSource,
    followUps,
    parsedPages,
    activeInterpretationSessionId,
    interpretationHistory,
    currentNoteDraft,
    setCurrentThreadSelection,
    clearInterpretation,
    setCurrentThreadLightweight,
    setWorkbenchTab,
    setPhase,
    setInterpretation,
    setEvidence,
    setAgentTrace,
    setAnswerSource,
    setInterpretationError,
    setCurrentThreadError,
    setCurrentNoteOpen,
    setCurrentNoteSaving,
    setActiveInterpretationSessionId,
    setCurrentNoteDraft,
    addInterpretationHistory,
    addFollowUp,
  } = useReaderStore()

  const activeThreadItems = activeInterpretationSessionId
    ? interpretationHistory
        .filter((item) => (item.sessionId || item.id) === activeInterpretationSessionId)
        .sort((left, right) => left.turnIndex - right.turnIndex || left.createdAt.localeCompare(right.createdAt))
    : []

  function runLocalInterpretation(mode: InterpretMode = "deep", lightweightOverride?: boolean) {
    const focusSnapshot = currentThreadFocus()
    if (!focusSnapshot.text) {
      return
    }

    const version = startRequest()
    const lightweight = lightweightOverride ?? useReaderStore.getState().currentThreadLightweight
    clearTimers()
    setCurrentThreadSelection(focusSnapshot.text, focusSnapshot.rects, focusSnapshot.anchor, focusSnapshot.pageIndex)
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
    const focusSnapshot = currentThreadFocus()
    if (!focusSnapshot.text) {
      return
    }
    stopActiveRequest()
    clearInterpretation()
    setCurrentThreadSelection(focusSnapshot.text, focusSnapshot.rects, focusSnapshot.anchor, focusSnapshot.pageIndex)
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
    const focusSnapshot = currentThreadFocus()
    const fallbackPages = focusSnapshot.rects.length === 0 ? focusPageIndexes() : []
    const evidencePreview = makeLocalEvidence(focusSnapshot.rects, parsedPages, chunks, fallbackPages)
    setEvidence(evidencePreview)
    setAgentTrace([])
    setAnswerSource("local_fallback")
    setPhase("retrieving")
    const text = makeLocalInterpretation(
      focusSnapshot.text,
      focusSnapshot.rects,
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
    const focusSnapshot = currentThreadFocus()
    const fallbackPages = focusSnapshot.rects.length === 0 ? focusPageIndexes() : []
    const chunks = localFallbackChunks(indexedChunks)
    const evidencePreview = makeLocalEvidence(focusSnapshot.rects, parsedPages, chunks, fallbackPages)
    setEvidence(evidencePreview)
    setAgentTrace([])
    setAnswerSource("local_fallback")
    const answer = makeLocalFollowUpAnswer(
      question,
      focusSnapshot.text,
      parsedPages,
      focusSnapshot.rects,
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
    const focusSnapshot = currentThreadFocus()
    if (!bookId || libraryStatus !== "indexed" || !focusSnapshot.text || !answer.trim()) {
      return
    }

    try {
      const pageIndexes = focusPageIndexes()
      const pageIndex = pageIndexes[0] ?? focusSnapshot.pageIndex
      const preferredPositionStart =
        focusSnapshot.anchor?.pageIndex === pageIndex ? focusSnapshot.anchor.positionStart : null
      const selector = makeTextQuoteSelector(
        pageTextByIndex(parsedPages, pageIndex),
        focusSnapshot.text,
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
        selectionText: focusSnapshot.text,
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

  return {
    runLocalInterpretation,
    handleQuestionSubmit,
    handleCurrentThreadLightweightChange,
    handleStartComment,
    handleSaveCurrentNote,
  }
}

export type ReaderInterpretation = ReturnType<typeof useReaderInterpretation>
