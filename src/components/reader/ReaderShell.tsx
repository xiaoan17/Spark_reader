import {
  BookOpen,
  FileText,
  ExternalLink,
  Languages,
  Loader2,
  Library,
  Minus,
  Plus,
  RefreshCw,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  SunMoon,
  Upload,
} from "lucide-react"
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react"
import { loadPdfDocument, type PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { InterpretationCard } from "@/components/interpretation/InterpretationCard"
import { TldrReader } from "@/components/reader/TldrReader"
import { SparkPanel } from "@/components/spark/SparkPanel"
import { LlmSettingsPanel } from "@/components/settings/LlmSettingsPanel"
import { pageTextByIndex } from "@/core/page-lookup"
import { replaceInternalCitationsWithReadableLabels } from "@/core/citation-display"
import { PdfDocumentViewer } from "./PdfCanvasPage"
import type {
  EvidencePreview,
  FollowUpTurn,
  AgentTraceStep,
  LibraryStatus,
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
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"
import { extractPdfText } from "@/core/pdf-text-extractor"
import { searchParsedChunks, searchParsedPages } from "@/core/local-interpreter"
import { formatInterpretationClipboardText } from "./interpretation-clipboard"
import {
  textSelectionAnchorFromOffsets,
} from "./text-selection-anchor"
import { highlightSaveFeedback } from "./highlight-save-feedback"
import {
  buildPdfOutlineEntries,
  buildReaderOutline,
  type ReaderOutlineEntry,
} from "./reader-outline"
import { ReaderOutlinePanel } from "./ReaderOutlinePanel"
import {
  ConvertedTextReader,
  type ConvertedTextOutlineTarget,
} from "./ConvertedTextReader"
import { TranslationReader } from "./TranslationReader"
import { ImportChoicePanel } from "./ImportChoicePanel"
import { LibraryShelf } from "./LibraryShelf"
import { OnboardingFlow } from "./OnboardingFlow"
import { ZoteroImportPanel } from "./ZoteroImportPanel"
import type { ReaderView } from "./highlight-target-view"
import {
  browserLibraryAvailable,
  browserPdfFingerprint,
  deleteBrowserBook,
  findBrowserBookBySourceFingerprint,
  getBrowserBook,
  listBrowserBooks,
  saveBrowserBook,
} from "@/core/browser-library"
import { embeddingSaveIndexAction } from "@/core/index-rebuild-policy"
import { mineruProgressMessage } from "./mineru-progress"
import {
  READER_SESSION_STORAGE_KEY,
  nextStartupRestoreTarget,
  parseStartupSession,
  serializeStartupSession,
  type StartupReaderView,
  type StartupRestoreTarget,
} from "./startup-restore"
import {
  getConvertedBookManifest,
  getConvertedBookPages,
  deleteBook,
  findBookBySourcePdf,
  importMineruOutput,
  importPdfWithMineru,
  importPlainBook,
  importZoteroItem,
  isTauriRuntime,
  listenMineruProgress,
  listenSearchIndexProgress,
  listBooks,
  openBookAsset,
  readPdfFile,
  rebuildSearchIndexAsync,
  searchBook,
  searchZoteroItems,
  startTranslation,
  translationStatus,
  cancelTranslation,
  getLlmSettings,
  type SearchBookHit,
  type StoredBookSummary,
  type ConvertedBookManifest,
  type ConvertedBookPageWindow,
  type MinerUProgressEvent,
  type SearchIndexProgressEvent,
  type SearchIndexSummary,
  type ZoteroSearchResult,
  type LlmSettings,
  type LlmProviderKind,
  type TranslationStatus,
} from "@/core/library-api"
import { readerChunkSearchResults } from "./search-results"
import { clampPage, useReaderPageNavigation } from "./page-navigation"
import { useReaderViewMemory } from "./reader-view-memory"
import { useReaderPanels } from "./reader-panels"
import { friendlyImportErrorMessage } from "./import-errors"

const STORED_BOOK_INITIAL_PAGE_WINDOW = 48
const ONBOARDING_SEEN_STORAGE_KEY = "focused-reading.onboarding.seen.v1"

const llmProviderLabels: Record<LlmProviderKind, string> = {
  deep_seek: "DeepSeek",
  open_ai: "OpenAI",
  anthropic: "Anthropic",
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
  sparkPanelOpen?: boolean
  sparkMode?: "spark" | "note"
  sparkNoteDraft?: string
  sparkNoteItems?: SavedInterpretation[]
  sparkQuestion?: string
  sparkError?: string
  sparkLoading?: boolean
  highlights: SavedHighlight[]
  interpretationHistory: SavedInterpretation[]
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
  onQuestionSubmit: (question: string) => void
  onOpenSpark?: () => void
  onSparkModeChange?: (mode: "spark" | "note") => void
  onSparkQuestionChange?: (question: string) => void
  onSparkNoteChange?: (note: string) => void
  onSparkAsk?: () => void
  onSparkSaveNote?: () => void
  onCloseSpark?: () => void
  onGenerateTldr?: () => void
  onRegenerateTldr?: () => void
  onSaveHighlight: () => Promise<boolean>
  onOpenHighlight: (highlight: SavedHighlight) => void
  onDeleteHighlight: (highlightId: string) => void
  onOpenInterpretation: (item: SavedInterpretation) => void
  onOpenSparkInterpretation?: (item: SavedInterpretation, sourceView?: ReaderView) => void
  onDeleteInterpretation: (interpretationId: string) => void
  onCitationClick?: (chunkId: string) => void
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
  sparkPanelOpen = false,
  sparkMode = "spark",
  sparkNoteDraft = "",
  sparkNoteItems = [],
  sparkQuestion = "",
  sparkError = "",
  sparkLoading = false,
  highlights,
  interpretationHistory,
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
  onQuestionSubmit,
  onOpenSpark = () => undefined,
  onSparkModeChange = () => undefined,
  onSparkQuestionChange = () => undefined,
  onSparkNoteChange = () => undefined,
  onSparkAsk = () => undefined,
  onSparkSaveNote = () => undefined,
  onCloseSpark = () => undefined,
  onGenerateTldr = () => undefined,
  onRegenerateTldr = () => undefined,
  onSaveHighlight,
  onOpenHighlight: _onOpenHighlight,
  onDeleteHighlight: _onDeleteHighlight,
  onOpenInterpretation: _onOpenInterpretation,
  onOpenSparkInterpretation = () => undefined,
  onDeleteInterpretation: _onDeleteInterpretation,
  onCitationClick,
  onRegenerate,
  onStop,
  onOpenSampleBook,
}: ReaderShellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const originalPdfLoadingPathRef = useRef("")
  const loadingPageWindowsRef = useRef(new Set<string>())
  const searchIndexProgressHandlerRef = useRef<(event: SearchIndexProgressEvent) => void>(() => undefined)
  const searchIndexTaskRef = useRef<{
    taskId: string
    bookId: string
    successPrefix: string
    failureMessage: string
    notify: boolean
  } | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState("")
  const [pdfLoadStatus, setPdfLoadStatus] = useState<"idle" | "loading" | "error">("idle")
  const [pdfLoadError, setPdfLoadError] = useState("")
  const [originalPdfPath, setOriginalPdfPath] = useState("")
  const [loadedPdfPath, setLoadedPdfPath] = useState("")
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const [notice, setNotice] = useState("")
  const { panels, setPanelOpen, togglePanel } = useReaderPanels()
  const {
    sidebarOpen,
    searchOpen,
    settingsOpen,
    libraryOpen,
    importMenuOpen,
    onboardingOpen,
    zoteroOpen,
  } = panels
  const [zoteroQuery, setZoteroQuery] = useState("")
  const [zoteroResults, setZoteroResults] = useState<ZoteroSearchResult[]>([])
  const [zoteroStatus, setZoteroStatus] = useState<"idle" | "searching" | "importing" | "error">("idle")
  const [zoteroMessage, setZoteroMessage] = useState("")
  const [readerView, setReaderView] = useState<ReaderView>("text")
  const [searchQuery, setSearchQuery] = useState("")
  const [backendSearchHits, setBackendSearchHits] = useState<SearchBookHit[]>([])
  const [searchStatus, setSearchStatus] = useState<"idle" | "searching" | "fallback">("idle")
  const [isExtracting, setIsExtracting] = useState(false)
  const [isImportDragOver, setIsImportDragOver] = useState(false)
  const [storedBooks, setStoredBooks] = useState<StoredBookSummary[]>([])
  const [pdfOutlineEntries, setPdfOutlineEntries] = useState<ReaderOutlineEntry[]>([])
  const [outlineTarget, setOutlineTarget] = useState<ConvertedTextOutlineTarget | null>(null)
  const [translation, setTranslation] = useState<TranslationStatus | null>(null)
  const [translationBusy, setTranslationBusy] = useState(false)
  const [translationMessage, setTranslationMessage] = useState("")
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [llmSettingsError, setLlmSettingsError] = useState("")
  const canUseLibrary = isTauriRuntime() || browserLibraryAvailable()

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

  useEffect(() => {
    return () => {
      void pdf?.cleanup()
    }
  }, [pdf])

  useEffect(() => {
    void refreshLlmSettings()
  }, [])

  async function refreshLlmSettings() {
    if (!isTauriRuntime()) {
      setLlmSettings(null)
      setLlmSettingsError("")
      return null
    }

    try {
      const settings = await getLlmSettings()
      setLlmSettings(settings)
      setLlmSettingsError("")
      return settings
    } catch (error) {
      setLlmSettings(null)
      setLlmSettingsError(error instanceof Error ? error.message : "AI provider 读取失败")
      return null
    }
  }

  searchIndexProgressHandlerRef.current = handleSearchIndexProgress

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    void listenSearchIndexProgress((event) => {
      if (cancelled) return
      searchIndexProgressHandlerRef.current(event)
    }).then((cleanup) => {
      if (cancelled) {
        cleanup?.()
      } else {
        unlisten = cleanup
      }
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      readerView !== "pdf" ||
      !originalPdfPath ||
      (pdf && loadedPdfPath === originalPdfPath) ||
      pdfLoadStatus !== "idle"
    ) {
      return
    }
    void loadOriginalPdf(originalPdfPath, { switchToPdf: false, notify: false })
  }, [readerView, originalPdfPath, loadedPdfPath, pdf, pdfLoadStatus])

  useEffect(() => {
    let cancelled = false
    setPdfOutlineEntries([])
    if (!pdf) {
      return () => {
        cancelled = true
      }
    }
    void buildPdfOutlineEntries(pdf).then((entries) => {
      if (!cancelled) {
        setPdfOutlineEntries(entries)
      }
    })
    return () => {
      cancelled = true
    }
  }, [pdf])

  async function handleFile(file: File) {
    if (isTauriRuntime()) {
      setLoadError("")
      onLibraryStatus("idle", "桌面版导入统一使用 MinerU 云端解析")
      pushNotice("桌面版导入会使用 MinerU 云端解析，请通过“导入 > 本地 PDF”选择本地 PDF")
      return
    }
    setLoadError("")
    onPhaseChange("reading")
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const loadedPdf = await loadPdfDocument({ data: bytes })
      await pdf?.cleanup()
      setPdf(loadedPdf)
      setLoadedPdfPath("")
      setOriginalPdfPath(file.name)
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      const title = file.name.replace(/\.pdf$/i, "")
      const sourcePdfFingerprint = browserPdfFingerprint(file)
      onBookLoaded(title, loadedPdf.numPages)
      if (!isTauriRuntime() && browserLibraryAvailable()) {
        const cachedBook = await findBrowserBookBySourceFingerprint(sourcePdfFingerprint)
        if (cachedBook) {
          const restoredBookId = await handleOpenStoredBook(cachedBook.bookId)
          if (restoredBookId) {
            setReaderView("text")
            pushNotice("已从浏览器书库打开，无需重新转换")
            return
          }
        }
      }
      setIsExtracting(true)
      pushNotice("PDF 已导入，正在生成 Markdown 转换稿")
      const parsed = await extractPdfText(loadedPdf, {
        onProgress: ({ pageNumber, totalPages: progressTotalPages, percent }) => {
          pushNotice(`正在生成 Markdown 转换稿：第 ${pageNumber}/${progressTotalPages} 页（${percent}%）`)
        },
      })
      onParsedDocument(parsed.pages, parsed.chunks, parsed.text, parsed.markdown, {
        parserEngine: parsed.engine,
        coordinateMode: parsed.coordinateMode,
        quality: parsed.quality,
        originalPdfPath: file.name,
        sourcePdfPath: file.name,
        sourcePdfFingerprint,
      })
      setReaderView("text")
      if (!isTauriRuntime()) {
        if (!browserLibraryAvailable()) {
          onLibraryStatus(
            "memory-only",
            `浏览器版：已转换 ${parsed.pages.length} 页文本；当前浏览器不支持持久化`,
          )
          pushNotice(`已转换 ${parsed.pages.length} 页文本，当前使用浏览器内存模式`)
          return
        }
        const saved = await saveBrowserBook({
          title,
          totalPages: loadedPdf.numPages,
          parserEngine: parsed.engine,
          coordinateMode: parsed.coordinateMode,
          quality: parsed.quality,
          sourcePdfPath: file.name,
          sourcePdfFingerprint,
          pages: parsed.pages,
          chunks: parsed.chunks,
        })
        const asset = await getBrowserBook(saved.bookId)
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
        onLibraryStatus(
          "indexed",
          `已写入浏览器书库：${saved.textCharCount} 字正文`,
          saved.bookId,
        )
        void refreshStoredBooks()
        pushNotice("已转换并保存到浏览器书库")
        return
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
      onPhaseChange("error")
    } finally {
      setIsExtracting(false)
    }
  }

  function firstPdfFromDrop(event: ReactDragEvent<HTMLElement>) {
    return [...event.dataTransfer.files].find((file) =>
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    )
  }

  function handleImportDragOver(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = isTauriRuntime() ? "none" : "copy"
    setIsImportDragOver(true)
  }

  function handleImportDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsImportDragOver(false)
    }
  }

  function handleImportDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault()
    setIsImportDragOver(false)
    if (isTauriRuntime()) {
      pushNotice("桌面版请使用“导入 > 本地 PDF”选择 PDF，以便上传 MinerU 云端解析")
      return
    }
    const pdfFile = firstPdfFromDrop(event)
    if (!pdfFile) {
      setLoadError("请拖入 PDF 文件。")
      return
    }
    void handleFile(pdfFile)
  }

  function handleImportMenuOpen() {
    setPanelOpen("importMenuOpen", true)
  }

  async function handlePdfImportAction() {
    setPanelOpen("importMenuOpen", false)
    if (!isTauriRuntime()) {
      inputRef.current?.click()
      return
    }

    setLoadError("")
    setIsExtracting(true)
    pushNotice("请选择 PDF；文件会上传到 MinerU 云端解析")
    let pendingPdf: PDFDocumentProxy | null = null
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      })
      if (!selected || Array.isArray(selected)) {
        return
      }

      const pdfPath = selected
      const title = pdfPath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || "converted-book"
      const cachedBook = await findBookBySourcePdf(pdfPath)
      if (cachedBook) {
        pushNotice("已在本地书库找到转换稿，正在打开")
        const restoredBookId = await handleOpenStoredBook(cachedBook.bookId)
        if (restoredBookId) {
          pushNotice("已从本地书库打开，无需重新导入解析")
          return
        }
      }
      const pdfBytes = await readPdfFile(pdfPath)
      pendingPdf = await loadPdfDocument({ data: new Uint8Array(pdfBytes) })
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      pushNotice(`正在用 MinerU 云端解析《${title}》`)
      let unlistenProgress: (() => void) | null = null
      let saved
      try {
        unlistenProgress = await listenMineruProgress((event) => {
          pushNotice(mineruProgressMessage(event))
        })
        saved = await importPdfWithMineru(
          pdfPath,
          defaultMineruParseOptions(),
          pendingPdf.numPages,
        )
      } finally {
        unlistenProgress?.()
      }
      const asset = await loadStoredBookInitialWindow(saved.bookId, 1)
      await pdf?.cleanup()
      setPdf(pendingPdf)
      setLoadedPdfPath(asset.originalPdfPath)
      setOriginalPdfPath(asset.originalPdfPath)
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      pendingPdf = null
      onBookLoaded(asset.title, asset.totalPages)
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
      setReaderView("text")
      onLibraryStatus(
        "indexed",
        `MinerU 已解析 ${saved.textCharCount} 字，并生成 Markdown 转换稿`,
        saved.bookId,
      )
      void refreshStoredBooks()
      onPhaseChange("reading")
      pushNotice("已导入并完成 MinerU 云端解析")
    } catch (error) {
      handleImportFailure(error, "MinerU 云端解析失败")
    } finally {
      if (pendingPdf) {
        await pendingPdf.cleanup()
      }
      setIsExtracting(false)
    }
  }

  async function handleTextBookImportAction() {
    setPanelOpen("importMenuOpen", false)
    if (!isTauriRuntime()) {
      pushNotice("TXT / EPUB 导入需要桌面版读取本地文件")
      return
    }

    setLoadError("")
    setIsExtracting(true)
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Text / EPUB", extensions: ["txt", "text", "epub"] }],
      })
      if (!selected || Array.isArray(selected)) {
        return
      }

      const filePath = selected
      const title =
        filePath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.(txt|text|epub)$/i, "") || "电子书"
      const cachedBook = await findBookBySourcePdf(filePath)
      if (cachedBook?.parserEngine.startsWith("text-import-")) {
        pushNotice("已在本地书库找到同源电子书，正在打开")
        const restoredBookId = await handleOpenStoredBook(cachedBook.bookId)
        if (restoredBookId) {
          pushNotice("已从本地书库打开，无需重新导入")
          return
        }
      }
      pushNotice(`正在导入《${title}》`)
      const saved = await importPlainBook(filePath, title)
      const asset = await loadStoredBookInitialWindow(saved.bookId, 1)
      await pdf?.cleanup()
      setPdf(null)
      setLoadedPdfPath("")
      setOriginalPdfPath("")
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      onBookLoaded(asset.title, asset.totalPages)
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
      setReaderView("text")
      onLibraryStatus(
        "indexed",
        `已导入电子书：${saved.textCharCount} 字、${saved.chunkCount} 个 chunk`,
        saved.bookId,
      )
      void refreshStoredBooks()
      onPhaseChange("reading")
      pushNotice("已导入 TXT / EPUB，可搜索、翻译和框选解读")
    } catch (error) {
      handleImportFailure(error, "电子书导入失败")
    } finally {
      setIsExtracting(false)
    }
  }

  async function handleZoteroSearch() {
    if (!isTauriRuntime()) {
      setZoteroStatus("error")
      setZoteroMessage("从 Zotero 导入需要桌面版读取本机 Zotero 库")
      return
    }
    const query = zoteroQuery.trim()
    if (!query) {
      setZoteroStatus("idle")
      setZoteroResults([])
      setZoteroMessage("请输入论文标题或关键词")
      return
    }
    setZoteroStatus("searching")
    setZoteroMessage("")
    try {
      const results = await searchZoteroItems(query, 8)
      setZoteroResults(results)
      setZoteroStatus("idle")
      setZoteroMessage(
        results.length > 0
          ? `找到 ${results.length} 条 Zotero 文献`
          : "没有找到匹配文献；请确认 Zotero 已打开、PDF 附件仍在本机，并尝试更短标题；也可以改用本地 PDF 导入。",
      )
    } catch (error) {
      setZoteroResults([])
      setZoteroStatus("error")
      setZoteroMessage(error instanceof Error ? error.message : "Zotero 搜索失败")
    }
  }

  async function handleImportZoteroItem(result: ZoteroSearchResult) {
    if (!result.hasPdf) {
      setZoteroStatus("error")
      setZoteroMessage("这条 Zotero 文献没有可用 PDF 附件；请在 Zotero 中确认附件路径，或改用本地 PDF 导入。")
      return
    }
    setLoadError("")
    setIsExtracting(true)
    setZoteroStatus("importing")
    setZoteroMessage(`正在从 Zotero 导入《${result.title}》`)
    pushNotice("正在读取 Zotero PDF 路径并导入")
    let pendingPdf: PDFDocumentProxy | null = null
    let unlistenProgress: (() => void) | null = null
    try {
      unlistenProgress = await listenMineruProgress((event) => {
        const message = mineruProgressMessage(event)
        setZoteroMessage(message)
        pushNotice(message)
      })
      const saved = await importZoteroItem(result.itemKey, null)
      const asset = await loadStoredBookInitialWindow(saved.bookId, 1)
      if (asset.originalPdfPath) {
        const pdfBytes = await readPdfFile(asset.originalPdfPath)
        pendingPdf = await loadPdfDocument({ data: new Uint8Array(pdfBytes) })
      }
      await pdf?.cleanup()
      setPdf(pendingPdf)
      setLoadedPdfPath(pendingPdf ? asset.originalPdfPath : "")
      setOriginalPdfPath(asset.originalPdfPath)
      setPdfLoadStatus(pendingPdf ? "idle" : asset.originalPdfPath ? "error" : "idle")
      setPdfLoadError(pendingPdf || !asset.originalPdfPath ? "" : "原 PDF 资产不可用")
      pendingPdf = null
      onBookLoaded(asset.title, asset.totalPages)
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
      setReaderView("text")
      onLibraryStatus(
        "indexed",
        `已从 Zotero 导入并云端解析 ${saved.textCharCount} 字正文`,
        saved.bookId,
      )
      void refreshStoredBooks()
      setZoteroStatus("idle")
      setZoteroMessage("Zotero 文献已导入")
      setPanelOpen("zoteroOpen", false)
      onPhaseChange("reading")
      pushNotice("已从 Zotero 导入并打开转换稿")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setZoteroStatus("error")
      setZoteroMessage(message)
      handleImportFailure(error, "Zotero 导入失败")
    } finally {
      if (pendingPdf) {
        await pendingPdf.cleanup()
      }
      unlistenProgress?.()
      setIsExtracting(false)
    }
  }

  async function handleImportMineruSample() {
    setPanelOpen("importMenuOpen", false)
    if (!isTauriRuntime()) {
      pushNotice("MinerU 输出目录导入需要桌面版读取本地目录")
      return
    }

    setLoadError("")
    setIsExtracting(true)
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择包含 layout.json 和 full.md 的 MinerU 输出目录",
      })
      if (!selected || Array.isArray(selected)) {
        return
      }

      const outputDir = selected
      const title = outputDir.split(/[\\/]/).filter(Boolean).pop() || "MinerU 转换稿"
      pushNotice("正在读取 MinerU 结果并生成可引用文本")
      const saved = await importMineruOutput(outputDir, `${title} · MinerU`)
      const asset = await loadStoredBookInitialWindow(saved.bookId, 1)
      await pdf?.cleanup()
      setPdf(null)
      setLoadedPdfPath("")
      setOriginalPdfPath(asset.originalPdfPath)
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      onBookLoaded(asset.title, asset.totalPages)
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
      setReaderView("text")
      onLibraryStatus(
        "indexed",
        `已导入 MinerU 转换稿：${saved.textCharCount} 字`,
        saved.bookId,
      )
      void refreshStoredBooks()
      onPhaseChange("reading")
      pushNotice("已导入 MinerU 文本和版面坐标；解读、搜索会使用转换文字")
    } catch (error) {
      handleImportFailure(error, "MinerU 转换稿导入失败")
    } finally {
      setIsExtracting(false)
    }
  }

  async function refreshStoredBooks() {
    try {
      const books = isTauriRuntime() ? await listBooks() : await listBrowserBooks()
      setStoredBooks(books)
      return books
    } catch {
      setStoredBooks([])
      return []
    }
  }

  async function handleEmbeddingSettingsSaved() {
    const action = embeddingSaveIndexAction({
      bookId,
      libraryStatus,
      tauriRuntime: isTauriRuntime(),
    })
    if (action === "refresh-only") {
      pushNotice(
        isTauriRuntime()
          ? "Embedding 设置已保存；打开书籍后会按新配置建索引"
          : "Embedding 设置已保存；浏览器版不建立云端向量索引",
      )
      return
    }
    await rebuildCurrentBookSearchIndex({
      unavailableMessage: "Embedding 设置已保存；当前书籍还没有写入本地文本库",
      browserMessage: "Embedding 设置已保存；浏览器版不建立云端向量索引",
      progressMessage: "Embedding 设置已保存，正在按新配置重建当前书索引",
      successPrefix: "Embedding 设置已保存，当前书索引已重建",
      failureMessage: "Embedding 设置已保存，但当前书索引重建失败",
      notify: true,
    })
  }

  async function rebuildCurrentBookSearchIndex({
    unavailableMessage,
    browserMessage,
    progressMessage,
    successPrefix,
    failureMessage,
    notify,
  }: {
    unavailableMessage: string
    browserMessage: string
    progressMessage: string
    successPrefix: string
    failureMessage: string
    notify: boolean
  }) {
    if (!bookId || libraryStatus !== "indexed") {
      if (notify) pushNotice(unavailableMessage)
      return null
    }
    if (!isTauriRuntime()) {
      if (notify) pushNotice(browserMessage)
      return null
    }

    pushNotice(progressMessage)
    try {
      const taskId = createSearchIndexTaskId()
      searchIndexTaskRef.current = {
        taskId,
        bookId,
        successPrefix,
        failureMessage,
        notify,
      }
      const task = await rebuildSearchIndexAsync(bookId, taskId)
      searchIndexTaskRef.current = {
        taskId: task.taskId,
        bookId,
        successPrefix,
        failureMessage,
        notify,
      }
      return task
    } catch {
      if (notify) pushNotice(failureMessage)
      return null
    }
  }

  function handleSearchIndexProgress(event: SearchIndexProgressEvent) {
    const activeTask = searchIndexTaskRef.current
    if (!activeTask || event.taskId !== activeTask.taskId) {
      return
    }
    if (event.stage === "completed") {
      if (activeTask.notify && event.summary) {
        pushNotice(searchIndexSuccessMessage(activeTask.successPrefix, event.summary))
      }
      searchIndexTaskRef.current = null
      void refreshStoredBooks()
      return
    }
    if (event.stage === "failed") {
      if (activeTask.notify) {
        pushNotice(activeTask.failureMessage)
      }
      searchIndexTaskRef.current = null
    }
  }

  async function handleOpenStoredBook(
    storedBookId: string,
    options: {
      silent?: boolean
      page?: number
      readerView?: StartupReaderView
      zoom?: number
    } = {},
  ) {
    try {
      const asset = isTauriRuntime()
        ? await loadStoredBookInitialWindow(storedBookId, options.page ?? 1)
        : await getBrowserBook(storedBookId)
      await pdf?.cleanup()
      setPdf(null)
      setLoadedPdfPath("")
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      const hasPdfSource = assetHasPdfSource(asset)
      setOriginalPdfPath(hasPdfSource ? asset.originalPdfPath : "")
      onBookLoaded(asset.title, asset.totalPages)
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
      const textCharCount = "textCharCount" in asset ? asset.textCharCount : asset.text.length
      onLibraryStatus(
        "indexed",
        `已打开 Markdown 转换稿：${textCharCount} 字正文${hasPdfSource ? "，原 PDF 可校对" : ""}`,
        asset.bookId,
      )
      const restoredPage = clampPage(options.page ?? 1, asset.totalPages)
      onPageChange(restoredPage)
      if (options.zoom) {
        onZoomChange(options.zoom)
      }
      const restoredView =
        options.readerView === "pdf" && hasPdfSource
          ? "pdf"
          : options.readerView === "tldr"
            ? "tldr"
          : options.readerView === "translation" && isTauriRuntime()
            ? "translation"
            : "text"
      setReaderView(restoredView)
      if (!options.silent) {
        pushNotice(
          hasPdfSource
            ? "已打开转换稿；原 PDF 可用于校对坐标"
            : "已打开转换稿；搜索、解读和追问会直接使用转换文字",
        )
      }
      return asset.bookId
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : "无法打开已转换文本稿")
      return null
    }
  }

  async function handleDeleteStoredBook(storedBookId: string) {
    if (!canUseLibrary) {
      pushNotice("当前环境没有可用书库")
      return
    }
    try {
      if (isTauriRuntime()) {
        await deleteBook(storedBookId)
      } else {
        await deleteBrowserBook(storedBookId)
      }
      if (storedBookId === bookId) {
        await pdf?.cleanup()
        setPdf(null)
        setLoadedPdfPath("")
        setOriginalPdfPath("")
        setPdfLoadStatus("idle")
        setPdfLoadError("")
        onBookLoaded("未导入书籍", 0)
        onParsedDocument([], [], "", "", null)
        onLibraryStatus("idle", "")
        setReaderView("text")
        try {
          window.localStorage.removeItem(READER_SESSION_STORAGE_KEY)
        } catch {
          // Ignore storage failures; deleting the book still succeeded.
        }
      }
      await refreshStoredBooks()
      pushNotice(isTauriRuntime() ? "已删除转换书籍和本地文本资产" : "已从浏览器书库删除转换稿")
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : "删除书籍失败")
    }
  }

  async function handleOpenStoredBookFromShelf(storedBookId: string) {
    const restoredBookId = await handleOpenStoredBook(storedBookId)
    if (restoredBookId) {
      setPanelOpen("libraryOpen", false)
    }
  }

  async function loadOriginalPdf(
    pdfPath: string,
    options: { switchToPdf?: boolean; notify?: boolean; force?: boolean } = {},
  ) {
    if (!isTauriRuntime()) {
      pushNotice("原 PDF 校对需要桌面版读取本机文件")
      return false
    }
    const trimmedPath = pdfPath.trim()
    if (!trimmedPath) {
      setPdfLoadStatus("error")
      setPdfLoadError("当前书籍没有保存原 PDF 副本")
      if (options.notify ?? true) {
        pushNotice("当前书籍没有可校对的原 PDF")
      }
      return false
    }
    if (!options.force && pdf && loadedPdfPath === trimmedPath) {
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      if (options.switchToPdf) {
        switchReaderView("pdf")
      }
      return true
    }
    originalPdfLoadingPathRef.current = trimmedPath
    setPdfLoadStatus("loading")
    setPdfLoadError("")
    try {
      const pdfBytes = await readPdfFile(trimmedPath)
      const loadedPdf = await loadPdfDocument({ data: new Uint8Array(pdfBytes) })
      if (originalPdfLoadingPathRef.current !== trimmedPath) {
        await loadedPdf.cleanup()
        return false
      }
      await pdf?.cleanup()
      setPdf(loadedPdf)
      setLoadedPdfPath(trimmedPath)
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      if (options.switchToPdf) {
        switchReaderView("pdf")
      }
      return true
    } catch (error) {
      if (originalPdfLoadingPathRef.current !== trimmedPath) {
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      await pdf?.cleanup()
      setPdf(null)
      setLoadedPdfPath("")
      setPdfLoadStatus("error")
      setPdfLoadError(message)
      if (options.notify ?? true) {
        pushNotice("原 PDF 读取失败；仍可查看转换稿")
      }
      return false
    }
  }

  async function loadStoredBookInitialWindow(storedBookId: string, page: number) {
    const manifest = await getConvertedBookManifest(storedBookId)
    const restoredPage = clampPage(page, manifest.totalPages)
    const halfWindow = Math.floor(STORED_BOOK_INITIAL_PAGE_WINDOW / 2)
    const startPage = Math.max(0, restoredPage - 1 - halfWindow)
    const window = await getConvertedBookPages(
      storedBookId,
      startPage,
      STORED_BOOK_INITIAL_PAGE_WINDOW,
    )
    return storedBookAssetFromManifestWindow(manifest, window)
  }

  async function requestStoredPageWindow(startPage: number, pageCount: number) {
    if (!isTauriRuntime() || !bookId || libraryStatus !== "indexed") {
      return
    }
    const safeStart = Math.max(0, Math.floor(startPage))
    const safeCount = Math.max(1, Math.ceil(pageCount))
    const windowKey = `${bookId}:${safeStart}:${safeCount}`
    if (loadingPageWindowsRef.current.has(windowKey)) {
      return
    }
    loadingPageWindowsRef.current.add(windowKey)
    try {
      const window = await getConvertedBookPages(bookId, safeStart, safeCount)
      onParsedDocumentWindow(window.pages, window.chunks, window.text, window.markdown)
    } catch {
      // Page windows are opportunistic; the reader keeps already loaded pages usable.
    } finally {
      loadingPageWindowsRef.current.delete(windowKey)
    }
  }

  async function handlePdfViewClick() {
    if (pdf && (!isTauriRuntime() || loadedPdfPath === originalPdfPath)) {
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      switchReaderView("pdf")
      return
    }
    if (!originalPdfPath) {
      switchReaderView("pdf")
      setPdfLoadStatus("error")
      setPdfLoadError("当前书籍没有保存原 PDF 副本")
      pushNotice("当前书籍没有可校对的原 PDF")
      return
    }
    switchReaderView("pdf")
    await loadOriginalPdf(originalPdfPath, { switchToPdf: false, notify: true })
  }

  async function handleOpenOriginalPdfExternally() {
    if (!bookId || !isTauriRuntime()) {
      pushNotice("用系统打开原 PDF 需要桌面版读取本机文件")
      return
    }
    try {
      await openBookAsset(bookId, "originalPdf")
      pushNotice("已用系统 PDF 阅读器打开原文件")
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : "无法打开原 PDF")
    }
  }

  const canShowConvertedText = parsedPages.length > 0
  const canRead = Boolean(pdf && totalPages > 0)
  const currentBookHasPdfSource = bookHasPdfParser(parserEngine) && originalPdfPath.toLowerCase().endsWith(".pdf")
  const canOpenPdfView =
    totalPages > 0 && (canRead || (isTauriRuntime() && currentBookHasPdfSource))
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

  useEffect(() => {
    let cancelled = false
    void refreshStoredBooks().then((books) => {
      const restoreTarget = nextStartupRestoreTarget(
        canUseLibrary,
        bookId,
        libraryStatus,
        books,
        readStartupSession(),
      )
      if (cancelled || !restoreTarget) {
        return
      }
      void restoreStoredBook(restoreTarget)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!canUseLibrary || !bookId || libraryStatus !== "indexed" || totalPages <= 0) {
      return
    }
    window.localStorage.setItem(
      READER_SESSION_STORAGE_KEY,
      serializeStartupSession({
        bookId,
        currentPage: safePage,
        readerView,
        zoom,
        updatedAt: Date.now(),
      }),
    )
  }, [bookId, libraryStatus, safePage, readerView, zoom, totalPages, canUseLibrary])

  useEffect(() => {
    setTranslation(null)
    setTranslationMessage("")
    if (!bookId || libraryStatus !== "indexed" || !isTauriRuntime()) {
      return
    }
    let cancelled = false
    void translationStatus(bookId)
      .then((status) => {
        if (!cancelled) {
          setTranslation(status)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTranslationMessage(error instanceof Error ? error.message : "无法读取翻译状态")
        }
      })
    return () => {
      cancelled = true
    }
  }, [bookId, libraryStatus])

  useEffect(() => {
    if (!bookId || readerView !== "translation" || !isTauriRuntime()) {
      return
    }
    let cancelled = false
    const poll = () => {
      void translationStatus(bookId)
        .then((status) => {
          if (!cancelled) {
            setTranslation(status)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setTranslationMessage(error instanceof Error ? error.message : "无法读取翻译状态")
          }
        })
    }
    poll()
    const timer = window.setInterval(poll, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [bookId, readerView])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query || !bookId || libraryStatus !== "indexed") {
      setBackendSearchHits([])
      setSearchStatus("idle")
      return
    }

    let cancelled = false
    setSearchStatus("searching")
    setBackendSearchHits([])
    const timer = window.setTimeout(() => {
      if (!isTauriRuntime()) {
        setBackendSearchHits([])
        setSearchStatus("fallback")
        return
      }
      void searchBook(bookId, query, 12)
        .then((hits) => {
          if (!cancelled) {
            setBackendSearchHits(hits)
            setSearchStatus("idle")
          }
        })
        .catch(() => {
          if (!cancelled) {
            setBackendSearchHits([])
            setSearchStatus("fallback")
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bookId, libraryStatus, searchQuery])

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

  function readStartupSession() {
    try {
      return parseStartupSession(window.localStorage.getItem(READER_SESSION_STORAGE_KEY))
    } catch {
      return null
    }
  }

  async function restoreStoredBook(target: StartupRestoreTarget) {
    const restoredBookId = await handleOpenStoredBook(target.bookId, {
      silent: true,
      page: target.currentPage,
      readerView: target.readerView,
      zoom: target.zoom,
    })
    if (!restoredBookId && target.source === "last-session") {
      try {
        window.localStorage.removeItem(READER_SESSION_STORAGE_KEY)
      } catch {
        // Ignore storage failures; startup can still fall back next launch.
      }
    }
  }

  async function handleCopy() {
    if (!selectionText) {
      pushNotice("请先框选一段文字")
      return
    }
    await navigator.clipboard?.writeText(selectionText)
  }

  async function copyInterpretationResult() {
    const payload = formatInterpretationClipboardText(
      selectionText,
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

  function handleQuestionSubmit() {
    const trimmed = question.trim()
    if (!trimmed) {
      return
    }
    onQuestionSubmit(trimmed)
    setQuestion("")
    setAskOpen(false)
    pushNotice("追问已提交")
  }

  function toggleTheme() {
    document.documentElement.classList.toggle("dark")
    pushNotice("已切换主题")
  }

  async function refreshTranslation(targetBookId = bookId) {
    if (!targetBookId || !isTauriRuntime()) {
      setTranslation(null)
      return null
    }
    try {
      const status = await translationStatus(targetBookId)
      setTranslation(status)
      return status
    } catch (error) {
      setTranslationMessage(error instanceof Error ? error.message : "无法读取翻译状态")
      return null
    }
  }

  async function handleStartTranslation(force = false) {
    if (!bookId || !canShowConvertedText) {
      pushNotice("当前书籍还没有可翻译的转换稿")
      return
    }
    if (!isTauriRuntime()) {
      pushNotice("整本翻译需要桌面版和 LLM provider")
      return
    }
    switchReaderView("translation", { restorePage: !force })
    setTranslationBusy(true)
    setTranslationMessage(force ? "正在重新提交整本翻译任务" : "正在提交整本翻译任务")
    try {
      const status = await startTranslation(bookId, force)
      setTranslation(status)
      setTranslationMessage(
        status.running
          ? "翻译任务已在后台运行"
          : status.completedPages >= status.totalPages
            ? "整本翻译已完成"
            : "翻译状态已更新",
      )
      pushNotice(status.running ? "已开始后台翻译整本书" : "翻译缓存已就绪")
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法启动翻译任务"
      setTranslationMessage(message)
      pushNotice(message)
    } finally {
      setTranslationBusy(false)
    }
  }

  async function handleCancelTranslation() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    setTranslationBusy(true)
    try {
      const cancelled = await cancelTranslation(bookId)
      const status = await refreshTranslation(bookId)
      setTranslationMessage(cancelled ? "已请求取消翻译任务" : "当前没有运行中的翻译任务")
      if (status?.running) {
        pushNotice("翻译任务会在当前片段结束后停止")
      }
    } catch (error) {
      setTranslationMessage(error instanceof Error ? error.message : "取消翻译失败")
    } finally {
      setTranslationBusy(false)
    }
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card/80 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            aria-label="收起阅读侧栏"
            onClick={() => togglePanel("sidebarOpen")}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{bookTitle}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{totalPages > 0 ? readerViewLabel(readerView) : "等待导入"}</span>
              <Badge variant="secondary">{runtimeLabel}</Badge>
              <Badge
                variant="secondary"
                className="max-w-[240px] truncate"
                title={llmProviderTitle}
                data-testid="llm-provider-badge"
              >
                AI: {llmProviderText}
              </Badge>
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-2" aria-label="阅读工具栏">
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept="application/pdf,.pdf"
            disabled={isTauriRuntime()}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleFile(file)
              }
              event.currentTarget.value = ""
            }}
          />
          <Button
            size="sm"
            disabled={isExtracting}
            aria-expanded={importMenuOpen}
            onClick={handleImportMenuOpen}
          >
            {isExtracting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            {importButtonLabel}
          </Button>
          <Button
            size="sm"
            variant={libraryOpen ? "secondary" : "ghost"}
            aria-label="打开书架"
            title={libraryOpen ? "收起书架" : "打开书架"}
            onClick={() => {
              togglePanel("libraryOpen")
              void refreshStoredBooks()
            }}
          >
            <Library className="mr-1.5 h-4 w-4" />
            书架
          </Button>
          <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
            <Button
              size="sm"
              variant={readerView === "text" ? "secondary" : "ghost"}
              disabled={!canShowConvertedText}
              className="h-7 px-2.5"
              onClick={() => switchReaderView("text")}
            >
              <FileText className="mr-1.5 h-4 w-4" />
              转换稿
            </Button>
            <Button
              size="sm"
              variant={readerView === "tldr" ? "secondary" : "ghost"}
              disabled={!canShowConvertedText}
              className="h-7 px-2.5"
              onClick={() => switchReaderView("tldr")}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              TLDR
            </Button>
            <Button
              size="sm"
              variant={readerView === "translation" ? "secondary" : "ghost"}
              disabled={!canShowConvertedText || !bookId || !isTauriRuntime()}
              className="h-7 px-2.5"
              title={
                isTauriRuntime()
                  ? "打开左英右中对照翻译视图"
                  : "对照翻译需要桌面版和 LLM provider"
              }
              onClick={() => {
                switchReaderView("translation")
                void refreshTranslation()
              }}
            >
              <Languages className="mr-1.5 h-4 w-4" />
              对照翻译
            </Button>
            <Button
              size="sm"
              variant={readerView === "pdf" ? "secondary" : "ghost"}
              disabled={!canOpenPdfView}
              className="h-7 px-2.5"
              title={canOpenPdfView ? "打开原 PDF 校对坐标" : "当前书籍没有可用原 PDF 副本"}
              onClick={() => void handlePdfViewClick()}
            >
              {pdfLoadStatus === "loading" && readerView === "pdf" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="mr-1.5 h-4 w-4" />
              )}
              PDF
            </Button>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="搜索"
            onClick={() => {
              togglePanel("searchOpen")
              pushNotice(parsedPages.length > 0 ? "搜索面板已切换" : "导入书籍并生成转换稿后才能搜索")
            }}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="主题" onClick={toggleTheme}>
            <SunMoon className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="设置"
            data-testid="settings-button"
            onClick={() => {
              togglePanel("settingsOpen")
            }}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </nav>
      </header>
      <LlmSettingsPanel
        open={settingsOpen}
        onClose={() => setPanelOpen("settingsOpen", false)}
        onLlmSettingsSaved={(settings) => {
          setLlmSettings(settings)
          setLlmSettingsError("")
        }}
        onEmbeddingSettingsSaved={() => void handleEmbeddingSettingsSaved()}
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
        message={zoteroMessage}
        onQueryChange={setZoteroQuery}
        onSearch={() => void handleZoteroSearch()}
        onImport={(result) => void handleImportZoteroItem(result)}
        onClose={() => setPanelOpen("zoteroOpen", false)}
      />

      {notice ? (
        <div className="pointer-events-none fixed left-1/2 top-16 z-50 max-w-md -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
          {notice}
        </div>
      ) : null}

      <main
        className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
        style={{
          gridTemplateColumns: sidebarOpen
            ? "240px minmax(640px,1fr) 360px"
            : "0px minmax(640px,1fr) 360px",
        }}
      >
        <aside
          aria-hidden={!sidebarOpen}
          className={`flex min-h-0 flex-col overflow-hidden border-r bg-card/45 p-3 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
            sidebarOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-3 opacity-0"
          }`}
        >
            {searchOpen ? (
              <div className="mb-3 shrink-0 rounded-md border bg-background p-2 text-xs">
                <div className="mb-2 flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Search className="h-3.5 w-3.5" />
                  全文索引
                </div>
                <input
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="搜索目录和正文"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery.trim() ? (
                  <div className="mt-2 max-h-72 space-y-1 overflow-auto pr-1">
                    {searchStatus === "searching" ? (
                      <div className="rounded-md bg-muted px-2 py-2 text-muted-foreground">
                        正在搜索
                      </div>
                    ) : null}
                    {searchStatus === "fallback" ? (
                      <div className="rounded-md bg-muted px-2 py-2 text-muted-foreground">
                        使用内存搜索
                      </div>
                    ) : null}
                    {chunkResults.length > 0 ? (
                      chunkResults.map(({ chunk, snippet }) => (
                        <button
                          key={chunk.chunkId}
                          className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                          onClick={() => {
                            handleChunkSelect(chunk)
                          }}
                        >
                          <span className="font-medium">相关段落</span>
                          <span className="mt-1 block line-clamp-2 text-muted-foreground">
                            {stripSearchMarkup(snippet || chunk.text).slice(0, 90)}
                          </span>
                        </button>
                      ))
                    ) : searchResults.length > 0 ? (
                      searchResults.map(({ page }) => (
                        <button
                          key={page.pageIndex}
                          className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                          onClick={() => {
                            switchReaderView("text", { page: page.pageIndex + 1 })
                          }}
                        >
                          <span className="font-medium">正文匹配</span>
                          <span className="mt-1 block line-clamp-2 text-muted-foreground">
                            {page.text.slice(0, 90)}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-md bg-muted px-2 py-2 text-muted-foreground">
                        没有匹配结果
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {readerView !== "pdf" && readerView !== "tldr" && readerOutline.length > 0 ? (
              <ReaderOutlinePanel
                entries={readerOutline}
                currentPage={safePage}
                activeEntryId={
                  outlineTarget && outlineTarget.pageIndex + 1 === safePage
                    ? outlineTarget.entryId
                    : undefined
                }
                className="flex-1"
                onSelect={handleOutlineSelect}
              />
            ) : null}
            {readerView !== "pdf" && readerView !== "tldr" && readerOutline.length === 0 ? (
              <div className="min-h-0 flex-1 rounded-md border border-dashed bg-background px-3 py-8 text-center text-xs text-muted-foreground">
                {parsedPages.length > 0 ? "未识别到章节标题目录" : "导入书籍后显示目录"}
              </div>
            ) : null}
        </aside>

        <section
          key={readerView}
          className={
            canShowConvertedText && (readerView === "text" || readerView === "translation")
              ? "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)] animate-fade-in"
              : canShowConvertedText && readerView === "tldr"
                ? "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)] animate-fade-in"
              : "min-h-0 overflow-auto bg-[hsl(38_22%_91%)] px-8 py-8 animate-fade-in"
          }
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
                return kind === "spark" || kind === "note"
              })}
              selectionText={selectionText}
              selectionRects={selectionRects}
              selectionAnchor={selectionAnchor}
              quality={textQuality}
              askOpen={askOpen}
              question={question}
              onCopySelection={handleCopy}
              onExplain={onDeepInterpret}
              onPlainExplain={onPlainExplain}
              onSpark={onOpenSpark}
              onOpenSparkItem={(item) => onOpenSparkInterpretation(item, "text")}
              onAskToggle={() => setAskOpen((open) => !open)}
              onQuestionChange={setQuestion}
              onQuestionSubmit={handleQuestionSubmit}
              onHighlight={handleHighlight}
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
              busy={translationBusy}
              message={translationMessage}
              selectionText={selectionText}
              selectionRects={selectionRects}
              selectionAnchor={selectionAnchor}
              sparkItems={interpretationHistory.filter((item) => {
                const kind = item.kind ?? "interpretation"
                return kind === "spark" || kind === "note"
              })}
              askOpen={askOpen}
              question={question}
              onCurrentPageChange={onVisiblePageChange}
              onStart={() => void handleStartTranslation(false)}
              onRetranslate={() => void handleStartTranslation(true)}
              onRetryFailed={() => void handleStartTranslation(false)}
              onCancel={() => void handleCancelTranslation()}
              onCopySelection={handleCopy}
              onExplain={onDeepInterpret}
              onPlainExplain={onPlainExplain}
              onSpark={onOpenSpark}
              onOpenSparkItem={(item) => onOpenSparkInterpretation(item, "translation")}
              onAskToggle={() => setAskOpen((open) => !open)}
              onQuestionChange={setQuestion}
              onQuestionSubmit={handleQuestionSubmit}
              onHighlight={handleHighlight}
              onTextSelection={handleTextSelection}
              onClearSelection={onClearSelection}
              onPageWindowRequest={requestStoredPageWindow}
            />
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
              askOpen={askOpen}
              question={question}
              onAskToggle={() => setAskOpen((open) => !open)}
              onCopy={handleCopy}
              onExplain={onDeepInterpret}
              onHighlight={handleHighlight}
              onPlainExplain={onPlainExplain}
              onSpark={onOpenSpark}
              onQuestionChange={setQuestion}
              onQuestionSubmit={handleQuestionSubmit}
              onRenderError={(message) => {
                setLoadError(message)
                setPdfLoadStatus("error")
                setPdfLoadError(message)
                void pdf?.cleanup()
                setPdf(null)
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
              className={`mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center transition-colors duration-200 ${
                isImportDragOver ? "border-primary bg-card/90 ring-2 ring-primary/20" : "bg-card/70"
              }`}
              onDragOver={handleImportDragOver}
              onDragLeave={handleImportDragLeave}
              onDrop={handleImportDrop}
            >
              <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
              <h1 className="text-xl font-semibold">先体验框选精读，或导入自己的 PDF</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
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
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
                  {loadError}
                </p>
              ) : null}
            </div>
          )}
        </section>

        <aside className="min-h-0 animate-fade-in overflow-y-auto border-l bg-card/65 p-3 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none">
          {sparkPanelOpen ? (
            <SparkPanel
              mode={sparkMode}
              selectionText={selectionText}
              answer={interpretation}
              answerSource={answerSource}
              followUps={followUps}
              noteDraft={sparkNoteDraft}
              noteItems={sparkNoteItems}
              question={sparkQuestion}
              loading={sparkLoading}
              error={sparkError}
              citationChunkIds={citationChunkIds}
              onModeChange={onSparkModeChange}
              onNoteDraftChange={onSparkNoteChange}
              onQuestionChange={onSparkQuestionChange}
              onSaveNote={onSparkSaveNote}
              onAsk={onSparkAsk}
              onClose={onCloseSpark}
              onCopy={copyInterpretationResult}
              onCitationClick={(chunkId) => {
                const citationPage = evidence.find((item) => item.chunkId === chunkId)?.pageIndex
                switchReaderView(
                  "text",
                  citationPage === undefined
                    ? { restorePage: false }
                    : { page: citationPage + 1 },
                )
                onCitationClick?.(chunkId)
              }}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">解读</div>
                <Badge variant="secondary">可回跳引用</Badge>
              </div>
              <InterpretationCard
                phase={phase}
                selectionText={selectionText}
                selectionRects={selectionRects}
                evidence={evidence}
                citationChunkIds={citationChunkIds}
                agentTrace={agentTrace}
                interpretation={interpretation}
                answerSource={answerSource}
                errorMessage={interpretationError}
                followUps={followUps}
                askOpen={askOpen}
                question={question}
                onAskToggle={() => setAskOpen((open) => !open)}
                onCopy={copyInterpretationResult}
                onQuestionChange={setQuestion}
                onQuestionSubmit={handleQuestionSubmit}
                onCitationClick={(chunkId) => {
                  const citationPage = evidence.find((item) => item.chunkId === chunkId)?.pageIndex
                  switchReaderView(
                    "text",
                    citationPage === undefined
                      ? { restorePage: false }
                      : { page: citationPage + 1 },
                  )
                  onCitationClick?.(chunkId)
                }}
                onRegenerate={onRegenerate}
                onSave={handleHighlight}
                onStop={onStop}
                onOpenSettings={() => setPanelOpen("settingsOpen", true)}
                runtimeHint={interpretationRuntimeHint}
              />
            </>
          )}
        </aside>
      </main>

      {readerView === "pdf" ? (
        <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t bg-card px-4 text-sm text-muted-foreground">
          <Button
            size="icon"
            variant="ghost"
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

function stripSearchMarkup(value: string) {
  return value.replaceAll("<mark>", "").replaceAll("</mark>", "")
}

function storedBookAssetFromManifestWindow(
  manifest: ConvertedBookManifest,
  window: ConvertedBookPageWindow,
) {
  const pages = Array.from({ length: manifest.totalPages }, (_, pageIndex) => {
    const loadedPage = window.pages.find((page) => page.pageIndex === pageIndex)
    return loadedPage ? { ...loadedPage, loaded: true } : unloadedParsedPage(pageIndex)
  })
  return {
    bookId: manifest.bookId,
    title: manifest.title,
    totalPages: manifest.totalPages,
    textCharCount: manifest.textCharCount,
    markdownCharCount: manifest.markdownCharCount,
    text: window.text,
    markdown: window.markdown,
    textPath: manifest.textPath,
    markdownPath: manifest.markdownPath,
    originalPdfPath: manifest.originalPdfPath,
    sourcePdfPath: manifest.sourcePdfPath,
    sourcePdfFingerprint: manifest.sourcePdfFingerprint,
    parserEngine: manifest.parserEngine,
    coordinateMode: manifest.coordinateMode,
    quality: manifest.quality,
    tldrText: manifest.tldrText,
    tldrGeneratedAt: manifest.tldrGeneratedAt,
    tldrModel: manifest.tldrModel,
    tldrSourceVersion: manifest.tldrSourceVersion,
    pages,
    chunks: window.chunks,
  }
}

function tldrMetadataFromAsset(asset: {
  tldrText?: string | null
  tldrGeneratedAt?: string | null
  tldrModel?: string | null
  tldrSourceVersion?: number | null
}) {
  return {
    tldrText: asset.tldrText ?? null,
    tldrGeneratedAt: asset.tldrGeneratedAt ?? null,
    tldrModel: asset.tldrModel ?? null,
    tldrSourceVersion: asset.tldrSourceVersion ?? null,
  }
}

function unloadedParsedPage(pageIndex: number): ParsedPage {
  return {
    pageIndex,
    text: "",
    markdown: "",
    loaded: false,
  }
}

function defaultMineruParseOptions() {
  return {
    isOcr: false,
    language: "ch",
    modelVersion: "vlm",
    enableFormula: true,
    enableTable: true,
    pageRanges: null,
  }
}

function readerViewLabel(view: ReaderView) {
  switch (view) {
    case "text":
      return "转换稿主视图"
    case "tldr":
      return "TLDR"
    case "pdf":
      return "原 PDF 校对"
    case "translation":
      return "对照翻译"
  }
}

function coordinateModeIsApproximate(coordinateMode: string) {
  return coordinateMode
    .split(/[-_\s]+/)
    .some((part) => part.toLowerCase() === "approx" || part.toLowerCase() === "approximate")
}

function bookHasPdfParser(parserEngine: string) {
  return !parserEngine.startsWith("text-import-")
}

function assetHasPdfSource(asset: { parserEngine: string; originalPdfPath: string }) {
  return bookHasPdfParser(asset.parserEngine) && asset.originalPdfPath.toLowerCase().endsWith(".pdf")
}

function searchIndexSuccessMessage(successPrefix: string, summary: SearchIndexSummary) {
  return summary.vectorCount > 0 && summary.embeddingMatchesConfig
    ? `${successPrefix}：向量索引已就绪`
    : `${successPrefix}：当前使用 FTS 文本检索`
}

function createSearchIndexTaskId() {
  return `search-index-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center rounded-lg border bg-card/80 p-8 text-center shadow-sm">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {status === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <BookOpen className="h-5 w-5" />
        )}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
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
