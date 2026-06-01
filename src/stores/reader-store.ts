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

export type AnswerSource = "llm" | "local_fallback"

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
  setInterpretation: (interpretation) => set({ interpretation, interpretationError: "" }),
  setAnswerSource: (answerSource) => set({ answerSource }),
  setInterpretationError: (interpretationError) => set({ interpretationError }),
  setInterpretationSessionId: (interpretationSessionId) => set({ interpretationSessionId }),
  setHighlights: (highlights) => set({ highlights }),
  setInterpretationHistory: (interpretationHistory) => set({ interpretationHistory }),
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
      phase: "reading",
    }),
}))
