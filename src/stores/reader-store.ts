import { create } from "zustand"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { AgentTask } from "@/core/agent-task"
import { isCurrentTldrSourceVersion } from "@/core/tldr"

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

export type AnswerSource = "llm" | "local_fallback"
export type InterpretationKind = "interpretation" | "spark" | "note"

export type InterpretMode = "deep" | "plain" | "apply"
export type WorkbenchTab = "spark" | "tasks"

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
  /** 解读模式（deep/plain/apply），与 kind 正交；旧记录为 null/缺失。 */
  mode?: InterpretMode | null
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
  evidenceChunkIds?: string[]
  evidenceChunkSnapshots?: EvidenceChunkSnapshot[]
  createdAt: string
}

export type KnowledgeEvidence = {
  cardId: string
  bookId: string
  chunkId: string
  pageIndex?: number | null
  quote: string
  role: string
  contentHash?: string | null
  createdAt: string
}

export type KnowledgeCard = {
  cardId: string
  bookId: string
  cardType: string
  title: string
  summary: string
  bodyMarkdown: string
  payloadJson: string
  status: string
  source: string
  confidence: number
  sourceVersion: number
  userLocked: boolean
  createdAt: string
  updatedAt: string
  evidence: KnowledgeEvidence[]
  driftCount?: number
}

export type KnowledgeEdge = {
  edgeId: string
  bookId: string
  sourceCardId: string
  targetCardId: string
  edgeType: string
  label: string
  evidenceChunkIds: string[]
  source: string
  confidence: number
  status: string
  createdAt: string
  updatedAt: string
}

export type KnowledgeGraphNode = {
  cardId: string
  bookId: string
  cardType: string
  title: string
  summary: string
  status: string
  source: string
  confidence: number
  evidenceCount: number
  pageIndex?: number | null
  evidence: KnowledgeEvidence[]
}

export type KnowledgeGraph = {
  bookId: string
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeEdge[]
  builtAt?: string | null
}

export type BuildKnowledgeGraphResponse = {
  bookId: string
  cardCount: number
  edgeCount: number
  candidateCount: number
  builtAt: string
}

export type KnowledgeHealth = {
  bookId: string
  cardCount: number
  confirmedCount: number
  candidateCount: number
  rejectedCount: number
  driftCount: number
  edgeCount: number
  latestUpdatedAt?: string | null
}

export type KnowledgeDrift = {
  cardId: string
  title: string
  chunkId: string
  pageIndex?: number | null
  storedContentHash?: string | null
  currentContentHash?: string | null
  quote: string
}

export type KnowledgeMapLine = {
  lineId: string
  title: string
  pageStart: number
  pageEnd: number
  stationCount: number
}

export type KnowledgeMapStation = {
  stationId: string
  cardId: string
  lineId: string
  title: string
  cardType: string
  status: string
  pageIndex?: number | null
  timeRaw?: string | null
  timeNorm?: string | null
  timeOrder: number
  timeSource?: string | null
  people: string[]
  places: string[]
  evidence: KnowledgeEvidence[]
}

export type KnowledgeMapTransfer = {
  edgeId: string
  sourceStationId: string
  targetStationId: string
  edgeType: string
  label: string
  evidenceChunkIds: string[]
  confidence: number
  status: string
}

export type KnowledgeMap = {
  bookId: string
  lines: KnowledgeMapLine[]
  stations: KnowledgeMapStation[]
  transfers: KnowledgeMapTransfer[]
  builtAt?: string | null
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
  activeInterpretationSessionId: string
  workbenchTab: WorkbenchTab
  currentThreadLightweight: boolean
  currentThreadSelectionText: string
  currentThreadSelectionRects: NormalizedPageRect[]
  currentThreadSelectionAnchor: TextSelectionAnchor | null
  currentThreadPageIndex: number | null
  currentNoteDraft: string
  currentNoteOpen: boolean
  currentNoteSaving: boolean
  currentThreadError: string
  agentTasks: AgentTask[]
  highlights: SavedHighlight[]
  interpretationHistory: SavedInterpretation[]
  knowledgeCards: KnowledgeCard[]
  knowledgeGraph: KnowledgeGraph | null
  knowledgeHealth: KnowledgeHealth | null
  knowledgeDrift: KnowledgeDrift[]
  knowledgeMap: KnowledgeMap | null
  knowledgeLoading: boolean
  knowledgeGraphLoading: boolean
  knowledgeGraphBuilding: boolean
  knowledgeError: string
  tldr: DocumentTldrState | null
  tldrLoading: boolean
  tldrError: string
  tldrDismissed: boolean
  tldrLlmReady: boolean
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
  setActiveInterpretationSessionId: (sessionId: string) => void
  setWorkbenchTab: (tab: WorkbenchTab) => void
  setCurrentThreadLightweight: (lightweight: boolean) => void
  setCurrentThreadSelection: (
    text: string,
    rects: NormalizedPageRect[],
    anchor?: TextSelectionAnchor | null,
    pageIndex?: number | null,
  ) => void
  setCurrentNoteDraft: (draft: string) => void
  setCurrentNoteOpen: (open: boolean) => void
  setCurrentNoteSaving: (saving: boolean) => void
  setCurrentThreadError: (message: string) => void
  setAgentTasks: (tasks: AgentTask[]) => void
  upsertAgentTask: (task: AgentTask) => void
  setHighlights: (highlights: SavedHighlight[]) => void
  setInterpretationHistory: (history: SavedInterpretation[]) => void
  setKnowledgeCards: (cards: KnowledgeCard[]) => void
  setKnowledgeGraph: (graph: KnowledgeGraph | null) => void
  setKnowledgeHealth: (health: KnowledgeHealth | null) => void
  setKnowledgeDrift: (drift: KnowledgeDrift[]) => void
  setKnowledgeMap: (map: KnowledgeMap | null) => void
  setKnowledgeLoading: (loading: boolean) => void
  setKnowledgeGraphLoading: (loading: boolean) => void
  setKnowledgeGraphBuilding: (building: boolean) => void
  setKnowledgeError: (message: string) => void
  addKnowledgeCards: (cards: KnowledgeCard[]) => void
  setTldr: (tldr: DocumentTldrState | null) => void
  setTldrLoading: (loading: boolean) => void
  setTldrError: (message: string) => void
  setTldrDismissed: (dismissed: boolean) => void
  setTldrLlmReady: (ready: boolean) => void
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
  bookTitle: "未导入书籍",
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
  activeInterpretationSessionId: "",
  workbenchTab: "spark",
  currentThreadLightweight: false,
  currentThreadSelectionText: "",
  currentThreadSelectionRects: [],
  currentThreadSelectionAnchor: null,
  currentThreadPageIndex: null,
  currentNoteDraft: "",
  currentNoteOpen: false,
  currentNoteSaving: false,
  currentThreadError: "",
  agentTasks: [],
  highlights: [],
  interpretationHistory: [],
  knowledgeCards: [],
  knowledgeGraph: null,
  knowledgeHealth: null,
  knowledgeDrift: [],
  knowledgeMap: null,
  knowledgeLoading: false,
  knowledgeGraphLoading: false,
  knowledgeGraphBuilding: false,
  knowledgeError: "",
  tldr: null,
  tldrLoading: false,
  tldrError: "",
  tldrDismissed: false,
  tldrLlmReady: true,
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
      activeInterpretationSessionId: "",
      workbenchTab: "spark",
      currentThreadLightweight: false,
      currentThreadSelectionText: "",
      currentThreadSelectionRects: [],
      currentThreadSelectionAnchor: null,
      currentThreadPageIndex: null,
      currentNoteDraft: "",
      currentNoteOpen: false,
      currentNoteSaving: false,
      currentThreadError: "",
      agentTasks: [],
      highlights: [],
      interpretationHistory: [],
      knowledgeCards: [],
      knowledgeGraph: null,
      knowledgeHealth: null,
      knowledgeDrift: [],
      knowledgeMap: null,
      knowledgeLoading: false,
      knowledgeGraphLoading: false,
      knowledgeGraphBuilding: false,
      knowledgeError: "",
      tldr: null,
      tldrLoading: false,
      tldrError: "",
      tldrDismissed: false,
      tldrLlmReady: true,
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
      tldr:
        metadata?.tldrText?.trim() && isCurrentTldrSourceVersion(metadata.tldrSourceVersion)
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
      activeChunkId: "",
      phase: "reading",
    }),
  setVisiblePage: (currentPage) => set({ currentPage }),
  setZoom: (zoom) => set({ zoom }),
  setSelection: (selectionText, selectionRects, selectionAnchor = null) =>
    set((state) => ({
      selectionText,
      selectionRects,
      selectionAnchor,
      currentThreadSelectionText: selectionText,
      currentThreadSelectionRects: selectionRects,
      currentThreadSelectionAnchor: selectionAnchor,
      currentThreadPageIndex:
        selectionAnchor?.pageIndex ?? selectionRects[0]?.pageIndex ?? Math.max(0, state.currentPage - 1),
      evidence: [],
      agentTrace: [],
      interpretation: "",
      answerSource: "llm",
      interpretationError: "",
      followUps: [],
      activeInterpretationSessionId: "",
      activeChunkId: "",
      workbenchTab: "spark",
      currentNoteDraft: "",
      currentNoteOpen: false,
      currentThreadError: "",
      currentThreadLightweight: false,
      phase: "reading",
    })),
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
            currentThreadSelectionText: selectionText,
            currentThreadSelectionRects: selectionRects,
            currentThreadSelectionAnchor: null,
            currentThreadPageIndex: selectionRects[0]?.pageIndex ?? Math.max(0, currentPage - 1),
            evidence: [],
            agentTrace: [],
            interpretation: "",
            answerSource: "llm",
            interpretationError: "",
            followUps: [],
            activeInterpretationSessionId: "",
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
  setActiveInterpretationSessionId: (activeInterpretationSessionId) =>
    set({ activeInterpretationSessionId }),
  setWorkbenchTab: (workbenchTab) => set({ workbenchTab }),
  setCurrentThreadLightweight: (currentThreadLightweight) => set({ currentThreadLightweight }),
  setCurrentThreadSelection: (
    currentThreadSelectionText,
    currentThreadSelectionRects,
    currentThreadSelectionAnchor = null,
    currentThreadPageIndex = null,
  ) =>
    set({
      currentThreadSelectionText,
      currentThreadSelectionRects,
      currentThreadSelectionAnchor,
      currentThreadPageIndex,
    }),
  setCurrentNoteDraft: (currentNoteDraft) => set({ currentNoteDraft }),
  setCurrentNoteOpen: (currentNoteOpen) => set({ currentNoteOpen }),
  setCurrentNoteSaving: (currentNoteSaving) => set({ currentNoteSaving }),
  setCurrentThreadError: (currentThreadError) => set({ currentThreadError }),
  setAgentTasks: (agentTasks) => set({ agentTasks }),
  upsertAgentTask: (task) =>
    set((state) => ({
      agentTasks: [
        task,
        ...state.agentTasks.filter((candidate) => candidate.id !== task.id),
      ].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    })),
  setHighlights: (highlights) => set({ highlights }),
  setInterpretationHistory: (interpretationHistory) => set({ interpretationHistory }),
  setKnowledgeCards: (knowledgeCards) => set({ knowledgeCards, knowledgeError: "", knowledgeLoading: false }),
  setKnowledgeGraph: (knowledgeGraph) =>
    set({ knowledgeGraph, knowledgeError: "", knowledgeGraphLoading: false, knowledgeGraphBuilding: false }),
  setKnowledgeHealth: (knowledgeHealth) => set({ knowledgeHealth }),
  setKnowledgeDrift: (knowledgeDrift) => set({ knowledgeDrift }),
  setKnowledgeMap: (knowledgeMap) => set({ knowledgeMap }),
  setKnowledgeLoading: (knowledgeLoading) => set({ knowledgeLoading }),
  setKnowledgeGraphLoading: (knowledgeGraphLoading) => set({ knowledgeGraphLoading }),
  setKnowledgeGraphBuilding: (knowledgeGraphBuilding) => set({ knowledgeGraphBuilding }),
  setKnowledgeError: (knowledgeError) =>
    set({
      knowledgeError,
      knowledgeLoading: false,
      knowledgeGraphLoading: false,
      knowledgeGraphBuilding: false,
    }),
  addKnowledgeCards: (cards) =>
    set((state) => {
      const next = new Map(state.knowledgeCards.map((card) => [card.cardId, card]))
      for (const card of cards) {
        next.set(card.cardId, card)
      }
      return {
        knowledgeCards: [...next.values()].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
        knowledgeError: "",
      }
    }),
  setTldr: (tldr) => set({ tldr, tldrError: "", tldrLoading: false, tldrDismissed: false }),
  setTldrLoading: (tldrLoading) => set({ tldrLoading }),
  setTldrError: (tldrError) => set({ tldrError, tldrLoading: false }),
  setTldrDismissed: (tldrDismissed) => set({ tldrDismissed }),
  setTldrLlmReady: (tldrLlmReady) => set({ tldrLlmReady }),
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
      activeInterpretationSessionId: "",
      activeChunkId: "",
      currentNoteDraft: "",
      currentNoteOpen: false,
      currentThreadError: "",
      currentThreadLightweight: false,
      phase: "reading",
    }),
  clearSelection: () =>
    set((state) => {
      const hasThreadContent =
        state.interpretation.trim().length > 0 ||
        state.followUps.length > 0 ||
        state.activeInterpretationSessionId.trim().length > 0 ||
        state.currentNoteDraft.trim().length > 0 ||
        state.currentNoteOpen
      return {
        selectionText: "",
        selectionRects: [],
        selectionAnchor: null,
        activeChunkId: "",
        currentThreadError: "",
        ...(hasThreadContent
          ? {}
          : {
              currentThreadSelectionText: "",
              currentThreadSelectionRects: [],
              currentThreadSelectionAnchor: null,
              currentThreadPageIndex: null,
              currentThreadLightweight: false,
            }),
        phase: "reading",
      }
    }),
}))

function buildLoadedPagesText(pages: ParsedPage[], key: "text" | "markdown") {
  return pages
    .filter((page) => page.loaded !== false && page[key].trim())
    .map((page) => page[key])
    .join("\n\n")
}
