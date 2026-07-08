import {
  BookOpen,
  FileText,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react"
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import { KnowledgePanel } from "@/components/knowledge/KnowledgePanel"
import { TldrReader } from "@/components/reader/TldrReader"
import { LlmSettingsPanel } from "@/components/settings/LlmSettingsPanel"
import { ObsidianSettingsPanel } from "@/components/settings/ObsidianSettingsPanel"
import { pageTextByIndex } from "@/core/page-lookup"
import { replaceInternalCitationsWithReadableLabels } from "@/core/citation-display"
import { PdfDocumentViewer } from "./PdfCanvasPage"
import type {
  EvidencePreview,
  FollowUpTurn,
  AgentTraceStep,
  LibraryStatus,
  KnowledgeCard,
  KnowledgeGraph,
  KnowledgeHealth,
  KnowledgeDrift,
  KnowledgeMap,
  ParsedChunk,
  ParsedPage,
  ReaderPhase,
  SavedHighlight,
  SavedInterpretation,
  TextSelectionAnchor,
  TextAssetMetadata,
  TextQuality,
  AnswerSource,
  DocumentTldrState,
  WorkbenchTab,
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { AgentTask, AgentTaskKind } from "@/core/agent-task"
import { searchParsedChunks, searchParsedPages } from "@/core/local-interpreter"
import { formatInterpretationClipboardText } from "./interpretation-clipboard"
import {
  textSelectionAnchorFromOffsets,
} from "./text-selection-anchor"
import { highlightSaveFeedback } from "./highlight-save-feedback"
import {
  buildReaderOutline,
  type ReaderOutlineEntry,
} from "./reader-outline"
import {
  ConvertedTextReader,
  type ConvertedTextOutlineTarget,
} from "./ConvertedTextReader"
import { TranslationReader } from "./TranslationReader"
import { ImportChoicePanel } from "./ImportChoicePanel"
import { LibraryShelf } from "./LibraryShelf"
import { OnboardingFlow } from "./OnboardingFlow"
import { ReaderTopBar } from "./ReaderTopBar"
import { ReaderSidebar } from "./ReaderSidebar"
import { AiWorkbench } from "./AiWorkbench"
import { ZoteroImportPanel } from "./ZoteroImportPanel"
import type { ReaderView } from "./highlight-target-view"
import {
  browserLibraryAvailable,
} from "@/core/browser-library"
import {
  isTauriRuntime,
  type ConvertedBookAsset,
  type LlmProviderKind,
  type UpsertKnowledgeCardRequest,
} from "@/core/library-api"
import { readerChunkSearchResults } from "./search-results"
import { bookHasPdfParser, tldrMetadataFromAsset } from "./stored-book-asset"
import { useReaderPageNavigation } from "./page-navigation"
import { useReaderViewMemory } from "./reader-view-memory"
import { useReaderTranslation } from "./use-reader-translation"
import { useReaderPdf } from "./use-reader-pdf"
import { useReaderImport } from "./use-reader-import"
import { useReaderLibrary } from "./use-reader-library"
import { useReaderSearch } from "./use-reader-search"
import { useReaderShortcuts } from "./use-reader-shortcuts"
import { useAppMenu } from "./use-app-menu"
import { useLlmSettings } from "./use-llm-settings"
import { useObsidianSettings } from "./use-obsidian-settings"
import { useReaderPanels } from "./reader-panels"
import { friendlyImportErrorMessage } from "./import-errors"
import {
  readerLayoutColumns,
  readerViewConfigs,
  type ReaderViewConfig,
} from "./reader-view-config"
import {
  READER_DISPLAY_THEME_STORAGE_KEY,
  normalizeReaderDisplayThemeId,
  readerDisplayThemeById,
  readerDisplayThemeOptions,
  readerDisplayThemeStyle,
  type ReaderDisplayThemeId,
} from "./reader-display-theme"

const STORED_BOOK_INITIAL_PAGE_WINDOW = 48
const ONBOARDING_SEEN_STORAGE_KEY = "focused-reading.onboarding.seen.v1"

const llmProviderLabels: Record<LlmProviderKind, string> = {
  deep_seek: "DeepSeek",
  open_ai: "OpenAI",
  anthropic: "Anthropic",
}

function readInitialReaderDisplayThemeId(): ReaderDisplayThemeId {
  try {
    return normalizeReaderDisplayThemeId(
      window.localStorage.getItem(READER_DISPLAY_THEME_STORAGE_KEY),
    )
  } catch {
    return "spark-paper"
  }
}

type ReaderShellProps = {
  phase: ReaderPhase
  bookId: string
  libraryStatus: LibraryStatus
  libraryMessage: string
  bookTitle: string
  currentPage: number
  totalPages: number
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  evidence: EvidencePreview[]
  citationChunkIds?: string[]
  agentTrace: AgentTraceStep[]
  interpretation: string
  answerSource?: AnswerSource
  interpretationError?: string
  followUps: FollowUpTurn[]
  tldr?: DocumentTldrState | null
  tldrLoading?: boolean
  tldrError?: string
  tldrLlmReady?: boolean
  workbenchTab?: WorkbenchTab
  workbenchRunningTaskCount?: number
  currentThreadLightweight?: boolean
  currentThreadSelectionText?: string
  currentThreadSelectionRects?: NormalizedPageRect[]
  currentNoteDraft?: string
  currentNoteOpen?: boolean
  currentNoteSaving?: boolean
  currentThreadError?: string
  agentTasks?: AgentTask[]
  highlights: SavedHighlight[]
  interpretationHistory: SavedInterpretation[]
  knowledgeCards?: KnowledgeCard[]
  knowledgeGraph?: KnowledgeGraph | null
  knowledgeHealth?: KnowledgeHealth | null
  knowledgeDrift?: KnowledgeDrift[]
  knowledgeMap?: KnowledgeMap | null
  knowledgeLoading?: boolean
  knowledgeGraphLoading?: boolean
  knowledgeGraphBuilding?: boolean
  knowledgeError?: string
  parsedPages: ParsedPage[]
  parsedChunks: ParsedChunk[]
  parserEngine: string
  coordinateMode: string
  activeChunkId: string
  textQuality?: TextQuality | null
  zoom: number
  onBookLoaded: (title: string, totalPages: number) => void
  onLibraryStatus: (status: LibraryStatus, message?: string, bookId?: string) => void
  onParsedDocument: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text: string,
    markdown: string,
    metadata?: TextAssetMetadata | null,
  ) => void
  onParsedDocumentWindow?: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text: string,
    markdown: string,
  ) => void
  onPageChange: (page: number) => void
  onVisiblePageChange: (page: number) => void
  onZoomChange: (zoom: number) => void
  onSelection: (
    text: string,
    rects: NormalizedPageRect[],
    anchor?: TextSelectionAnchor | null,
  ) => void
  onClearSelection?: () => void
  onActiveChunk: (chunkId: string) => void
  onChunkFocus: (
    page: number,
    chunkId: string,
    text: string,
    rects: NormalizedPageRect[],
    preserveInterpretation?: boolean,
  ) => void
  onPhaseChange: (phase: ReaderPhase) => void
  onDeepInterpret: () => void
  onPlainExplain: () => void
  onComment?: () => void
  onQuestionSubmit: (question: string) => void
  onWorkbenchTabChange?: (tab: WorkbenchTab) => void
  onCurrentThreadLightweightChange?: (enabled: boolean) => void
  onCurrentNoteChange?: (note: string) => void
  onCurrentNoteSave?: () => void
  onRunAgentTask?: (kind: AgentTaskKind, prompt?: string) => void
  onStopAgentTask?: (taskId: string) => void
  onGenerateTldr?: () => void
  onRegenerateTldr?: () => void
  onSaveHighlight: () => Promise<boolean>
  onOpenHighlight: (highlight: SavedHighlight) => void
  onDeleteHighlight: (highlightId: string) => void
  onOpenInterpretation: (item: SavedInterpretation) => void
  onOpenSparkInterpretation?: (item: SavedInterpretation, sourceView?: "text" | "translation") => void
  onDeleteInterpretation: (interpretationId: string) => void
  onCitationClick?: (chunkId: string) => void
  onRefreshKnowledge?: () => void
  onBuildKnowledge?: () => void
  onExportKnowledge?: () => void
  onExportKnowledgeJson?: () => void
  onConfirmKnowledgeCard?: (cardId: string) => void
  onRejectKnowledgeCard?: (cardId: string) => void
  onDeleteKnowledgeCard?: (cardId: string) => void
  onSaveKnowledgeCard?: (request: Omit<UpsertKnowledgeCardRequest, "bookId">) => void
  onRegenerate: () => void
  onStop: () => void
  onOpenSampleBook?: () => void
}

export function ReaderShell({
  phase,
  bookId,
  libraryStatus,
  libraryMessage: _libraryMessage,
  bookTitle,
  currentPage,
  totalPages,
  selectionText,
  selectionRects,
  selectionAnchor,
  evidence,
  citationChunkIds,
  agentTrace,
  interpretation,
  answerSource = "llm",
  interpretationError = "",
  followUps,
  tldr = null,
  tldrLoading = false,
  tldrError = "",
  tldrLlmReady = true,
  workbenchTab = "spark",
  workbenchRunningTaskCount = 0,
  currentThreadLightweight = false,
  currentThreadSelectionText,
  currentThreadSelectionRects,
  currentNoteDraft = "",
  currentNoteOpen = false,
  currentNoteSaving = false,
  currentThreadError = "",
  agentTasks = [],
  highlights,
  interpretationHistory,
  knowledgeCards = [],
  knowledgeGraph = null,
  knowledgeHealth = null,
  knowledgeDrift = [],
  knowledgeMap = null,
  knowledgeLoading = false,
  knowledgeGraphLoading = false,
  knowledgeGraphBuilding = false,
  knowledgeError = "",
  parsedPages,
  parsedChunks,
  parserEngine,
  coordinateMode,
  activeChunkId,
  textQuality,
  zoom,
  onBookLoaded,
  onLibraryStatus,
  onParsedDocument,
  onParsedDocumentWindow = () => undefined,
  onPageChange,
  onVisiblePageChange,
  onZoomChange,
  onSelection,
  onClearSelection = () => undefined,
  onActiveChunk,
  onChunkFocus,
  onPhaseChange,
  onDeepInterpret,
  onPlainExplain,
  onComment = () => undefined,
  onQuestionSubmit,
  onWorkbenchTabChange = () => undefined,
  onCurrentThreadLightweightChange = () => undefined,
  onCurrentNoteChange = () => undefined,
  onCurrentNoteSave = () => undefined,
  onRunAgentTask = () => undefined,
  onStopAgentTask = () => undefined,
  onGenerateTldr = () => undefined,
  onRegenerateTldr = () => undefined,
  onSaveHighlight,
  onOpenHighlight: _onOpenHighlight,
  onDeleteHighlight: _onDeleteHighlight,
  onOpenInterpretation: _onOpenInterpretation,
  onOpenSparkInterpretation = () => undefined,
  onDeleteInterpretation: _onDeleteInterpretation,
  onCitationClick,
  onRefreshKnowledge = () => undefined,
  onBuildKnowledge = () => undefined,
  onExportKnowledge = () => undefined,
  onExportKnowledgeJson = () => undefined,
  onConfirmKnowledgeCard = () => undefined,
  onRejectKnowledgeCard = () => undefined,
  onDeleteKnowledgeCard = () => undefined,
  onSaveKnowledgeCard = () => undefined,
  onRegenerate,
  onStop,
  onOpenSampleBook,
}: ReaderShellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const loadingPageWindowsRef = useRef(new Set<string>())
  const [question, setQuestion] = useState("")
  const [notice, setNotice] = useState("")
  const { panels, setPanelOpen, togglePanel } = useReaderPanels()

  // macOS 原生菜单:订阅一次,动作经 ref 分发到与顶栏相同的 handler
  // (ref 在每次渲染时刷新为最新闭包,见 return 前的赋值)。
  const appMenuHandlersRef = useAppMenu()
  const {
    sidebarOpen,
    searchOpen,
    settingsOpen,
    obsidianSettingsOpen,
    libraryOpen,
    importMenuOpen,
    onboardingOpen,
    zoteroOpen,
  } = panels
  const [readerView, setReaderView] = useState<ReaderView>("text")
  const [readerDisplayThemeId, setReaderDisplayThemeId] =
    useState<ReaderDisplayThemeId>(readInitialReaderDisplayThemeId)
  const [outlineTarget, setOutlineTarget] = useState<ConvertedTextOutlineTarget | null>(null)
  const { llmSettings, llmSettingsError, setLlmSettings, setLlmSettingsError } = useLlmSettings()
  const canUseLibrary = isTauriRuntime() || browserLibraryAvailable()
  const hasCurrentThreadSelection = (currentThreadSelectionText ?? "").trim().length > 0
  const sparkSelectionText = hasCurrentThreadSelection ? (currentThreadSelectionText ?? "") : selectionText
  const sparkSelectionRects = hasCurrentThreadSelection
    ? (currentThreadSelectionRects ?? [])
    : selectionRects
  const {
    obsidianVaultPath,
    obsidianSubdir,
    obsidianConfigured,
    obsidianStatus,
    obsidianMessage,
    sparkObsidianExporting,
    knowledgeObsidianExporting,
    setObsidianVaultPath,
    setObsidianSubdir,
    handleSaveObsidianSettings,
    handleExportSparkToObsidian,
    handleExportHighlightToObsidian,
    handleExportKnowledgeToObsidian,
  } = useObsidianSettings({
    bookId,
    interpretation,
    sparkSelectionText,
    sparkSelectionRects,
    citationChunkIds,
    evidence,
    pushNotice,
    setPanelOpen,
  })
  const readerDisplayStyle = useMemo(
    () => readerDisplayThemeStyle(readerDisplayThemeId),
    [readerDisplayThemeId],
  )

  useEffect(() => {
    if (phase !== "empty" || totalPages > 0 || parsedPages.length > 0) {
      return
    }
    try {
      if (window.localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === "1") {
        return
      }
    } catch {
      return
    }
    setPanelOpen("onboardingOpen", true)
  }, [phase, totalPages, parsedPages.length])

  // Shared "render this opened book asset into the reader" tail. Every import /
  // open path produced the same onParsedDocument(asset, {...metadata}) call; this
  // collapses that duplication into one mapping (behavior-preserving).
  function applyParsedBookAsset(asset: ConvertedBookAsset) {
    onParsedDocument(asset.pages, asset.chunks, asset.text, asset.markdown, {
      parserEngine: asset.parserEngine,
      coordinateMode: asset.coordinateMode,
      quality: asset.quality,
      textPath: asset.textPath,
      markdownPath: asset.markdownPath,
      originalPdfPath: asset.originalPdfPath,
      sourcePdfPath: asset.sourcePdfPath,
      sourcePdfFingerprint: asset.sourcePdfFingerprint,
      ...tldrMetadataFromAsset(asset),
    })
  }

  const { safePage } = useReaderPageNavigation({
    currentPage,
    totalPages,
    onPageChange,
    onInvalidPage: () => pushNotice("请输入有效页码"),
  })
  const { switchReaderView } = useReaderViewMemory({
    readerView,
    currentPage: safePage,
    totalPages,
    setReaderView,
    onPageChange,
  })
  const {
    pdf,
    originalPdfPath,
    pdfLoadStatus,
    pdfLoadError,
    pdfOutlineEntries,
    setPdfLoadStatus,
    setPdfLoadError,
    loadOriginalPdf,
    handlePdfViewClick,
    handleOpenOriginalPdfExternally,
    handlePdfRenderError,
    applyImportedPdf,
    resetPdf,
  } = useReaderPdf({ bookId, readerView, switchReaderView, pushNotice })

  const {
    storedBooks,
    refreshStoredBooks,
    loadStoredBookInitialWindow,
    handleOpenStoredBook,
    handleDeleteStoredBook,
    handleOpenStoredBookFromShelf,
    requestStoredPageWindow,
  } = useReaderLibrary({
    bookId,
    libraryStatus,
    canUseLibrary,
    totalPages,
    currentPage: safePage,
    readerView,
    zoom,
    resetPdf,
    applyParsedBookAsset,
    onBookLoaded,
    onParsedDocument,
    onParsedDocumentWindow,
    onLibraryStatus,
    onPageChange,
    onZoomChange,
    setReaderView,
    setPanelOpen,
    pushNotice,
  })

  const {
    isExtracting,
    loadError,
    isImportDragOver,
    setLoadError,
    zoteroQuery,
    zoteroResults,
    zoteroStatus,
    zoteroImportingItemKey,
    zoteroMessage,
    setZoteroQuery,
    handleFile,
    handleImportDragOver,
    handleImportDragLeave,
    handleImportDrop,
    handleImportMenuOpen,
    handlePdfImportAction,
    handleTextBookImportAction,
    handleImportMineruSample,
    handleZoteroSearch,
    handleImportZoteroItem,
  } = useReaderImport({
    fileInputRef: inputRef,
    setPanelOpen,
    onBookLoaded,
    onParsedDocument,
    onLibraryStatus,
    onPhaseChange,
    setReaderView,
    pushNotice,
    applyParsedBookAsset,
    applyImportedPdf,
    resetPdf,
    setPdfLoadStatus,
    setPdfLoadError,
    loadStoredBookInitialWindow,
    handleOpenStoredBook,
    refreshStoredBooks,
    handleImportFailure,
  })

  const {
    searchQuery,
    backendSearchHits,
    searchStatus,
    setSearchQuery,
    handleEmbeddingSettingsSaved,
  } = useReaderSearch({ bookId, libraryStatus, pushNotice, refreshStoredBooks })

  const canShowConvertedText = parsedPages.length > 0
  const canRead = Boolean(pdf && totalPages > 0)
  const currentBookHasPdfSource = bookHasPdfParser(parserEngine) && originalPdfPath.toLowerCase().endsWith(".pdf")
  const canOpenPdfView =
    totalPages > 0 && (canRead || (isTauriRuntime() && currentBookHasPdfSource))
  const {
    translation,
    handleStartTranslation,
  } = useReaderTranslation({
    bookId,
    libraryStatus,
    readerView,
    canShowConvertedText,
    switchReaderView,
    pushNotice,
  })
  const libraryPersistenceLabel = isTauriRuntime()
    ? "导入后保存到本机书库，下次会优先直接打开"
    : browserLibraryAvailable()
      ? "浏览器版会保存转换稿；桌面版会额外保存原 PDF 和索引"
      : "当前浏览器不支持持久化；桌面版会保存书库"
  const runtimeLabel = isTauriRuntime() ? "桌面版" : "浏览器版"
  const backendOnlyHint = isTauriRuntime() ? undefined : "此功能需要桌面版；浏览器版会提示原因"
  const interpretationRuntimeHint = isTauriRuntime()
    ? "桌面版会使用完整多轮证据检索：检索本地文本索引、调用 LLM，并把引用回跳到转换稿。"
    : "浏览器版会使用已转换文本做本地兜底解读；完整 LLM 解读、云端向量检索、MinerU 云端解析和开发诊断请使用桌面版。"
  const importButtonLabel = isExtracting ? "导入中" : "导入"
  const llmProviderText = llmSettings
    ? `${llmProviderLabels[llmSettings.provider]} / ${llmSettings.model}`
    : isTauriRuntime()
      ? llmSettingsError || "provider 未读取"
      : "本地兜底"
  const llmProviderTitle = llmSettings
    ? `当前 LLM provider: ${llmProviderLabels[llmSettings.provider]}；模型: ${llmSettings.model}`
    : isTauriRuntime()
      ? llmSettingsError || "尚未读取当前 LLM provider"
      : "浏览器版不会读取本机 LLM provider"
  const readerViewItems = readerViewConfigs({
    canShowConvertedText,
    canOpenPdfView,
    hasBook: Boolean(bookId),
    isDesktop: isTauriRuntime(),
  })
  const currentViewConfig =
    readerViewItems.find((item) => item.view === readerView) ?? readerViewItems[0]
  const showInterpretationAside = currentViewConfig.showsInterpretationAside
  const showReaderOutline = currentViewConfig.showsOutline
  const searchResults = searchParsedPages(searchQuery, parsedPages)
  const localChunkResults = searchParsedChunks(searchQuery, parsedChunks).map((result) => ({
    ...result,
    snippet: "",
  }))
  const chunkResults = readerChunkSearchResults({
    backendHits: backendSearchHits,
    localResults: localChunkResults,
    searchStatus,
  })
  const chunksByPage = useMemo(() => {
    const grouped = new Map<number, ParsedChunk[]>()
    for (const chunk of parsedChunks) {
      const pageChunks = grouped.get(chunk.pageIndex) ?? []
      pageChunks.push(chunk)
      grouped.set(chunk.pageIndex, pageChunks)
    }
    return grouped
  }, [parsedChunks])
  const readerOutline = useMemo(
    () => buildReaderOutline(parsedPages, parsedChunks, totalPages, pdfOutlineEntries),
    [parsedPages, parsedChunks, totalPages, pdfOutlineEntries],
  )

  function pushNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 2400)
  }

  function markOnboardingSeen() {
    try {
      window.localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, "1")
    } catch {
      // localStorage may be unavailable in restricted previews; closing should still work.
    }
    setPanelOpen("onboardingOpen", false)
  }

  function handleOnboardingSample() {
    markOnboardingSeen()
    onOpenSampleBook?.()
  }

  function handleOnboardingImport() {
    markOnboardingSeen()
    setPanelOpen("importMenuOpen", true)
  }

  function handleImportFailure(error: unknown, noticeMessage: string) {
    const friendlyMessage = friendlyImportErrorMessage(error)
    setLoadError(friendlyMessage)
    if (bookId || parsedPages.length > 0 || pdf) {
      pushNotice(`${noticeMessage}；${friendlyMessage}；已保留当前阅读内容`)
      return
    }
    onLibraryStatus("error", friendlyMessage)
    onPhaseChange("error")
    pushNotice(noticeMessage)
  }

  async function copyInterpretationResult() {
    const payload = formatInterpretationClipboardText(
      sparkSelectionText,
      interpretation,
      followUps,
      evidence,
    )
    if (!payload.trim()) {
      pushNotice("还没有可复制的解读内容")
      return
    }
    await navigator.clipboard?.writeText(payload)
  }

  async function handleHighlight() {
    if (!selectionText) {
      pushNotice("请先框选一段文字")
      return
    }
    const saved = await onSaveHighlight()
    pushNotice(highlightSaveFeedback({ hasBook: Boolean(bookId), saved, selectionRects }))
  }

  function handleTextSelection(
    text: string,
    pageNumber: number,
    anchor?: TextSelectionAnchor | null,
  ) {
    onPageChange(pageNumber)
    onSelection(text, [], anchor)
  }

  function handleChunkSelect(chunk: ParsedChunk) {
    switchReaderView("text", { page: chunk.pageIndex + 1 })
    onChunkFocus(chunk.pageIndex + 1, chunk.chunkId, chunk.text, chunk.rects)
    pushNotice(chunk.rects.length > 0 ? "已定位到相关段落" : "已定位到相关文本")
  }

  function handleEvidenceJump(chunkId: string) {
    const citationPage =
      evidence.find((item) => item.chunkId === chunkId)?.pageIndex ??
      parsedChunks.find((chunk) => chunk.chunkId === chunkId)?.pageIndex
    switchReaderView(
      "text",
      citationPage === undefined ? { restorePage: false } : { page: citationPage + 1 },
    )
    onCitationClick?.(chunkId)
  }

  function handleOutlineSelect(entry: ReaderOutlineEntry) {
  const targetView = readerView === "translation" ? "translation" : "text"
    switchReaderView(targetView, { page: entry.pageIndex + 1 })
    onActiveChunk("")
    setOutlineTarget({
      requestId: `${entry.id}:${Date.now()}`,
      entryId: entry.id,
      pageIndex: entry.pageIndex,
      anchorText: entry.anchorText,
    })
  }

  function handleQuestionSubmit(forcedQuestion?: string) {
    const trimmed = (forcedQuestion ?? question).trim()
    if (!trimmed) {
      return
    }
    onQuestionSubmit(trimmed)
    setQuestion("")
    pushNotice("追问已提交")
  }

  function runDeepInterpretation() {
    if (!selectionText.trim()) {
      pushNotice("请先框选一段文字")
      return
    }
    onWorkbenchTabChange("spark")
    onCurrentThreadLightweightChange(false)
    onDeepInterpret()
  }

  function runPlainInterpretation() {
    if (!selectionText.trim()) {
      pushNotice("请先框选一段文字")
      return
    }
    onWorkbenchTabChange("spark")
    onCurrentThreadLightweightChange(true)
    onPlainExplain()
  }

  function startComment() {
    if (!selectionText.trim()) {
      pushNotice("请先框选一段文字")
      return
    }
    onWorkbenchTabChange("spark")
    onComment()
  }

  useReaderShortcuts({
    selectionText,
    runDeepInterpretation,
    setQuestion,
    onClearSelection,
    onDeepInterpret,
    onPlainExplain,
    onWorkbenchTabChange,
    onCurrentThreadLightweightChange,
  })

  function handleReaderDisplayThemeChange(themeId: ReaderDisplayThemeId) {
    const normalizedThemeId = normalizeReaderDisplayThemeId(themeId)
    setReaderDisplayThemeId(normalizedThemeId)
    try {
      window.localStorage.setItem(READER_DISPLAY_THEME_STORAGE_KEY, normalizedThemeId)
    } catch {
      // Display preference persistence is best-effort; the in-memory switch already applied.
    }
    pushNotice(`阅读外观：${readerDisplayThemeById(normalizedThemeId).label}`)
  }

  // 顶栏和原生菜单共用同一个视图切换入口,保证两处行为永不分叉。
  function handleSelectReaderView(item: ReaderViewConfig) {
    if (item.disabled) {
      return
    }
    if (item.view === "pdf") {
      void handlePdfViewClick()
      return
    }
    if (item.view === "translation") {
      void handleStartTranslation(false)
      return
    }
    switchReaderView(item.view)
  }

  // macOS 原生菜单动作 → 与顶栏相同的 handler。ref 每次渲染刷新,
  // 事件订阅只建立一次(卸载时解除)。
  appMenuHandlersRef.current = {
    onImport: handleImportMenuOpen,
    onToggleLibrary: () => {
      togglePanel("libraryOpen")
      void refreshStoredBooks()
    },
    onToggleSearch: () => {
      togglePanel("searchOpen")
      pushNotice(parsedPages.length > 0 ? "搜索面板已切换" : "导入书籍并生成转换稿后才能搜索")
    },
    onToggleSettings: () => togglePanel("settingsOpen"),
    onOpenObsidianSettings: () => setPanelOpen("obsidianSettingsOpen", true),
    onToggleSidebar: () => togglePanel("sidebarOpen"),
    onToggleAppearance: () => togglePanel("themeMenuOpen"),
    onSelectView: (view) => {
      const item = readerViewItems.find((candidate) => candidate.view === view)
      if (item) {
        handleSelectReaderView(item)
      }
    },
  }

  return (
    <div
      className="reader-display-theme reader-workspace-theme flex h-screen min-h-0 flex-col overflow-hidden"
      style={readerDisplayStyle}
    >
      <ReaderTopBar
        bookTitle={bookTitle}
        totalPages={totalPages}
        readerView={readerView}
        runtimeLabel={runtimeLabel}
        llmProviderText={llmProviderText}
        llmProviderTitle={llmProviderTitle}
        importButtonLabel={importButtonLabel}
        hasBook={Boolean(bookId) || parsedPages.length > 0}
        isExtracting={isExtracting}
        importMenuOpen={importMenuOpen}
        libraryOpen={libraryOpen}
        pdfLoadStatus={pdfLoadStatus}
        readerViewItems={readerViewItems}
        readerDisplayThemeId={readerDisplayThemeId}
        readerDisplayThemeItems={readerDisplayThemeOptions}
        themeMenuOpen={panels.themeMenuOpen}
        fileInputRef={inputRef}
        onToggleSidebar={() => togglePanel("sidebarOpen")}
        onFileSelected={(file) => void handleFile(file)}
        onImportMenuOpen={handleImportMenuOpen}
        onToggleLibrary={() => {
          togglePanel("libraryOpen")
          void refreshStoredBooks()
        }}
        onSelectView={handleSelectReaderView}
        onToggleSearch={() => {
          togglePanel("searchOpen")
          pushNotice(parsedPages.length > 0 ? "搜索面板已切换" : "导入书籍并生成转换稿后才能搜索")
        }}
        onOpenGuide={() => setPanelOpen("onboardingOpen", true)}
        onReaderDisplayThemeChange={handleReaderDisplayThemeChange}
        onThemeMenuOpenChange={(open) => setPanelOpen("themeMenuOpen", open)}
        onToggleSettings={() => togglePanel("settingsOpen")}
      />
      <LlmSettingsPanel
        open={settingsOpen}
        onClose={() => setPanelOpen("settingsOpen", false)}
        onLlmSettingsSaved={(settings) => {
          setLlmSettings(settings)
          setLlmSettingsError("")
        }}
        onEmbeddingSettingsSaved={() => void handleEmbeddingSettingsSaved()}
        onOpenObsidian={() => {
          setPanelOpen("settingsOpen", false)
          setPanelOpen("obsidianSettingsOpen", true)
        }}
      />
      <ObsidianSettingsPanel
        open={obsidianSettingsOpen}
        vaultPath={obsidianVaultPath}
        subdir={obsidianSubdir}
        configured={obsidianConfigured}
        status={obsidianStatus}
        message={obsidianMessage}
        desktopAvailable={isTauriRuntime()}
        onVaultPathChange={setObsidianVaultPath}
        onSubdirChange={setObsidianSubdir}
        onSave={() => void handleSaveObsidianSettings()}
        onClose={() => setPanelOpen("obsidianSettingsOpen", false)}
      />
      <OnboardingFlow
        open={onboardingOpen}
        hasSampleBook={Boolean(onOpenSampleBook)}
        onClose={markOnboardingSeen}
        onOpenSample={handleOnboardingSample}
        onImport={handleOnboardingImport}
      />
      <ImportChoicePanel
        open={importMenuOpen}
        isDesktop={isTauriRuntime()}
        isBusy={isExtracting || zoteroStatus === "importing"}
        hasSampleBook={Boolean(onOpenSampleBook)}
        onClose={() => setPanelOpen("importMenuOpen", false)}
        onImportPdf={() => void handlePdfImportAction()}
        onImportTextBook={() => void handleTextBookImportAction()}
        onImportZotero={() => {
          if (!isTauriRuntime()) {
            pushNotice("从 Zotero 导入需要桌面版读取本机 Zotero 库")
            return
          }
          setPanelOpen("importMenuOpen", false)
          setPanelOpen("zoteroOpen", true)
        }}
        onImportMineruOutput={() => void handleImportMineruSample()}
        onOpenSample={() => {
          setPanelOpen("importMenuOpen", false)
          onOpenSampleBook?.()
        }}
      />
      <LibraryShelf
        open={libraryOpen}
        books={storedBooks}
        activeBookId={bookId}
        persistenceLabel={libraryPersistenceLabel}
        onClose={() => setPanelOpen("libraryOpen", false)}
        onRefresh={() => void refreshStoredBooks()}
        onOpen={(storedBookId) => void handleOpenStoredBookFromShelf(storedBookId)}
        onDelete={(storedBookId) => void handleDeleteStoredBook(storedBookId)}
      />
      <ZoteroImportPanel
        open={zoteroOpen}
        query={zoteroQuery}
        results={zoteroResults}
        status={zoteroStatus}
        importingItemKey={zoteroImportingItemKey}
        message={zoteroMessage}
        onQueryChange={setZoteroQuery}
        onSearch={() => void handleZoteroSearch()}
        onImport={(result) => void handleImportZoteroItem(result)}
        onClose={() => setPanelOpen("zoteroOpen", false)}
      />

      {notice ? (
        <div className="reader-floating-surface pointer-events-none fixed left-1/2 top-16 z-50 max-w-md -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow-lg">
          {notice}
        </div>
      ) : null}

      <main
        className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
        style={{
          gridTemplateColumns: readerLayoutColumns(readerView, sidebarOpen),
        }}
      >
        {readerView === "knowledge" ? (
          <div aria-hidden="true" className="min-w-0 overflow-hidden" />
        ) : (
          <ReaderSidebar
            sidebarOpen={sidebarOpen}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            searchStatus={searchStatus}
            chunkResults={chunkResults}
            pageResults={searchResults}
            showReaderOutline={showReaderOutline}
            readerOutline={readerOutline}
            currentPage={safePage}
            outlineTarget={outlineTarget}
            hasParsedPages={parsedPages.length > 0}
            onSearchQueryChange={setSearchQuery}
            onSelectChunk={handleChunkSelect}
            onSelectPage={(pageIndex) => switchReaderView("text", { page: pageIndex + 1 })}
            onSelectOutline={handleOutlineSelect}
          />
        )}

        <section
          key={readerView}
          className={canShowConvertedText ? currentViewConfig.contentClassName : "min-h-0 overflow-auto bg-[hsl(38_22%_91%)] px-8 py-8 animate-fade-in"}
        >
          {canShowConvertedText && readerView === "text" ? (
            <ConvertedTextReader
              pages={parsedPages}
              chunksByPage={chunksByPage}
              activeChunkId={activeChunkId}
              outlineTarget={outlineTarget}
              currentPage={safePage}
              totalPages={totalPages}
              approximateSelection={coordinateModeIsApproximate(coordinateMode)}
              highlights={highlights}
              sparkItems={interpretationHistory.filter((item) => {
                const kind = item.kind ?? "interpretation"
                return kind === "interpretation" || kind === "spark" || kind === "note"
              })}
              selectionText={selectionText}
              selectionRects={selectionRects}
              selectionAnchor={selectionAnchor}
              quality={textQuality}
              displayThemeStyle={readerDisplayStyle}
              onExplain={runDeepInterpretation}
              onPlainExplain={runPlainInterpretation}
              onComment={startComment}
              onOpenSparkItem={(item) => onOpenSparkInterpretation(item, "text")}
              onHighlight={handleHighlight}
              onSaveToObsidian={() => void handleExportHighlightToObsidian()}
              onTextSelection={handleTextSelection}
              onClearSelection={onClearSelection}
              onCurrentPageChange={onVisiblePageChange}
              onPageWindowRequest={requestStoredPageWindow}
            />
          ) : canShowConvertedText && readerView === "tldr" ? (
            <TldrReader
              text={tldr?.text}
              generatedAt={tldr?.generatedAt}
              model={tldr?.model}
              loading={tldrLoading}
              error={tldrError}
              desktopAvailable={isTauriRuntime()}
              llmReady={tldrLlmReady}
              displayThemeStyle={readerDisplayStyle}
              onGenerate={onGenerateTldr}
              onRegenerate={onRegenerateTldr}
            />
          ) : canShowConvertedText && readerView === "translation" ? (
            <TranslationReader
              pages={parsedPages}
              outlineTarget={outlineTarget}
              currentPage={safePage}
              totalPages={totalPages}
              translation={translation}
              selectionText={selectionText}
              selectionRects={selectionRects}
              selectionAnchor={selectionAnchor}
              sparkItems={interpretationHistory.filter((item) => {
                const kind = item.kind ?? "interpretation"
                return kind === "interpretation" || kind === "spark" || kind === "note"
              })}
              displayThemeStyle={readerDisplayStyle}
              onCurrentPageChange={onVisiblePageChange}
              onExplain={runDeepInterpretation}
              onPlainExplain={runPlainInterpretation}
              onComment={startComment}
              onOpenSparkItem={(item) => onOpenSparkInterpretation(item, "translation")}
              onHighlight={handleHighlight}
              onSaveToObsidian={() => void handleExportHighlightToObsidian()}
              onTextSelection={handleTextSelection}
              onClearSelection={onClearSelection}
              onPageWindowRequest={requestStoredPageWindow}
            />
          ) : canShowConvertedText && readerView === "knowledge" ? (
            <div className="h-full overflow-hidden px-4 py-4">
              <KnowledgePanel
                cards={knowledgeCards}
                graph={knowledgeGraph}
                health={knowledgeHealth}
                drift={knowledgeDrift}
                map={knowledgeMap}
                loading={knowledgeLoading}
                graphLoading={knowledgeGraphLoading}
                building={knowledgeGraphBuilding}
                error={knowledgeError}
                onRefresh={onRefreshKnowledge}
                onBuildKnowledge={onBuildKnowledge}
                onExport={onExportKnowledge}
                onExportJson={onExportKnowledgeJson}
                onExportObsidian={() => void handleExportKnowledgeToObsidian()}
                obsidianExporting={knowledgeObsidianExporting}
                onConfirmCard={onConfirmKnowledgeCard}
                onRejectCard={onRejectKnowledgeCard}
                onDeleteCard={onDeleteKnowledgeCard}
                onSaveCard={onSaveKnowledgeCard}
                onEvidenceClick={handleEvidenceJump}
                fullHeight
              />
            </div>
          ) : readerView === "pdf" && pdfLoadStatus === "loading" ? (
            <PdfUnavailablePanel
              status="loading"
              title="正在加载原 PDF"
              message="正在从本地书籍资产读取原始 PDF，用于版面校对。"
              canRetry={false}
              canOpenExternal={Boolean(bookId && originalPdfPath && isTauriRuntime())}
              onRetry={() => undefined}
              onOpenExternal={() => void handleOpenOriginalPdfExternally()}
              onBackToText={() => switchReaderView("text")}
            />
          ) : canRead ? (
            <PdfDocumentViewer
              pdf={pdf!}
              currentPage={safePage}
              totalPages={totalPages}
              zoom={zoom}
              pageTextForPage={(pageIndex) => pageTextByIndex(parsedPages, pageIndex)}
              highlightRects={highlights.flatMap((highlight) => highlight.rects)}
              selectionRects={selectionRects}
              approximateSelection={coordinateModeIsApproximate(coordinateMode)}
              onSelection={onSelection}
              onClearSelection={onClearSelection}
              onCurrentPageChange={onVisiblePageChange}
              onExplain={runDeepInterpretation}
              onHighlight={handleHighlight}
              onPlainExplain={runPlainInterpretation}
              onComment={startComment}
              onRenderError={(message) => {
                setLoadError(message)
                void handlePdfRenderError(message)
              }}
            />
          ) : readerView === "pdf" && canOpenPdfView ? (
            <PdfUnavailablePanel
              status="error"
              title="原 PDF 暂时无法显示"
              message={pdfLoadError || "当前书籍的原 PDF 副本无法在应用内读取。"}
              canRetry={Boolean(originalPdfPath && isTauriRuntime())}
              canOpenExternal={Boolean(bookId && originalPdfPath && isTauriRuntime())}
              onRetry={() =>
                void loadOriginalPdf(originalPdfPath, {
                  switchToPdf: true,
                  notify: true,
                  force: true,
                })
              }
              onOpenExternal={() => void handleOpenOriginalPdfExternally()}
              onBackToText={() => switchReaderView("text")}
            />
          ) : (
            <div
              data-testid="empty-import-dropzone"
              className={`mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-8 py-10 text-center transition-colors duration-200 ${
                isImportDragOver ? "reader-panel-drop-active rounded-md border border-dashed" : ""
              }`}
              onDragOver={handleImportDragOver}
              onDragLeave={handleImportDragLeave}
              onDrop={handleImportDrop}
            >
              <Upload className="reader-panel-muted mb-4 h-10 w-10" />
              <h1 className="reader-panel-text text-xl font-semibold">先体验框选精读，或导入自己的 PDF</h1>
              <p className="reader-panel-muted mt-3 max-w-md text-sm leading-6">
                示例书无需配置 key，会直接打开一段已转换文本；也可以选择 PDF，或将 PDF 拖到此处。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {onOpenSampleBook ? (
                  <Button onClick={onOpenSampleBook}>
                    <BookOpen className="mr-1.5 h-4 w-4" />
                    打开示例书
                  </Button>
                ) : null}
                <Button
                  variant={onOpenSampleBook ? "secondary" : "default"}
                  onClick={handleImportMenuOpen}
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  选择 PDF
                </Button>
                <Button variant="ghost" onClick={() => setPanelOpen("onboardingOpen", true)}>
                  <BookOpen className="mr-1.5 h-4 w-4" />
                  查看引导
                </Button>
              </div>
              {loadError ? (
                <p className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-foreground">
                  {loadError}
                </p>
              ) : null}
            </div>
          )}
        </section>

        {showInterpretationAside ? (
          <AiWorkbench
            tab={workbenchTab}
            runningTaskCount={workbenchRunningTaskCount}
            selectionText={sparkSelectionText}
            selectionRects={sparkSelectionRects}
            interpretation={interpretation}
            answerSource={answerSource}
            followUps={followUps}
            noteDraft={currentNoteDraft}
            noteInitiallyOpen={currentNoteOpen}
            noteSaving={currentNoteSaving}
            noteError={currentThreadError}
            lightweight={currentThreadLightweight}
            citationChunkIds={citationChunkIds}
            phase={phase}
            evidence={evidence}
            agentTrace={agentTrace}
            interpretationError={interpretationError}
            question={question}
            interpretationRuntimeHint={interpretationRuntimeHint}
            tasks={agentTasks}
            tasksDisabled={!bookId}
            interpretationHistory={interpretationHistory}
            onTabChange={onWorkbenchTabChange}
            onNoteChange={onCurrentNoteChange}
            onSaveNote={onCurrentNoteSave}
            onCopyInterpretation={copyInterpretationResult}
            onCitationClick={handleEvidenceJump}
            onQuestionChange={setQuestion}
            onQuestionSubmit={handleQuestionSubmit}
            onRegenerate={onRegenerate}
            onStop={onStop}
            onOpenSettings={() => setPanelOpen("settingsOpen", true)}
            onExportSparkToObsidian={() => void handleExportSparkToObsidian()}
            sparkObsidianExporting={sparkObsidianExporting}
            onRunTask={onRunAgentTask}
            onStopTask={onStopAgentTask}
            onOpenSparkItem={(item) => onOpenSparkInterpretation(item)}
          />
        ) : null}
      </main>

      {readerView === "pdf" ? (
        <footer className="reader-chrome-bar reader-panel-muted flex h-12 shrink-0 items-center justify-end gap-2 border-t px-4 text-sm">
          <Button
            size="icon"
            variant="ghost"
            className="reader-chrome-icon-button h-8 w-8"
            aria-label="缩小"
            disabled={!canRead}
            onClick={() => onZoomChange(Math.max(0.6, Number((zoom - 0.1).toFixed(2))))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span>缩放 {Math.round(zoom * 100)}%</span>
          <Button
            size="icon"
            variant="ghost"
            className="reader-chrome-icon-button h-8 w-8"
            aria-label="放大"
            disabled={!canRead}
            onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </footer>
      ) : null}
    </div>
  )
}

function coordinateModeIsApproximate(coordinateMode: string) {
  return coordinateMode
    .split(/[-_\s]+/)
    .some((part) => part.toLowerCase() === "approx" || part.toLowerCase() === "approximate")
}

type PdfUnavailablePanelProps = {
  status: "loading" | "error"
  title: string
  message: string
  canRetry: boolean
  canOpenExternal: boolean
  onRetry: () => void
  onOpenExternal: () => void
  onBackToText: () => void
}

function PdfUnavailablePanel({
  status,
  title,
  message,
  canRetry,
  canOpenExternal,
  onRetry,
  onOpenExternal,
  onBackToText,
}: PdfUnavailablePanelProps) {
  return (
    <div className="reader-panel-card mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center rounded-lg border p-8 text-center shadow-sm">
      <div className="reader-panel-subtle mb-4 flex h-12 w-12 items-center justify-center rounded-full">
        {status === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <BookOpen className="h-5 w-5" />
        )}
      </div>
      <h2 className="reader-panel-text text-lg font-semibold">{title}</h2>
      <p className="reader-panel-muted mt-2 max-w-md text-sm leading-6">{message}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {canRetry ? (
          <Button size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            重试
          </Button>
        ) : null}
        {canOpenExternal ? (
          <Button size="sm" variant="secondary" onClick={onOpenExternal}>
            <ExternalLink className="mr-1.5 h-4 w-4" />
            系统打开 PDF
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onBackToText}>
          <FileText className="mr-1.5 h-4 w-4" />
          回到转换稿
        </Button>
      </div>
    </div>
  )
}
