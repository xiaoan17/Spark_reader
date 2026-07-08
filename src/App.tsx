import { ReaderShell } from "@/components/reader/ReaderShell"
import { useReaderStore } from "@/stores/reader-store"
import { inferTextSelectionAnchor } from "@/core/selection-anchor"
import { createSampleBook } from "@/core/sample-book"
import { useReaderRequestLifecycle } from "@/components/reader/use-reader-request-lifecycle"
import { useReaderFocus } from "@/components/reader/use-reader-focus"
import { useReaderKnowledge } from "@/components/reader/use-reader-knowledge"
import { useReaderTldr } from "@/components/reader/use-reader-tldr"
import { useReaderAgentTasks } from "@/components/reader/use-reader-agent-tasks"
import { useReaderHighlights } from "@/components/reader/use-reader-highlights"
import { useReaderInterpretation } from "@/components/reader/use-reader-interpretation"
import type { TextSelectionAnchor } from "@/stores/reader-store"

export function App() {
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
    workbenchTab,
    currentThreadLightweight,
    currentThreadSelectionText,
    currentThreadSelectionRects,
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
    setAnswerSource,
    setInterpretation,
    setInterpretationError,
    setWorkbenchTab,
    setCurrentNoteDraft,
    setFollowUps,
    clearSelection,
    setActiveChunk,
    focusChunk,
    setParsedDocument,
    mergeParsedDocumentWindow,
  } = useReaderStore()

  const lifecycle = useReaderRequestLifecycle()
  const { stopActiveRequest } = lifecycle
  const focus = useReaderFocus()
  const knowledge = useReaderKnowledge()
  const { ensureTldr } = useReaderTldr()
  const agentTaskHandlers = useReaderAgentTasks({
    persistAgentTaskCards: knowledge.persistAgentTaskCards,
  })
  const highlightHandlers = useReaderHighlights({
    stopActiveRequest,
    focus,
    refreshKnowledge: knowledge.refreshKnowledge,
  })
  const interpretationHandlers = useReaderInterpretation({
    lifecycle,
    focus,
    refreshKnowledge: knowledge.refreshKnowledge,
  })

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

  const citationChunkIds = [
    ...new Set([
      ...parsedChunks.map((chunk) => chunk.chunkId),
      ...evidence.map((item) => item.chunkId),
    ]),
  ]

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
          void highlightHandlers.loadHighlights(indexedBookId)
          void highlightHandlers.loadInterpretationHistory(indexedBookId)
          knowledge.refreshKnowledge(indexedBookId)
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
      onDeepInterpret={() => interpretationHandlers.runLocalInterpretation("deep", false)}
      onPlainExplain={() => interpretationHandlers.runLocalInterpretation("plain", true)}
      onComment={interpretationHandlers.handleStartComment}
      onQuestionSubmit={interpretationHandlers.handleQuestionSubmit}
      onWorkbenchTabChange={setWorkbenchTab}
      onCurrentThreadLightweightChange={interpretationHandlers.handleCurrentThreadLightweightChange}
      onCurrentNoteChange={setCurrentNoteDraft}
      onCurrentNoteSave={() => void interpretationHandlers.handleSaveCurrentNote()}
      onRunAgentTask={(kind, prompt) => void agentTaskHandlers.handleRunAgentTask(kind, prompt)}
      onStopAgentTask={agentTaskHandlers.handleStopAgentTask}
      onGenerateTldr={() => void ensureTldr(bookId, { manual: true })}
      onRegenerateTldr={() => void ensureTldr(bookId, { force: true, manual: true })}
      onSaveHighlight={highlightHandlers.handleSaveHighlight}
      onOpenHighlight={highlightHandlers.handleOpenHighlight}
      onDeleteHighlight={highlightHandlers.handleDeleteHighlight}
      onOpenInterpretation={highlightHandlers.handleOpenInterpretation}
      onOpenSparkInterpretation={highlightHandlers.handleOpenSparkInterpretation}
      onDeleteInterpretation={highlightHandlers.handleDeleteInterpretation}
      onCitationClick={highlightHandlers.handleCitationClick}
      onRefreshKnowledge={() => {
        if (bookId) {
          knowledge.refreshKnowledge(bookId)
        }
      }}
      onBuildKnowledge={() => void knowledge.handleBuildKnowledge()}
      onExportKnowledge={() => void knowledge.handleExportKnowledgeMarkdown()}
      onExportKnowledgeJson={() => void knowledge.handleExportKnowledgeJson()}
      onConfirmKnowledgeCard={(cardId) => void knowledge.handleConfirmKnowledgeCard(cardId)}
      onRejectKnowledgeCard={(cardId) => void knowledge.handleRejectKnowledgeCard(cardId)}
      onDeleteKnowledgeCard={(cardId) => void knowledge.handleDeleteKnowledgeCard(cardId)}
      onSaveKnowledgeCard={(request) => void knowledge.handleSaveKnowledgeCard(request)}
      onRegenerate={() =>
        interpretationHandlers.runLocalInterpretation(
          currentThreadLightweight ? "plain" : "deep",
          currentThreadLightweight,
        )
      }
      onStop={handleStop}
      onOpenSampleBook={handleOpenSampleBook}
    />
  )
}
