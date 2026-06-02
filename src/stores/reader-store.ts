import { create } from "zustand"
import type { NormalizedPageRect } from "@/core/coordinates"

export type ReaderPhase = "empty" | "reading" | "planning" | "retrieving" | "streaming" | "error"

export type LibraryStatus = "idle" | "saving" | "indexed" | "memory-only" | "error"

export type TextQuality = {
  charCount: number
  replacementCharRatio: number
  controlCharRatio: number
  looksUsable: boolean
}

export type TextAssetMetadata = {
  parserEngine: string
  coordinateMode: string
  quality?: TextQuality | null
  textPath?: string
  markdownPath?: string
  originalPdfPath?: string
  sourcePdfPath?: string
  sourcePdfFingerprint?: string
  tldrText?: string | null
  tldrGeneratedAt?: string | null
  tldrModel?: string | null
  tldrSourceVersion?: number | null
}

export type EvidencePreview = {
  chunkId: string
  title: string
  pageIndex: number
}

export type AgentTraceStep = {
  phase: "plan" | "retrieve" | "iterate" | "synthesize"
  query?: string | null
  chunkIds: string[]
  note: string
}

export type FollowUpTurn = {
  id: string
  question: string
  answer: string
}

export type SparkMode = "spark" | "note"

export type AnswerSource = "llm" | "local_fallback"
export type InterpretationKind = "interpretation" | "spark" | "note"

export type DocumentTldrState = {
  text: string
  generatedAt: string
  model: string
  sourceVersion: number
}

export type EvidenceChunkSnapshot = {
  chunkId: string
  chunkIdVersion: number
  contentHash?: string | null
}

export type SavedInterpretation = {
  id: string
  bookId: string
  selectionText: string
  sessionId: string
  turnIndex: number
  prefix?: string
  suffix?: string
  pageIndex?: number | null
  positionStart?: number | null
  positionEnd?: number | null
  pageIndexes: number[]
  evidenceChunkIds: string[]
  question?: string | null
  answer: string
  answerSource?: AnswerSource
  kind?: InterpretationKind
  evidenceChunkSnapshots?: EvidenceChunkSnapshot[]
  createdAt: string
}

export type SavedHighlight = {
  id: string
  bookId: string
  selectionText: string
  prefix: string
  suffix: string
  pageIndex?: number | null
  positionStart?: number | null
  positionEnd?: number | null
  rects: NormalizedPageRect[]
  coordinateVersion?: number
  interpretation?: string | null
  createdAt: string
}

export type ParsedPage = {
  pageIndex: number
  text: string
  markdown: string
  loaded?: boolean
}

export type ParsedChunk = {
  chunkId: string
  pageIndex: number
  text: string
  markdown: string
  rects: NormalizedPageRect[]
  coordinateVersion?: number
}

export type TextSelectionAnchor = {
  pageIndex: number
  positionStart: number
  positionEnd: number
}

type ReaderState = {
  phase: ReaderPhase
  bookTitle: string
  bookId: string
  libraryStatus: LibraryStatus
  libraryMessage: string
  currentPage: number
  totalPages: number
  zoom: number
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  evidence: EvidencePreview[]
  agentTrace: AgentTraceStep[]
  interpretation: string
  answerSource: AnswerSource
  interpretationError: string
  followUps: FollowUpTurn[]
  interpretationSessionId: string
  highlights: SavedHighlight[]
  interpretationHistory: SavedInterpretation[]
  tldr: DocumentTldrState | null
  tldrLoading: boolean
  tldrError: string
  tldrDismissed: boolean
  tldrLlmReady: boolean
  activeSparkSessionId: string
  sparkMode: SparkMode
  sparkDraft: string
  sparkQuestion: string
  sparkError: string
  parsedPages: ParsedPage[]
  parsedChunks: ParsedChunk[]
  parsedText: string
  parsedMarkdown: string
  parserEngine: string
  coordinateMode: string
  activeChunkId: string
  textQuality?: TextQuality | null
  setPhase: (phase: ReaderPhase) => void
  setBook: (title: string, totalPages: number) => void
  setLibraryStatus: (status: LibraryStatus, message?: string, bookId?: string) => void
  setParsedDocument: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text: string,
    markdown: string,
    metadata?: TextAssetMetadata | null,
  ) => void
  mergeParsedDocumentWindow: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text?: string,
    markdown?: string,
  ) => void
  setCurrentPage: (page: number) => void
  setVisiblePage: (page: number) => void
  setZoom: (zoom: number) => void
  setSelection: (text: string, rects: NormalizedPageRect[], anchor?: TextSelectionAnchor | null) => void
  setActiveChunk: (chunkId: string) => void
  focusChunk: (
    page: number,
    chunkId: string,
    text: string,
    rects: NormalizedPageRect[],
    preserveInterpretation?: boolean,
  ) => void
  setEvidence: (evidence: EvidencePreview[]) => void
  setAgentTrace: (agentTrace: AgentTraceStep[]) => void
  setInterpretation: (interpretation: string) => void
  setAnswerSource: (answerSource: AnswerSource) => void
  setInterpretationError: (message: string) => void
  setInterpretationSessionId: (sessionId: string) => void
  setHighlights: (highlights: SavedHighlight[]) => void
  setInterpretationHistory: (history: SavedInterpretation[]) => void
  setTldr: (tldr: DocumentTldrState | null) => void
  setTldrLoading: (loading: boolean) => void
  setTldrError: (message: string) => void
  setTldrDismissed: (dismissed: boolean) => void
  setTldrLlmReady: (ready: boolean) => void
  setActiveSparkSessionId: (sessionId: string) => void
  setSparkMode: (mode: SparkMode) => void
  setSparkDraft: (draft: string) => void
  setSparkQuestion: (question: string) => void
  setSparkError: (message: string) => void
  setFollowUps: (followUps: FollowUpTurn[]) => void
  addInterpretationHistory: (item: SavedInterpretation) => void
  addHighlight: (highlight: SavedHighlight) => void
  removeHighlight: (highlightId: string) => void
  removeInterpretationHistory: (interpretationId: string) => void
  addFollowUp: (question: string, answer: string) => void
  clearInterpretation: () => void
  clearSelection: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  phase: "empty",
  bookTitle: "未导入 PDF",
  bookId: "",
  libraryStatus: "idle",
  libraryMessage: "",
  currentPage: 1,
  totalPages: 0,
  zoom: 1,
  selectionText: "",
  selectionRects: [],
  selectionAnchor: null,
  evidence: [],
  agentTrace: [],
  interpretation: "",
  answerSource: "llm",
  interpretationError: "",
  followUps: [],
  interpretationSessionId: "",
  highlights: [],
  interpretationHistory: [],
  tldr: null,
  tldrLoading: false,
  tldrError: "",
  tldrDismissed: false,
  tldrLlmReady: true,
  activeSparkSessionId: "",
  sparkMode: "spark",
  sparkDraft: "",
  sparkQuestion: "",
  sparkError: "",
  parsedPages: [],
  parsedChunks: [],
  parsedText: "",
  parsedMarkdown: "",
  parserEngine: "",
  coordinateMode: "",
  activeChunkId: "",
  textQuality: null,
  setPhase: (phase) => set({ phase }),
  setBook: (bookTitle, totalPages) =>
    set({
      bookTitle,
      totalPages,
      currentPage: totalPages > 0 ? 1 : 0,
      bookId: "",
      libraryStatus: "idle",
      libraryMessage: "",
      phase: totalPages > 0 ? "reading" : "empty",
      selectionText: "",
      selectionRects: [],
      selectionAnchor: null,
      evidence: [],
      agentTrace: [],
      interpretation: "",
      answerSource: "llm",
      interpretationError: "",
      followUps: [],
      interpretationSessionId: "",
      highlights: [],
      interpretationHistory: [],
      tldr: null,
      tldrLoading: false,
      tldrError: "",
      tldrDismissed: false,
      tldrLlmReady: true,
      activeSparkSessionId: "",
      sparkMode: "spark",
      sparkDraft: "",
      sparkQuestion: "",
      sparkError: "",
      parsedPages: [],
      parsedChunks: [],
      parsedText: "",
      parsedMarkdown: "",
      parserEngine: "",
      coordinateMode: "",
      activeChunkId: "",
      textQuality: null,
    }),
  setLibraryStatus: (libraryStatus, libraryMessage = "", bookId) =>
    set((state) => ({
      libraryStatus,
      libraryMessage,
      bookId: bookId ?? state.bookId,
    })),
  setParsedDocument: (parsedPages, parsedChunks, parsedText, parsedMarkdown, metadata) =>
    set({
      parsedPages,
      parsedChunks,
      parsedText,
      parsedMarkdown,
      parserEngine: metadata?.parserEngine ?? "unknown",
      coordinateMode: metadata?.coordinateMode ?? "text-only",
      activeChunkId: "",
      textQuality: metadata?.quality ?? null,
      tldr: metadata?.tldrText?.trim()
        ? {
            text: metadata.tldrText,
            generatedAt: metadata.tldrGeneratedAt ?? "",
            model: metadata.tldrModel ?? "",
            sourceVersion: metadata.tldrSourceVersion ?? 0,
          }
        : null,
      tldrLoading: false,
      tldrError: "",
      tldrDismissed: false,
    }),
  mergeParsedDocumentWindow: (pages, chunks, text = "", markdown = "") =>
    set((state) => {
      const pageMap = new Map(state.parsedPages.map((page) => [page.pageIndex, page]))
      for (const page of pages) {
        pageMap.set(page.pageIndex, { ...page, loaded: page.loaded ?? true })
      }
      const chunkMap = new Map(state.parsedChunks.map((chunk) => [chunk.chunkId, chunk]))
      for (const chunk of chunks) {
        chunkMap.set(chunk.chunkId, chunk)
      }
      const nextPages = [...pageMap.values()].sort((left, right) => left.pageIndex - right.pageIndex)
      return {
        parsedPages: nextPages,
        parsedChunks: [...chunkMap.values()].sort(
          (left, right) => left.pageIndex - right.pageIndex || left.chunkId.localeCompare(right.chunkId),
        ),
        parsedText: buildLoadedPagesText(nextPages, "text"),
        parsedMarkdown: buildLoadedPagesText(nextPages, "markdown"),
      }
    }),
  setCurrentPage: (currentPage) =>
    set({
      currentPage,
      selectionText: "",
      selectionRects: [],
      selectionAnchor: null,
      evidence: [],
      agentTrace: [],
      interpretation: "",
      answerSource: "llm",
      interpretationError: "",
      followUps: [],
      interpretationSessionId: "",
      activeChunkId: "",
      activeSparkSessionId: "",
      sparkDraft: "",
      sparkQuestion: "",
      sparkError: "",
      phase: "reading",
    }),
  setVisiblePage: (currentPage) => set({ currentPage }),
  setZoom: (zoom) => set({ zoom }),
  setSelection: (selectionText, selectionRects, selectionAnchor = null) =>
    set({
      selectionText,
      selectionRects,
      selectionAnchor,
      evidence: [],
      agentTrace: [],
      interpretation: "",
      answerSource: "llm",
      interpretationError: "",
      followUps: [],
      interpretationSessionId: "",
      activeChunkId: "",
      activeSparkSessionId: "",
      sparkDraft: "",
      sparkQuestion: "",
      sparkError: "",
      phase: "reading",
    }),
  setActiveChunk: (activeChunkId) => set({ activeChunkId }),
  focusChunk: (
    currentPage,
    activeChunkId,
    selectionText,
    selectionRects,
    preserveInterpretation = false,
  ) =>
    set({
      currentPage,
      activeChunkId,
      ...(preserveInterpretation
        ? {}
        : {
            selectionText,
            selectionRects,
            selectionAnchor: null,
            evidence: [],
            agentTrace: [],
            interpretation: "",
            answerSource: "llm",
            interpretationError: "",
            followUps: [],
            interpretationSessionId: "",
          }),
      phase: "reading",
    }),
  setEvidence: (evidence) => set({ evidence }),
  setAgentTrace: (agentTrace) => set({ agentTrace }),
  setInterpretation: (interpretation) =>
    set((state) => ({
      interpretation,
      interpretationError: state.answerSource === "local_fallback" ? state.interpretationError : "",
    })),
  setAnswerSource: (answerSource) =>
    set((state) => ({
      answerSource,
      interpretationError: answerSource === "llm" ? "" : state.interpretationError,
    })),
  setInterpretationError: (interpretationError) => set({ interpretationError }),
  setInterpretationSessionId: (interpretationSessionId) => set({ interpretationSessionId }),
  setHighlights: (highlights) => set({ highlights }),
  setInterpretationHistory: (interpretationHistory) => set({ interpretationHistory }),
  setTldr: (tldr) => set({ tldr, tldrError: "", tldrLoading: false, tldrDismissed: false }),
  setTldrLoading: (tldrLoading) => set({ tldrLoading }),
  setTldrError: (tldrError) => set({ tldrError, tldrLoading: false }),
  setTldrDismissed: (tldrDismissed) => set({ tldrDismissed }),
  setTldrLlmReady: (tldrLlmReady) => set({ tldrLlmReady }),
  setActiveSparkSessionId: (activeSparkSessionId) => set({ activeSparkSessionId }),
  setSparkMode: (sparkMode) => set({ sparkMode }),
  setSparkDraft: (sparkDraft) => set({ sparkDraft }),
  setSparkQuestion: (sparkQuestion) => set({ sparkQuestion }),
  setSparkError: (sparkError) => set({ sparkError }),
  setFollowUps: (followUps) => set({ followUps }),
  addInterpretationHistory: (item) =>
    set((state) => ({
      interpretationHistory: [
        item,
        ...state.interpretationHistory.filter((historyItem) => historyItem.id !== item.id),
      ],
    })),
  addHighlight: (highlight) =>
    set((state) => ({
      highlights: [highlight, ...state.highlights.filter((item) => item.id !== highlight.id)],
    })),
  removeHighlight: (highlightId) =>
    set((state) => ({
      highlights: state.highlights.filter((item) => item.id !== highlightId),
    })),
  removeInterpretationHistory: (interpretationId) =>
    set((state) => ({
      interpretationHistory: state.interpretationHistory.filter((item) => {
        const target = state.interpretationHistory.find((historyItem) => historyItem.id === interpretationId)
        return item.id !== interpretationId && (!target || item.sessionId !== target.sessionId)
      }),
    })),
  addFollowUp: (question, answer) =>
    set((state) => ({
      followUps: [
        ...state.followUps,
        {
          id: `${Date.now()}-${state.followUps.length}`,
          question,
          answer,
        },
      ],
    })),
  clearInterpretation: () =>
    set({
      evidence: [],
      agentTrace: [],
      interpretation: "",
      answerSource: "llm",
      interpretationError: "",
      followUps: [],
      interpretationSessionId: "",
      activeChunkId: "",
      activeSparkSessionId: "",
      sparkDraft: "",
      sparkQuestion: "",
      sparkError: "",
      phase: "reading",
    }),
  clearSelection: () =>
    set({
      selectionText: "",
      selectionRects: [],
      selectionAnchor: null,
      evidence: [],
      agentTrace: [],
      interpretation: "",
      answerSource: "llm",
      interpretationError: "",
      followUps: [],
      interpretationSessionId: "",
      activeChunkId: "",
      activeSparkSessionId: "",
      sparkDraft: "",
      sparkQuestion: "",
      sparkError: "",
      phase: "reading",
    }),
}))

function buildLoadedPagesText(pages: ParsedPage[], key: "text" | "markdown") {
  return pages
    .filter((page) => page.loaded !== false && page[key].trim())
    .map((page) => page[key])
    .join("\n\n")
}
