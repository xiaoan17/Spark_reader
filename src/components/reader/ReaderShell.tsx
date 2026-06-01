import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  ExternalLink,
  Languages,
  Highlighter,
  Loader2,
  Library,
  Minus,
  Plus,
  RefreshCw,
  PanelLeftClose,
  Search,
  Settings,
  SunMoon,
  Trash2,
  Upload,
} from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { getDocument, type PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { InterpretationCard } from "@/components/interpretation/InterpretationCard"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import { SelectionToolbar } from "@/components/selection/SelectionToolbar"
import { LlmSettingsPanel } from "@/components/settings/LlmSettingsPanel"
import { normalizeWhitespace, resolveTextQuoteSelector } from "@/core/text-quote-selector"
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
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"
import { extractPdfText } from "@/core/pdf-text-extractor"
import { searchParsedChunks, searchParsedPages } from "@/core/local-interpreter"
import { formatInterpretationClipboardText } from "./interpretation-clipboard"
import {
  rawOffsetForNormalizedOffset,
  textSelectionAnchorFromDom as textSelectionAnchorFromDomSelection,
  textSelectionAnchorFromOffsets,
} from "./text-selection-anchor"
import { shouldRenderCurrentTextSelection } from "./current-selection"
import { highlightSaveFeedback } from "./highlight-save-feedback"
import {
  buildPdfOutlineEntries,
  buildReaderOutline,
  type ReaderOutlineEntry,
} from "./reader-outline"
import { ReaderOutlinePanel } from "./ReaderOutlinePanel"
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
  getConvertedBook,
  deleteBook,
  findBookBySourcePdf,
  importMineruOutput,
  importPdfWithMineru,
  importZoteroItem,
  isTauriRuntime,
  listenMineruProgress,
  listBooks,
  openBookAsset,
  readPdfFile,
  rebuildSearchIndex,
  searchBook,
  searchZoteroItems,
  startTranslation,
  translationStatus,
  cancelTranslation,
  type SearchBookHit,
  type StoredBookSummary,
  type MinerUProgressEvent,
  type ZoteroSearchResult,
  type TranslationStatus,
} from "@/core/library-api"
import { readerChunkSearchResults } from "./search-results"

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
  onSaveHighlight: () => Promise<boolean>
  onOpenHighlight: (highlight: SavedHighlight) => void
  onDeleteHighlight: (highlightId: string) => void
  onOpenInterpretation: (item: SavedInterpretation) => void
  onDeleteInterpretation: (interpretationId: string) => void
  onCitationClick?: (chunkId: string) => void
  onRegenerate: () => void
  onStop: () => void
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
  highlights,
  interpretationHistory: _interpretationHistory,
  parsedPages,
  parsedChunks,
  parserEngine: _parserEngine,
  coordinateMode,
  activeChunkId,
  textQuality,
  zoom,
  onBookLoaded,
  onLibraryStatus,
  onParsedDocument,
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
  onSaveHighlight,
  onOpenHighlight: _onOpenHighlight,
  onDeleteHighlight: _onDeleteHighlight,
  onOpenInterpretation: _onOpenInterpretation,
  onDeleteInterpretation: _onDeleteInterpretation,
  onCitationClick,
  onRegenerate,
  onStop,
}: ReaderShellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const originalPdfLoadingPathRef = useRef("")
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState("")
  const [pdfLoadStatus, setPdfLoadStatus] = useState<"idle" | "loading" | "error">("idle")
  const [pdfLoadError, setPdfLoadError] = useState("")
  const [originalPdfPath, setOriginalPdfPath] = useState("")
  const [loadedPdfPath, setLoadedPdfPath] = useState("")
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const [notice, setNotice] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [zoteroQuery, setZoteroQuery] = useState("")
  const [zoteroResults, setZoteroResults] = useState<ZoteroSearchResult[]>([])
  const [zoteroStatus, setZoteroStatus] = useState<"idle" | "searching" | "importing" | "error">("idle")
  const [zoteroMessage, setZoteroMessage] = useState("")
  const [readerView, setReaderView] = useState<ReaderView>("text")
  const [pageJumpValue, setPageJumpValue] = useState("1")
  const [searchQuery, setSearchQuery] = useState("")
  const [backendSearchHits, setBackendSearchHits] = useState<SearchBookHit[]>([])
  const [searchStatus, setSearchStatus] = useState<"idle" | "searching" | "fallback">("idle")
  const [isExtracting, setIsExtracting] = useState(false)
  const [storedBooks, setStoredBooks] = useState<StoredBookSummary[]>([])
  const [pdfOutlineEntries, setPdfOutlineEntries] = useState<ReaderOutlineEntry[]>([])
  const [translation, setTranslation] = useState<TranslationStatus | null>(null)
  const [translationBusy, setTranslationBusy] = useState(false)
  const [translationMessage, setTranslationMessage] = useState("")
  const canUseLibrary = isTauriRuntime() || browserLibraryAvailable()

  useEffect(() => {
    return () => {
      void pdf?.cleanup()
    }
  }, [pdf])

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
      onLibraryStatus("idle", "桌面端导入统一使用 MinerU 云端解析")
      pushNotice("桌面端导入统一使用 MinerU，请使用“导入 PDF”按钮选择本地文件")
      return
    }
    setLoadError("")
    onPhaseChange("reading")
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const loadedPdf = await getDocument({ data: bytes }).promise
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
      const parsed = await extractPdfText(loadedPdf)
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
            `浏览器预览模式：已转换 ${parsed.pages.length} 页文本；当前浏览器不支持持久化`,
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

  async function handleImportClick() {
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
      pendingPdf = await getDocument({ data: new Uint8Array(pdfBytes) }).promise
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
      const asset = await getConvertedBook(saved.bookId)
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
      const message = error instanceof Error ? error.message : String(error)
      handleImportFailure(message, "MinerU 云端解析失败")
    } finally {
      if (pendingPdf) {
        await pendingPdf.cleanup()
      }
      setIsExtracting(false)
    }
  }

  async function handleZoteroSearch() {
    if (!isTauriRuntime()) {
      setZoteroStatus("error")
      setZoteroMessage("从 Zotero 导入需要桌面端后端")
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
          : "没有找到匹配文献；请确认 Zotero 已打开并尝试更短标题",
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
      setZoteroMessage("这条 Zotero 文献没有可用 PDF 附件")
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
      const asset = await getConvertedBook(saved.bookId)
      if (asset.originalPdfPath) {
        const pdfBytes = await readPdfFile(asset.originalPdfPath)
        pendingPdf = await getDocument({ data: new Uint8Array(pdfBytes) }).promise
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
      setZoteroOpen(false)
      onPhaseChange("reading")
      pushNotice("已从 Zotero 导入并打开转换稿")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setZoteroStatus("error")
      setZoteroMessage(message)
      handleImportFailure(message, "Zotero 导入失败")
    } finally {
      if (pendingPdf) {
        await pendingPdf.cleanup()
      }
      unlistenProgress?.()
      setIsExtracting(false)
    }
  }

  async function handleImportMineruSample() {
    if (!isTauriRuntime()) {
      pushNotice("MinerU 版面导入需要桌面端后端")
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
      const asset = await getConvertedBook(saved.bookId)
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
      const message = error instanceof Error ? error.message : String(error)
      handleImportFailure(message, "MinerU 转换稿导入失败")
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
          : "Embedding 设置已保存；浏览器预览模式不建立 provider 向量索引",
      )
      return
    }
    await rebuildCurrentBookSearchIndex({
      unavailableMessage: "Embedding 设置已保存；当前书籍还没有写入本地文本库",
      browserMessage: "Embedding 设置已保存；浏览器预览模式不建立 provider 向量索引",
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
      const summary = await rebuildSearchIndex(bookId)
      if (notify) {
        pushNotice(
          summary.vectorCount > 0 && summary.embeddingMatchesConfig
            ? `${successPrefix}：向量索引已就绪`
            : `${successPrefix}：当前使用 FTS 文本检索`,
        )
      }
      return summary
    } catch {
      if (notify) pushNotice(failureMessage)
      return null
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
        ? await getConvertedBook(storedBookId)
        : await getBrowserBook(storedBookId)
      let originalPdfLoaded = false
      if (isTauriRuntime() && asset.originalPdfPath) {
        try {
          const pdfBytes = await readPdfFile(asset.originalPdfPath)
          const loadedPdf = await getDocument({ data: new Uint8Array(pdfBytes) }).promise
          await pdf?.cleanup()
          setPdf(loadedPdf)
          setLoadedPdfPath(asset.originalPdfPath)
          setPdfLoadStatus("idle")
          setPdfLoadError("")
          originalPdfLoaded = true
        } catch (error) {
          await pdf?.cleanup()
          setPdf(null)
          setLoadedPdfPath("")
          setPdfLoadStatus("error")
          setPdfLoadError(error instanceof Error ? error.message : String(error))
        }
      } else {
        await pdf?.cleanup()
        setPdf(null)
        setLoadedPdfPath("")
        setPdfLoadStatus("idle")
        setPdfLoadError("")
      }
      setOriginalPdfPath(asset.originalPdfPath)
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
      })
      onLibraryStatus(
        "indexed",
        `已打开 Markdown 转换稿：${asset.text.length} 字正文${originalPdfLoaded ? "，原 PDF 可校对" : ""}`,
        asset.bookId,
      )
      const restoredPage = clampPage(options.page ?? 1, asset.totalPages)
      onPageChange(restoredPage)
      if (options.zoom) {
        onZoomChange(options.zoom)
      }
      const restoredView =
        options.readerView === "pdf" && asset.originalPdfPath
          ? "pdf"
          : options.readerView === "translation" && isTauriRuntime()
            ? "translation"
            : "text"
      setReaderView(restoredView)
      if (!options.silent) {
        pushNotice(
          originalPdfLoaded
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
        onBookLoaded("未导入 PDF", 0)
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
      setLibraryOpen(false)
    }
  }

  async function loadOriginalPdf(
    pdfPath: string,
    options: { switchToPdf?: boolean; notify?: boolean; force?: boolean } = {},
  ) {
    if (!isTauriRuntime()) {
      pushNotice("原 PDF 校对需要桌面端后端")
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
        setReaderView("pdf")
      }
      return true
    }
    originalPdfLoadingPathRef.current = trimmedPath
    setPdfLoadStatus("loading")
    setPdfLoadError("")
    try {
      const pdfBytes = await readPdfFile(trimmedPath)
      const loadedPdf = await getDocument({ data: new Uint8Array(pdfBytes) }).promise
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
        setReaderView("pdf")
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

  async function handlePdfViewClick() {
    if (pdf && (!isTauriRuntime() || loadedPdfPath === originalPdfPath)) {
      setPdfLoadStatus("idle")
      setPdfLoadError("")
      setReaderView("pdf")
      return
    }
    if (!originalPdfPath) {
      setReaderView("pdf")
      setPdfLoadStatus("error")
      setPdfLoadError("当前书籍没有保存原 PDF 副本")
      pushNotice("当前书籍没有可校对的原 PDF")
      return
    }
    setReaderView("pdf")
    await loadOriginalPdf(originalPdfPath, { switchToPdf: false, notify: true })
  }

  async function handleOpenOriginalPdfExternally() {
    if (!bookId || !isTauriRuntime()) {
      pushNotice("系统打开原 PDF 需要桌面端后端")
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
  const canOpenPdfView = totalPages > 0 && (canRead || (isTauriRuntime() && Boolean(originalPdfPath)))
  const canNavigate = totalPages > 0 && (canOpenPdfView || canShowConvertedText)
  const safePage = Math.min(Math.max(currentPage || 1, 1), totalPages || 1)
  const progress = totalPages > 0 ? (safePage / totalPages) * 100 : 0
  const currentParsedPage = parsedPages.find((page) => page.pageIndex === safePage - 1)
  const currentParsedPageText = currentParsedPage?.text ?? ""
  const libraryPersistenceLabel = isTauriRuntime()
    ? "导入后保存到本机书库，下次会优先直接打开"
    : browserLibraryAvailable()
      ? "浏览器预览会保存转换稿；桌面端会额外保存原 PDF 和索引"
      : "当前浏览器不支持持久化；桌面端会保存书库"
  const runtimeLabel = isTauriRuntime() ? "桌面端后端" : "浏览器预览"
  const backendOnlyHint = isTauriRuntime() ? undefined : "需要 Tauri 桌面端后端；浏览器预览会提示原因"
  const interpretationRuntimeHint = isTauriRuntime()
    ? "桌面端会调用后端 agentic RAG：检索本地文本索引、调用 LLM，并把引用回跳到转换稿。"
    : "浏览器预览会使用已转换文本做本地兜底解读；完整 DeepSeek、provider embedding、MinerU 云端解析和产品自检需要桌面端后端。"
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
    setPageJumpValue(String(safePage))
  }, [safePage])

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

  function handleImportFailure(message: string, noticeMessage: string) {
    setLoadError(message)
    if (bookId || parsedPages.length > 0 || pdf) {
      pushNotice(`${noticeMessage}；已保留当前阅读内容`)
      return
    }
    onLibraryStatus("error", message)
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
    pushNotice("已复制选中文本")
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
    pushNotice(interpretation.trim() || followUps.length > 0 ? "已复制解读内容" : "已复制选中文本")
  }

  async function copyCurrentPageText() {
    const markdown = currentParsedPage?.markdown?.trim() || currentParsedPage?.text.trim() || ""
    if (!markdown) {
      pushNotice("当前页还没有 Markdown 转换稿")
      return
    }
    await navigator.clipboard?.writeText(markdown)
    pushNotice("已复制当前页 Markdown")
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
    setReaderView("text")
    onChunkFocus(chunk.pageIndex + 1, chunk.chunkId, chunk.text, chunk.rects)
    pushNotice(chunk.rects.length > 0 ? "已定位到相关段落" : "已定位到相关文本")
  }

  function handleOutlineSelect(entry: ReaderOutlineEntry) {
    setReaderView("text")
    onPageChange(entry.pageIndex + 1)
    if (entry.firstChunkId) {
      onActiveChunk(entry.firstChunkId)
    }
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

  function handlePageJumpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const page = Number.parseInt(pageJumpValue, 10)
    if (!Number.isFinite(page)) {
      pushNotice("请输入有效页码")
      return
    }
    onPageChange(clampPage(page, totalPages))
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
      pushNotice("整本翻译需要桌面端后端和 LLM provider")
      return
    }
    setReaderView("translation")
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
        pushNotice("翻译任务会在当前页结束后停止")
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
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <div>
            <div className="text-sm font-semibold">{bookTitle}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {totalPages > 0
                  ? `${readerViewLabel(readerView)} · 第 ${safePage} / ${totalPages} 页`
                  : "等待导入"}
              </span>
              <Badge variant="secondary">{runtimeLabel}</Badge>
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
          <Button size="sm" disabled={isExtracting} onClick={() => void handleImportClick()}>
            {isExtracting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            导入文件
          </Button>
          <Button
            size="sm"
            variant={zoteroOpen ? "secondary" : "ghost"}
            title={backendOnlyHint}
            disabled={isExtracting}
            onClick={() => {
              if (!isTauriRuntime()) {
                pushNotice("从 Zotero 导入需要 Tauri 桌面端后端")
                return
              }
              setZoteroOpen((open) => !open)
            }}
          >
            {zoteroStatus === "importing" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Library className="mr-1.5 h-4 w-4" />
            )}
            从 Zotero 导入
          </Button>
          <Button
            size="sm"
            variant={libraryOpen ? "secondary" : "ghost"}
            onClick={() => {
              setLibraryOpen((open) => !open)
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
              onClick={() => setReaderView("text")}
            >
              <FileText className="mr-1.5 h-4 w-4" />
              转换稿
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
            <Button
              size="sm"
              variant={readerView === "translation" ? "secondary" : "ghost"}
              disabled={!canShowConvertedText || !bookId || !isTauriRuntime()}
              className="h-7 px-2.5"
              title={
                isTauriRuntime()
                  ? "打开左英右中对照翻译视图"
                  : "对照翻译需要桌面端后端"
              }
              onClick={() => {
                setReaderView("translation")
                void refreshTranslation()
              }}
            >
              <Languages className="mr-1.5 h-4 w-4" />
              对照翻译
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={handleHighlight}>
            <Highlighter className="mr-1.5 h-4 w-4" />
            高亮
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="搜索"
            onClick={() => {
              setSearchOpen((open) => !open)
              pushNotice(parsedPages.length > 0 ? "搜索面板已切换" : "PDF 转换成文本后才能搜索")
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
              setSettingsOpen((open) => !open)
            }}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </nav>
      </header>
      <LlmSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onEmbeddingSettingsSaved={() => void handleEmbeddingSettingsSaved()}
      />
      <LibraryShelf
        open={libraryOpen}
        books={storedBooks}
        activeBookId={bookId}
        persistenceLabel={libraryPersistenceLabel}
        onClose={() => setLibraryOpen(false)}
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
        onClose={() => setZoteroOpen(false)}
      />

      {notice ? (
        <div className="border-b bg-accent px-4 py-2 text-sm text-accent-foreground">
          {notice}
        </div>
      ) : null}

      <main
        className={`grid min-h-0 flex-1 overflow-hidden ${
          sidebarOpen ? "grid-cols-[240px_minmax(640px,1fr)_360px]" : "grid-cols-[minmax(640px,1fr)_360px]"
        }`}
      >
        {sidebarOpen ? (
          <aside className="flex min-h-0 flex-col border-r bg-card/45 p-3">
            <form
              className="mb-3 shrink-0 rounded-md border bg-background p-2 text-xs"
              onSubmit={handlePageJumpSubmit}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-medium text-muted-foreground">目录与索引</div>
                <Badge variant="secondary">
                  {totalPages > 0 ? `${safePage}/${totalPages}` : "未导入"}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-muted-foreground">跳转</span>
                <input
                  className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-right outline-none focus:ring-2 focus:ring-ring"
                  inputMode="numeric"
                  value={pageJumpValue}
                  onChange={(event) => setPageJumpValue(event.target.value)}
                  aria-label="跳转页码"
                />
                <span className="shrink-0 text-muted-foreground">/ {totalPages || 0}</span>
              </div>
            </form>
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
                          <span className="font-medium">第 {chunk.pageIndex + 1} 页</span>
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
                            setReaderView("text")
                            onPageChange(page.pageIndex + 1)
                          }}
                        >
                          <span className="font-medium">第 {page.pageIndex + 1} 页</span>
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
            <ReaderOutlinePanel
              entries={readerOutline}
              currentPage={safePage}
              className="flex-1"
              onSelect={handleOutlineSelect}
            />
            {readerOutline.length === 0 ? (
              <div className="min-h-0 flex-1 rounded-md border border-dashed bg-background px-3 py-8 text-center text-xs text-muted-foreground">
                {parsedPages.length > 0 ? "未识别到章节标题目录" : "导入 PDF 后显示目录"}
              </div>
            ) : null}
          </aside>
        ) : null}

        <section
          className={
            canShowConvertedText && (readerView === "text" || readerView === "translation")
              ? "min-h-0 overflow-hidden bg-[hsl(38_22%_91%)]"
              : "min-h-0 overflow-auto bg-[hsl(38_22%_91%)] px-8 py-8"
          }
        >
          {canShowConvertedText && readerView === "text" ? (
            <ConvertedTextReader
              pages={parsedPages}
              chunksByPage={chunksByPage}
              activeChunkId={activeChunkId}
              currentPage={safePage}
              totalPages={totalPages}
              approximateSelection={coordinateModeIsApproximate(coordinateMode)}
              highlights={highlights}
              selectionText={selectionText}
              selectionRects={selectionRects}
              selectionAnchor={selectionAnchor}
              quality={textQuality}
              askOpen={askOpen}
              question={question}
              onCopyPageText={() => void copyCurrentPageText()}
              onCopySelection={handleCopy}
              onExplain={onDeepInterpret}
              onPlainExplain={onPlainExplain}
              onAskToggle={() => setAskOpen((open) => !open)}
              onQuestionChange={setQuestion}
              onQuestionSubmit={handleQuestionSubmit}
              onHighlight={handleHighlight}
              onTextSelection={handleTextSelection}
              onClearSelection={onClearSelection}
              onCurrentPageChange={onVisiblePageChange}
            />
          ) : canShowConvertedText && readerView === "translation" ? (
            <TranslationReader
              pages={parsedPages}
              currentPage={safePage}
              totalPages={totalPages}
              translation={translation}
              busy={translationBusy}
              message={translationMessage}
              selectionText={selectionText}
              selectionRects={selectionRects}
              selectionAnchor={selectionAnchor}
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
              onAskToggle={() => setAskOpen((open) => !open)}
              onQuestionChange={setQuestion}
              onQuestionSubmit={handleQuestionSubmit}
              onHighlight={handleHighlight}
              onTextSelection={handleTextSelection}
              onClearSelection={onClearSelection}
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
              onBackToText={() => setReaderView("text")}
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
              onBackToText={() => setReaderView("text")}
            />
          ) : (
            <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center rounded-lg border border-dashed bg-card/70 p-10 text-center">
              <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
              <h1 className="text-xl font-semibold">导入一本 PDF 开始阅读</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                导入后会先转换成可检索文本；后续搜索、解读、追问都使用转换后的文字。
              </p>
              <Button className="mt-5" onClick={() => void handleImportClick()}>
                <Upload className="mr-1.5 h-4 w-4" />
                选择 PDF
              </Button>
              {loadError ? (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
                  {loadError}
                </p>
              ) : null}
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l bg-card/65 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">AI 解读</div>
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
            onExplain={onDeepInterpret}
            onPlainExplain={onPlainExplain}
            onQuestionChange={setQuestion}
            onQuestionSubmit={handleQuestionSubmit}
            onCitationClick={(chunkId) => {
              setReaderView("text")
              onCitationClick?.(chunkId)
            }}
            onRegenerate={onRegenerate}
            onSave={handleHighlight}
            onStop={onStop}
            runtimeHint={interpretationRuntimeHint}
          />
        </aside>
      </main>

      <footer className="flex h-12 shrink-0 items-center gap-4 border-t bg-card px-4 text-sm text-muted-foreground">
        <Button
          size="icon"
          variant="ghost"
          aria-label="上一页"
          disabled={!canNavigate || safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Progress value={progress} className="max-w-80" />
        <span>{Math.round(progress)}%</span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="下一页"
          disabled={!canNavigate || safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages || 1, safePage + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {readerView === "pdf" ? (
            <>
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
            </>
          ) : null}
        </div>
      </footer>
    </div>
  )
}

function stripSearchMarkup(value: string) {
  return value.replaceAll("<mark>", "").replaceAll("</mark>", "")
}

function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page) || totalPages <= 0) {
    return 1
  }
  return Math.min(Math.max(Math.floor(page), 1), totalPages)
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

type LibraryShelfRange = "all" | "today" | "week" | "older"

type LibraryShelfGroup = {
  id: Exclude<LibraryShelfRange, "all">
  title: string
  books: StoredBookSummary[]
}

const libraryShelfRangeOptions: Array<{ id: LibraryShelfRange; label: string }> = [
  { id: "all", label: "全部" },
  { id: "today", label: "今天" },
  { id: "week", label: "本周" },
  { id: "older", label: "本月及以前" },
]

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfLocalWeek(date: Date) {
  const start = startOfLocalDay(date)
  const day = start.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  start.setDate(start.getDate() - daysFromMonday)
  return start
}

function libraryBookTimestamp(book: Pick<StoredBookSummary, "createdAt">) {
  const timestamp = Date.parse(book.createdAt)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function libraryBookRange(book: Pick<StoredBookSummary, "createdAt">, now = new Date()): Exclude<LibraryShelfRange, "all"> {
  const timestamp = libraryBookTimestamp(book)
  if (timestamp <= 0) {
    return "older"
  }
  const todayStart = startOfLocalDay(now).getTime()
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const weekStart = startOfLocalWeek(now).getTime()
  if (timestamp >= todayStart && timestamp < tomorrowStart.getTime()) {
    return "today"
  }
  if (timestamp >= weekStart) {
    return "week"
  }
  return "older"
}

function searchableLibraryBookText(book: StoredBookSummary) {
  return [
    book.title,
    book.parserEngine,
    book.coordinateMode,
    book.sourcePdfFingerprint ? "源 PDF" : "转换稿",
    book.originalPdfPath ? "可校对" : "",
    book.quality?.looksUsable === false ? "建议重解析" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function filterLibraryBooks(books: StoredBookSummary[], query: string, range: LibraryShelfRange, now = new Date()) {
  const normalizedQuery = query.trim().toLowerCase()
  return books.filter((book) => {
    if (range !== "all" && libraryBookRange(book, now) !== range) {
      return false
    }
    return !normalizedQuery || searchableLibraryBookText(book).includes(normalizedQuery)
  })
}

function groupLibraryBooksByRange(books: StoredBookSummary[], now = new Date()): LibraryShelfGroup[] {
  const groups: LibraryShelfGroup[] = [
    { id: "today", title: "今天", books: [] },
    { id: "week", title: "本周", books: [] },
    { id: "older", title: "本月及以前", books: [] },
  ]
  const groupById = new Map(groups.map((group) => [group.id, group]))
  for (const book of books) {
    groupById.get(libraryBookRange(book, now))?.books.push(book)
  }
  return groups.filter((group) => group.books.length > 0)
}

function formatLibraryBookDate(book: Pick<StoredBookSummary, "createdAt">) {
  const timestamp = libraryBookTimestamp(book)
  if (timestamp <= 0) {
    return ""
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(timestamp))
}

type LibraryShelfProps = {
  open: boolean
  books: StoredBookSummary[]
  activeBookId: string
  persistenceLabel: string
  onClose: () => void
  onRefresh: () => void
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

function LibraryShelf({
  open,
  books,
  activeBookId,
  persistenceLabel,
  onClose,
  onRefresh,
  onOpen,
  onDelete,
}: LibraryShelfProps) {
  const [query, setQuery] = useState("")
  const [range, setRange] = useState<LibraryShelfRange>("all")
  const filteredBooks = useMemo(
    () => filterLibraryBooks(books, query, range),
    [books, query, range],
  )
  const groups = useMemo(
    () => {
      if (range === "all") {
        return groupLibraryBooksByRange(filteredBooks)
      }
      if (filteredBooks.length === 0) {
        return []
      }
      return [
        {
          id: range,
          title: libraryShelfRangeOptions.find((option) => option.id === range)?.label ?? "书籍",
          books: filteredBooks,
        } as LibraryShelfGroup,
      ]
    },
    [filteredBooks, range],
  )
  const hasFilters = query.trim() || range !== "all"
  const visibleCountLabel =
    books.length > 0 && filteredBooks.length !== books.length
      ? `显示 ${filteredBooks.length} / ${books.length} 本`
      : books.length > 0
        ? `${books.length} 本已转换图书`
        : persistenceLabel

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background/95 text-foreground backdrop-blur">
      <div className="flex h-14 shrink-0 items-center justify-between border-b bg-card/80 px-5">
        <div>
          <div className="text-base font-semibold">书架</div>
          <div className="text-xs text-muted-foreground">
            {visibleCountLabel}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {books.length > 0 ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-lg border bg-card/70 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="搜索书名、解析器或标签"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="flex shrink-0 rounded-md border bg-background p-1" aria-label="书架时间筛选">
                {libraryShelfRangeOptions.map((option) => (
                  <Button
                    key={option.id}
                    size="sm"
                    variant={range === option.id ? "secondary" : "ghost"}
                    className="h-7 px-2.5"
                    onClick={() => setRange(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            {groups.length > 0 ? (
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.id} className="space-y-3" aria-label={group.title}>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{group.title}</div>
                      <Badge variant="secondary">{group.books.length} 本</Badge>
                    </div>
                    <LibraryBookGrid
                      books={group.books}
                      allBooks={books}
                      activeBookId={activeBookId}
                      onOpen={onOpen}
                      onDelete={onDelete}
                    />
                  </section>
                ))}
              </div>
            ) : (
              <div className="mx-auto flex min-h-[48vh] max-w-md flex-col items-center justify-center text-center">
                <Search className="mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-lg font-semibold">没有匹配的图书</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {hasFilters ? "换一个关键词或时间分段试试。" : "当前书架没有可显示的图书。"}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
            <Library className="mb-4 h-10 w-10 text-muted-foreground" />
            <div className="text-lg font-semibold">还没有转换图书</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              导入 PDF 后会生成 Markdown 转换稿和本地索引，之后会以封面卡片出现在这里。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type LibraryBookGridProps = {
  books: StoredBookSummary[]
  allBooks: StoredBookSummary[]
  activeBookId: string
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

function LibraryBookGrid({
  books,
  allBooks,
  activeBookId,
  onOpen,
  onDelete,
}: LibraryBookGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {books.map((book) => {
        const index = Math.max(0, allBooks.findIndex((candidate) => candidate.bookId === book.bookId))
        return (
          <article
            key={book.bookId}
            className={`group overflow-hidden rounded-lg border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              book.bookId === activeBookId ? "ring-2 ring-primary" : ""
            }`}
          >
            <button className="block w-full text-left" onClick={() => onOpen(book.bookId)}>
              <div
                className={`flex aspect-[3/4] flex-col justify-between p-4 text-primary-foreground ${coverClassName(index)}`}
              >
                <div>
                  <div className="line-clamp-4 text-lg font-semibold leading-6">
                    {book.title || "未命名图书"}
                  </div>
                  <div className="mt-2 h-1 w-10 rounded-full bg-white/70" />
                </div>
                <div className="space-y-1 text-xs text-white/85">
                  <div>{book.totalPages || 0} 页</div>
                  <div>{book.parserEngine || "unknown"}</div>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <div className="line-clamp-2 text-sm font-medium">{book.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {book.textCharCount} 字
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{book.sourcePdfFingerprint ? "源 PDF" : "转换稿"}</Badge>
                  {book.originalPdfPath ? <Badge variant="secondary">可校对</Badge> : null}
                  {book.quality?.looksUsable === false ? <Badge variant="secondary">建议重解析</Badge> : null}
                  <LibraryBookDateBadge book={book} />
                </div>
              </div>
            </button>
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="truncate text-xs text-muted-foreground">
                {book.coordinateMode || "text-only"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-red-700"
                aria-label={`删除 ${book.title}`}
                onClick={() => onDelete(book.bookId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function LibraryBookDateBadge({ book }: { book: StoredBookSummary }) {
  const label = formatLibraryBookDate(book)
  return label ? <Badge variant="outline">{label}</Badge> : null
}

export const __readerShellTestUtils = {
  filterLibraryBooks,
  groupLibraryBooksByRange,
  libraryBookRange,
}

type ZoteroImportPanelProps = {
  open: boolean
  query: string
  results: ZoteroSearchResult[]
  status: "idle" | "searching" | "importing" | "error"
  message: string
  onQueryChange: (query: string) => void
  onSearch: () => void
  onImport: (result: ZoteroSearchResult) => void
  onClose: () => void
}

function ZoteroImportPanel({
  open,
  query,
  results,
  status,
  message,
  onQueryChange,
  onSearch,
  onImport,
  onClose,
}: ZoteroImportPanelProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-background/70 px-4 py-16 text-foreground backdrop-blur">
      <section className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <div className="text-base font-semibold">从 Zotero 导入论文</div>
            <div className="mt-1 text-xs text-muted-foreground">
              搜索本机 Zotero 条目，选择带 PDF 的文献后会进入本地转换与阅读流程。
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        <form
          className="flex shrink-0 gap-2 border-b px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch()
          }}
        >
          <input
            className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="输入论文标题或关键词"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={status === "searching" || status === "importing"}>
            {status === "searching" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-4 w-4" />
            )}
            搜索
          </Button>
        </form>
        {message ? (
          <div
            className={`border-b px-5 py-2 text-sm ${
              status === "error" ? "bg-red-50 text-red-950" : "bg-muted/50 text-muted-foreground"
            }`}
          >
            {message}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {results.length > 0 ? (
            <div className="space-y-2">
              {results.map((result) => (
                <article
                  key={result.itemKey}
                  className="flex items-start justify-between gap-4 rounded-md border bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-medium">{result.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {zoteroCreatorLine(result)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="secondary">{result.itemType || "item"}</Badge>
                      {result.year ? <Badge variant="secondary">{result.year}</Badge> : null}
                      <Badge variant={result.hasPdf ? "secondary" : "outline"}>
                        {result.hasPdf ? "PDF 可导入" : "无 PDF"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!result.hasPdf || status === "importing"}
                    onClick={() => onImport(result)}
                  >
                    {status === "importing" ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-1.5 h-4 w-4" />
                    )}
                    导入
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-md border border-dashed bg-background/70 p-8 text-center">
              <Library className="mb-3 h-9 w-9 text-muted-foreground" />
              <div className="text-sm font-medium">搜索 Zotero 文献库</div>
              <div className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Zotero 桌面端需要保持打开。搜索结果只显示本地条目，导入时读取本地 PDF 路径并交给 MinerU 云端解析。
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function zoteroCreatorLine(result: ZoteroSearchResult) {
  const creators =
    result.creators.length > 0 ? result.creators.slice(0, 3).join(", ") : "未知作者"
  const extra = result.creators.length > 3 ? " 等" : ""
  return [creators + extra, result.year].filter(Boolean).join(" · ")
}

function coverClassName(index: number) {
  const classes = [
    "bg-[linear-gradient(135deg,hsl(164_48%_28%),hsl(33_72%_46%))]",
    "bg-[linear-gradient(135deg,hsl(214_46%_30%),hsl(146_38%_36%))]",
    "bg-[linear-gradient(135deg,hsl(344_42%_34%),hsl(41_74%_45%))]",
    "bg-[linear-gradient(135deg,hsl(188_48%_28%),hsl(12_58%_42%))]",
    "bg-[linear-gradient(135deg,hsl(260_30%_34%),hsl(152_42%_34%))]",
  ]
  return classes[index % classes.length]
}

type ConvertedTextReaderProps = {
  pages: ParsedPage[]
  chunksByPage: Map<number, ParsedChunk[]>
  activeChunkId: string
  currentPage: number
  totalPages: number
  approximateSelection: boolean
  highlights: SavedHighlight[]
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  quality?: TextQuality | null
  askOpen: boolean
  question: string
  onCopyPageText: () => void
  onCopySelection: () => void
  onExplain: () => void
  onPlainExplain: () => void
  onAskToggle: () => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: () => void
  onHighlight: () => void
  onTextSelection: (
    text: string,
    pageNumber: number,
    anchor?: TextSelectionAnchor | null,
  ) => void
  onClearSelection: () => void
  onCurrentPageChange: (page: number) => void
}

function ConvertedTextReader({
  pages,
  chunksByPage,
  activeChunkId,
  currentPage,
  totalPages,
  approximateSelection,
  highlights,
  selectionText,
  selectionRects,
  selectionAnchor,
  quality,
  askOpen,
  question,
  onCopyPageText,
  onCopySelection,
  onExplain,
  onPlainExplain,
  onAskToggle,
  onQuestionChange,
  onQuestionSubmit,
  onHighlight,
  onTextSelection,
  onClearSelection,
  onCurrentPageChange,
}: ConvertedTextReaderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const textRefs = useRef(new Map<number, HTMLDivElement>())
  const currentPageRef = useRef(currentPage)
  const programmaticScrollRef = useRef<ProgrammaticPageScroll | null>(null)
  const observedPageChangeRef = useRef<number | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null)
  const [toolbarSuppressed, setToolbarSuppressed] = useState(false)

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => () => clearProgrammaticPageScroll(programmaticScrollRef), [])

  useEffect(() => {
    if (!selectionText.trim()) {
      setToolbarPosition(null)
      setToolbarSuppressed(false)
    }
  }, [selectionText])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const handleScroll = () => {
      if (
        shouldDeferVisiblePageUpdateForProgrammaticScroll(
          programmaticScrollRef,
          scroller,
          pageRefs,
          currentPageRef,
          onCurrentPageChange,
        )
      ) {
        return
      }
      const scrollerRect = scroller.getBoundingClientRect()
      const viewportAnchor = scrollerRect.top + Math.min(180, scrollerRect.height * 0.28)
      let bestPage = currentPageRef.current
      let bestDistance = Number.POSITIVE_INFINITY
      for (const [pageIndex, element] of pageRefs.current) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) {
          continue
        }
        const distance = Math.abs(rect.top - viewportAnchor)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPage = pageIndex + 1
        }
      }
      if (bestPage !== currentPageRef.current) {
        currentPageRef.current = bestPage
        reportVisiblePageFromReaderScroll(observedPageChangeRef, bestPage, onCurrentPageChange)
      }
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => scroller.removeEventListener("scroll", handleScroll)
  }, [pages, onCurrentPageChange])

  useEffect(() => {
    const target = pageRefs.current.get(currentPage - 1)
    const scroller = scrollerRef.current
    if (!target || !scroller) {
      return
    }
    if (consumeVisiblePageUpdateFromReaderScroll(observedPageChangeRef, currentPage)) {
      return
    }
    if (isPageNearReaderAnchor(scroller, target)) {
      return
    }
    const targetTop = scrollElementIntoScrollerView(scroller, target, { behavior: "smooth" })
    startProgrammaticPageScroll(programmaticScrollRef, currentPage, targetTop)
  }, [activeChunkId, chunksByPage, currentPage])

  function clearReadableSelection() {
    const nativeSelection = window.getSelection()
    const hasNativeSelection = Boolean(nativeSelection?.toString().trim() || !nativeSelection?.isCollapsed)
    window.getSelection()?.removeAllRanges()
    setToolbarPosition(null)
    setToolbarSuppressed(false)
    if (selectionText.trim() || selectionRects.length > 0 || hasNativeSelection) {
      onClearSelection()
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (shouldIgnoreSelectionClearTarget(event.target)) {
      return
    }
    setToolbarSuppressed(true)
    setToolbarPosition(null)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>, page: ParsedPage) {
    if (shouldIgnoreSelectionClearTarget(event.target)) {
      return
    }
    window.setTimeout(() => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      const textElement = textRefs.current.get(page.pageIndex)
      if (selection && text) {
        onTextSelection(
          text,
          page.pageIndex + 1,
          textElement
            ? textSelectionAnchorFromReadableDom(selection, page, textElement)
            : null,
        )
        setToolbarPosition(
          selectionToolbarPositionFromDom(
            selection,
            pageRefs.current.get(page.pageIndex) ?? null,
            textElement ?? null,
          ),
        )
        setToolbarSuppressed(false)
        return
      }
      clearReadableSelection()
    }, 0)
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isInsideReaderPage(event.target, "readable")) {
      return
    }
    handlePointerDown(event)
  }

  function handleBackgroundPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      shouldIgnoreSelectionClearTarget(event.target) ||
      isInsideReaderPage(event.target, "readable")
    ) {
      return
    }
    window.setTimeout(() => {
      if (!window.getSelection()?.toString().trim()) {
        clearReadableSelection()
      }
    }, 0)
  }

  return (
    <div
      ref={scrollerRef}
      className="h-full overflow-y-auto px-8 py-8"
      onPointerDown={handleBackgroundPointerDown}
      onPointerUp={handleBackgroundPointerUp}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {pages.map((page) => {
          const chunks = chunksByPage.get(page.pageIndex) ?? []
          const activeChunk = chunks.find((chunk) => chunk.chunkId === activeChunkId)
          return (
            <article
              key={page.pageIndex}
              ref={(element) => {
                if (element) {
                  pageRefs.current.set(page.pageIndex, element)
                } else {
                  pageRefs.current.delete(page.pageIndex)
                }
              }}
              data-readable-page
              className="relative min-h-[72vh] rounded-md border bg-card px-10 py-8 shadow-sm"
              onPointerDown={handlePointerDown}
              onPointerUp={(event) => handlePointerUp(event, page)}
            >
              <div className="mb-6 flex items-center justify-between border-b pb-4">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    Markdown
                  </div>
                  <h1 className="mt-1 text-lg font-semibold">
                    第 {page.pageIndex + 1} / {totalPages} 页
                  </h1>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {quality?.looksUsable === false ? "转换质量偏低" : "可搜索 · 可解读"}
                  </div>
                </div>
                {page.pageIndex + 1 === currentPage ? (
                  <Button size="sm" variant="secondary" onClick={onCopyPageText}>
                    <Copy className="mr-1.5 h-4 w-4" />
                    复制 Markdown
                  </Button>
                ) : null}
              </div>
              <div
                ref={(element) => {
                  if (element) {
                    textRefs.current.set(page.pageIndex, element)
                  } else {
                    textRefs.current.delete(page.pageIndex)
                  }
                }}
                data-source-text={page.text}
                className="font-ui text-[15px] leading-8 text-foreground"
              >
                <ReadablePageContent
                  page={page}
                  highlights={[
                    ...(activeChunk
                      ? [
                          {
                            id: "active-citation-target",
                            bookId: "",
                            selectionText: activeChunk.text,
                            prefix: "",
                            suffix: "",
                            pageIndex: page.pageIndex,
                            positionStart: null,
                            positionEnd: null,
                            rects: [],
                            interpretation: null,
                            createdAt: "",
                          } satisfies SavedHighlight,
                        ]
                      : []),
                    ...highlights.filter(
                      (highlight) =>
                        highlight.rects.length === 0 && highlight.pageIndex === page.pageIndex,
                    ),
                    ...(shouldRenderCurrentTextSelection(
                      page.pageIndex,
                      currentPage,
                      selectionText,
                      selectionAnchor,
                      selectionRects,
                    )
                      ? [
                          {
                            id: "current-text-selection",
                            bookId: "",
                            selectionText,
                            prefix: "",
                            suffix: "",
                            pageIndex: page.pageIndex,
                            positionStart:
                              selectionAnchor?.pageIndex === page.pageIndex
                                ? selectionAnchor.positionStart
                                : null,
                            positionEnd:
                              selectionAnchor?.pageIndex === page.pageIndex
                                ? selectionAnchor.positionEnd
                                : null,
                            rects: [],
                            interpretation: null,
                            createdAt: "",
                          } satisfies SavedHighlight,
                        ]
                      : []),
                  ]}
                />
              </div>
              {shouldRenderCurrentTextSelection(
                page.pageIndex,
                currentPage,
                selectionText,
                selectionAnchor,
                selectionRects,
              ) && !toolbarSuppressed ? (
                <SelectionToolbar
                  approximate={approximateSelection}
                  askOpen={askOpen}
                  className="absolute z-20 max-w-[calc(100%-2rem)]"
                  disabled={!selectionText.trim()}
                  question={question}
                  style={
                    toolbarPosition
                      ? { left: toolbarPosition.left, top: toolbarPosition.top }
                      : { left: 40, top: 96 }
                  }
                  onAskToggle={onAskToggle}
                  onCopy={onCopySelection}
                  onExplain={onExplain}
                  onHighlight={onHighlight}
                  onPlainExplain={onPlainExplain}
                  onQuestionChange={onQuestionChange}
                  onQuestionSubmit={onQuestionSubmit}
                />
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}

type ProgrammaticPageScroll = {
  page: number
  targetTop: number
  timeoutId: number
}

type ProgrammaticPageScrollRef = MutableRefObject<ProgrammaticPageScroll | null>

export function scrollElementIntoScrollerView(
  scroller: HTMLElement,
  target: HTMLElement,
  { behavior = "smooth", topOffset = 0 }: { behavior?: ScrollBehavior; topOffset?: number } = {},
) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = Math.max(0, scroller.scrollTop + targetRect.top - scrollerRect.top - topOffset)
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: targetTop, behavior })
  } else {
    scroller.scrollTop = targetTop
  }
  return targetTop
}

function startProgrammaticPageScroll(
  ref: ProgrammaticPageScrollRef,
  page: number,
  targetTop: number,
) {
  clearProgrammaticPageScroll(ref)
  ref.current = {
    page,
    targetTop,
    timeoutId: window.setTimeout(() => {
      if (ref.current?.page === page) {
        ref.current = null
      }
    }, 1400),
  }
}

function clearProgrammaticPageScroll(ref: ProgrammaticPageScrollRef) {
  if (ref.current) {
    window.clearTimeout(ref.current.timeoutId)
    ref.current = null
  }
}

function reportVisiblePageFromReaderScroll(
  ref: MutableRefObject<number | null>,
  page: number,
  onCurrentPageChange: (page: number) => void,
) {
  ref.current = page
  onCurrentPageChange(page)
}

function consumeVisiblePageUpdateFromReaderScroll(
  ref: MutableRefObject<number | null>,
  page: number,
) {
  if (ref.current !== page) {
    return false
  }
  ref.current = null
  return true
}

function shouldDeferVisiblePageUpdateForProgrammaticScroll(
  ref: ProgrammaticPageScrollRef,
  scroller: HTMLElement,
  pageRefs: MutableRefObject<Map<number, HTMLElement>>,
  currentPageRef: MutableRefObject<number>,
  onCurrentPageChange: (page: number) => void,
) {
  const pending = ref.current
  if (!pending) {
    return false
  }
  const target = pageRefs.current.get(pending.page - 1)
  if (!target) {
    clearProgrammaticPageScroll(ref)
    return false
  }
  if (isProgrammaticPageScrollSettled(scroller, target, pending.targetTop)) {
    const page = pending.page
    clearProgrammaticPageScroll(ref)
    if (currentPageRef.current !== page) {
      currentPageRef.current = page
      onCurrentPageChange(page)
    }
    return false
  }
  return true
}

function isProgrammaticPageScrollSettled(
  scroller: HTMLElement,
  target: HTMLElement,
  targetTop: number,
) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return (
    Math.abs(scroller.scrollTop - targetTop) < 2 ||
    (targetRect.top >= scrollerRect.top - 2 && targetRect.top <= scrollerRect.top + 36)
  )
}

function isPageNearReaderAnchor(scroller: HTMLElement, target: HTMLElement) {
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return targetRect.top >= scrollerRect.top + 24 && targetRect.top <= scrollerRect.top + 180
}

function renderReadableTextWithHighlights(text: string, highlights: SavedHighlight[]) {
  const cleaned = cleanPdfLineBreaks(text)
  const normalizedText = normalizeWhitespace(cleaned)
  if (!normalizedText || highlights.length === 0) {
    return cleaned
  }

  const ranges = preferCurrentReadableSelectionRanges(
    highlights
    .map((highlight) => {
      const exact = normalizeWhitespace(highlight.selectionText)
      if (!exact) return null
      const resolved = resolveTextQuoteSelector(cleaned, {
        exact,
        prefix: highlight.prefix,
        suffix: highlight.suffix,
        positionStart: highlight.positionStart ?? null,
        positionEnd: highlight.positionEnd ?? null,
      })
      const normalizedStart = resolved?.positionStart ?? normalizedText.indexOf(exact)
      if (normalizedStart < 0) return null
      const normalizedEnd = resolved?.positionEnd ?? normalizedStart + exact.length
      if (normalizedEnd <= normalizedStart) return null
      const start = rawOffsetForNormalizedOffset(cleaned, normalizedStart)
      const end = rawOffsetForNormalizedOffset(cleaned, normalizedEnd)
      if (end <= start) return null
      return {
        id: highlight.id,
        start,
        end: Math.min(end, cleaned.length),
      }
    })
    .filter((range): range is ReadableHighlightRange => range !== null),
  )
    .sort((left, right) => left.start - right.start || right.end - left.end)

  if (ranges.length === 0) {
    return text
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    if (range.start > cursor) {
      nodes.push(cleaned.slice(cursor, range.start))
    }
    nodes.push(
      <mark
        key={range.id}
        className={readableHighlightClassName(range.id)}
        data-highlight-id={range.id}
        data-current-selection={range.id === "current-text-selection" ? "true" : undefined}
      >
        {cleaned.slice(range.start, range.end)}
      </mark>,
    )
    cursor = range.end
  }
  if (cursor < cleaned.length) {
    nodes.push(cleaned.slice(cursor))
  }
  return nodes.length > 0 ? nodes : cleaned
}

function ReadablePageContent({
  page,
  highlights,
}: {
  page: ParsedPage
  highlights: SavedHighlight[]
}) {
  const markdown = page.markdown?.trim()
  if (markdown) {
    return (
      <MarkdownContent
        content={markdown}
        highlightSourceText={page.text}
        highlights={highlights}
        className="max-w-none text-[15px] leading-8 [&_.markdown-highlight-source]:hidden"
      />
    )
  }
  return (
    <div className="whitespace-pre-wrap">
      {renderReadableTextWithHighlights(page.text || "这一页没有抽取到可用文字。", highlights)}
    </div>
  )
}

function readableHighlightClassName(id: string) {
  if (id === "current-text-selection") {
    return "reader-current-text-selection box-decoration-clone rounded-sm bg-amber-200/80 px-0.5 text-foreground ring-1 ring-amber-500/35 dark:bg-amber-300/35"
  }
  if (id === "active-citation-target") {
    return "box-decoration-clone rounded-sm bg-sky-200/65 px-0.5 text-foreground dark:bg-sky-300/30"
  }
  return "box-decoration-clone rounded-sm bg-teal-300/35 px-0.5 text-foreground dark:bg-teal-300/25"
}

type ReadableHighlightRange = {
  id: string
  start: number
  end: number
}

function preferCurrentReadableSelectionRanges(ranges: ReadableHighlightRange[]) {
  const currentSelection = ranges.find((range) => range.id === "current-text-selection")
  if (!currentSelection) {
    return ranges
  }
  return ranges.filter(
    (range) => range.id === currentSelection.id || !readableRangesOverlap(range, currentSelection),
  )
}

function readableRangesOverlap(left: ReadableHighlightRange, right: ReadableHighlightRange) {
  return left.start < right.end && left.end > right.start
}

type TranslationReaderProps = {
  pages: ParsedPage[]
  currentPage: number
  totalPages: number
  translation: TranslationStatus | null
  busy: boolean
  message: string
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  askOpen: boolean
  question: string
  onCurrentPageChange: (page: number) => void
  onStart: () => void
  onRetranslate: () => void
  onRetryFailed: () => void
  onCancel: () => void
  onCopySelection: () => void
  onExplain: () => void
  onPlainExplain: () => void
  onAskToggle: () => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: () => void
  onHighlight: () => void
  onTextSelection: (
    text: string,
    pageNumber: number,
    anchor?: TextSelectionAnchor | null,
  ) => void
  onClearSelection: () => void
}

function TranslationReader({
  pages,
  currentPage,
  totalPages,
  translation,
  busy,
  message,
  selectionText,
  selectionRects,
  selectionAnchor,
  askOpen,
  question,
  onCurrentPageChange,
  onStart,
  onRetranslate,
  onRetryFailed,
  onCancel,
  onCopySelection,
  onExplain,
  onPlainExplain,
  onAskToggle,
  onQuestionChange,
  onQuestionSubmit,
  onHighlight,
  onTextSelection,
  onClearSelection,
}: TranslationReaderProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const paneRefs = useRef(new Map<string, HTMLElement>())
  const currentPageRef = useRef(currentPage)
  const programmaticScrollRef = useRef<ProgrammaticPageScroll | null>(null)
  const observedPageChangeRef = useRef<number | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null)
  const [toolbarSuppressed, setToolbarSuppressed] = useState(false)
  const translationPages = useMemo(() => {
    const byPage = new Map<number, TranslationStatus["pages"][number]>()
    for (const page of translation?.pages ?? []) {
      byPage.set(page.pageIndex, page)
    }
    return byPage
  }, [translation])
  const progress =
    translation && translation.totalPages > 0
      ? Math.round((translation.completedPages / translation.totalPages) * 100)
      : 0
  const translationComplete = isTranslationComplete(translation)
  const hasFailedPages = Boolean(translation && translation.failedPages > 0)
  const hasCachedPages = Boolean(translation && translation.completedPages > 0)
  const showStatusMessage = Boolean(message && (busy || translation?.running || !translationComplete))
  const primaryActionLabel = hasCachedPages ? "继续翻译" : "开始翻译"

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => () => clearProgrammaticPageScroll(programmaticScrollRef), [])

  useEffect(() => {
    if (!selectionText.trim()) {
      setToolbarPosition(null)
      setToolbarSuppressed(false)
    }
  }, [selectionText])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const handleScroll = () => {
      if (
        shouldDeferVisiblePageUpdateForProgrammaticScroll(
          programmaticScrollRef,
          scroller,
          pageRefs,
          currentPageRef,
          onCurrentPageChange,
        )
      ) {
        return
      }
      const scrollerRect = scroller.getBoundingClientRect()
      const viewportAnchor = scrollerRect.top + Math.min(180, scrollerRect.height * 0.28)
      let bestPage = currentPageRef.current
      let bestDistance = Number.POSITIVE_INFINITY
      for (const [pageIndex, element] of pageRefs.current) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) {
          continue
        }
        const distance = Math.abs(rect.top - viewportAnchor)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPage = pageIndex + 1
        }
      }
      if (bestPage !== currentPageRef.current) {
        currentPageRef.current = bestPage
        reportVisiblePageFromReaderScroll(observedPageChangeRef, bestPage, onCurrentPageChange)
      }
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => scroller.removeEventListener("scroll", handleScroll)
  }, [pages, onCurrentPageChange])

  useEffect(() => {
    const target = pageRefs.current.get(currentPage - 1)
    const scroller = scrollerRef.current
    if (!target || !scroller) {
      return
    }
    if (consumeVisiblePageUpdateFromReaderScroll(observedPageChangeRef, currentPage)) {
      return
    }
    if (isPageNearReaderAnchor(scroller, target)) {
      return
    }
    const targetTop = scrollElementIntoScrollerView(scroller, target, { behavior: "smooth" })
    startProgrammaticPageScroll(programmaticScrollRef, currentPage, targetTop)
  }, [currentPage])

  function clearReadableSelection() {
    const nativeSelection = window.getSelection()
    const hasNativeSelection = Boolean(nativeSelection?.toString().trim() || !nativeSelection?.isCollapsed)
    window.getSelection()?.removeAllRanges()
    setToolbarPosition(null)
    setToolbarSuppressed(false)
    if (selectionText.trim() || selectionRects.length > 0 || hasNativeSelection) {
      onClearSelection()
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (shouldIgnoreSelectionClearTarget(event.target)) {
      return
    }
    setToolbarSuppressed(true)
    setToolbarPosition(null)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>, page: ParsedPage) {
    if (shouldIgnoreSelectionClearTarget(event.target)) {
      return
    }
    window.setTimeout(() => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      const article = pageRefs.current.get(page.pageIndex) ?? null
      const pane = selectionPaneForPageSelection(selection, page.pageIndex, paneRefs.current)
      if (selection && text) {
        onTextSelection(
          text,
          page.pageIndex + 1,
          pane ? textSelectionAnchorFromDomSelection(selection, pane.textContent ?? "", page.pageIndex, pane) : null,
        )
        setToolbarPosition(selectionToolbarPositionFromDom(selection, article, pane ?? article))
        setToolbarSuppressed(false)
        return
      }
      clearReadableSelection()
    }, 0)
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isInsideReaderPage(event.target, "translation")) {
      return
    }
    handlePointerDown(event)
  }

  function handleBackgroundPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      shouldIgnoreSelectionClearTarget(event.target) ||
      isInsideReaderPage(event.target, "translation")
    ) {
      return
    }
    window.setTimeout(() => {
      if (!window.getSelection()?.toString().trim()) {
        clearReadableSelection()
      }
    }, 0)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="shrink-0 border-b bg-card/95 px-6 py-2.5 shadow-sm backdrop-blur"
        data-translation-toolbar
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <Languages className="h-4 w-4 shrink-0" />
              <span className="shrink-0">对照翻译</span>
              {translation?.running ? (
                <Badge variant="secondary">后台翻译中</Badge>
              ) : translationComplete ? (
                <Badge variant="secondary">本地缓存</Badge>
              ) : hasFailedPages ? (
                <Badge variant="secondary">有失败页</Badge>
              ) : null}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="truncate">{translationStatusSummary(translation)}</span>
              {showStatusMessage ? (
                <>
                  <span className="hidden text-muted-foreground/50 sm:inline">·</span>
                  <span className="truncate">{message}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {!translationComplete ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || translation?.running}
                onClick={onStart}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Languages className="mr-1.5 h-4 w-4" />
                )}
                {primaryActionLabel}
              </Button>
            ) : null}
            {hasFailedPages ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || translation?.running}
                onClick={onRetryFailed}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                重试失败
              </Button>
            ) : null}
            {translation && !translation.running ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRetranslate}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                重新翻译
              </Button>
            ) : null}
            {translation?.running ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                取消
              </Button>
            ) : null}
          </div>
        </div>
        {translation && !translationComplete ? (
          <div className="mx-auto mt-2 max-w-6xl">
            <Progress value={progress} className="h-1" />
          </div>
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
        data-translation-scroller
        onPointerDown={handleBackgroundPointerDown}
        onPointerUp={handleBackgroundPointerUp}
      >
        <div className="mx-auto max-w-6xl space-y-4">
          {pages.map((page) => {
            const translatedPage = translationPages.get(page.pageIndex)
            const sourceMarkdown = translationSourceMarkdown(page)
            const translatedMarkdown =
              translatedPage?.status === "done"
                ? sanitizeDisplayedTranslationMarkdown(
                    translatedPage.translatedMarkdown,
                    sourceMarkdown,
                  )
                : ""
            const alignedRows = alignedTranslationRows(sourceMarkdown, translatedMarkdown)
            return (
              <article
                key={page.pageIndex}
                ref={(element) => {
                  if (element) {
                    pageRefs.current.set(page.pageIndex, element)
                  } else {
                    pageRefs.current.delete(page.pageIndex)
                  }
                }}
                data-translation-page
                className="relative grid min-h-[72vh] grid-cols-2 overflow-hidden rounded-md border bg-card shadow-sm"
                onPointerDown={handlePointerDown}
                onPointerUp={(event) => handlePointerUp(event, page)}
              >
                <section
                  ref={(element) => {
                    const key = translationPaneKey(page.pageIndex, "source")
                    if (element) {
                      paneRefs.current.set(key, element)
                    } else {
                      paneRefs.current.delete(key)
                    }
                  }}
                  data-translation-pane="source"
                  data-page-index={page.pageIndex}
                  className="contents"
                >
                  <div
                    className="min-w-0 border-b border-r px-7 py-6"
                    style={{ gridColumn: 1, gridRow: 1 }}
                  >
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      English Source
                    </div>
                    <h2 className="mt-1 text-base font-semibold">
                      第 {page.pageIndex + 1} / {totalPages} 页
                    </h2>
                  </div>
                  {alignedRows.map((row) => (
                    <div
                      key={`source-${row.index}`}
                      data-translation-block-pane="source"
                      data-translation-block-row={row.index}
                      className={translationCellClass("source", row.index)}
                      style={{ gridColumn: 1, gridRow: row.index + 2 }}
                    >
                      {row.sourceMarkdown ? (
                        <MarkdownContent
                          content={row.sourceMarkdown}
                          className="max-w-none text-[14px] leading-7"
                        />
                      ) : null}
                    </div>
                  ))}
                </section>
                <section
                  ref={(element) => {
                    const key = translationPaneKey(page.pageIndex, "translation")
                    if (element) {
                      paneRefs.current.set(key, element)
                    } else {
                      paneRefs.current.delete(key)
                    }
                  }}
                  data-translation-pane="translation"
                  data-page-index={page.pageIndex}
                  className="contents"
                >
                  <div
                    className="flex min-w-0 items-center justify-between gap-3 border-b px-7 py-6"
                    style={{ gridColumn: 2, gridRow: 1 }}
                  >
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Chinese Translation
                      </div>
                      <h2 className="mt-1 text-base font-semibold">
                        {translationPageStatusLabel(translatedPage?.status)}
                      </h2>
                    </div>
                    {translatedPage?.status ? (
                      <Badge variant="secondary">{translationPageStatusShortLabel(translatedPage.status)}</Badge>
                    ) : null}
                  </div>
                  {alignedRows.map((row) => (
                    <div
                      key={`translation-${row.index}`}
                      data-translation-block-pane="translation"
                      data-translation-block-row={row.index}
                      className={translationCellClass("translation", row.index)}
                      style={{ gridColumn: 2, gridRow: row.index + 2 }}
                    >
                      {translatedPage?.status === "done" && row.translatedMarkdown ? (
                        <MarkdownContent
                          content={row.translatedMarkdown}
                          className="max-w-none text-[14px] leading-7"
                        />
                      ) : translatedPage?.status === "failed" && row.index === 0 ? (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-950">
                          {translatedPage.error || "这一页翻译失败"}
                        </div>
                      ) : translatedPage?.status === "translating" && row.index === 0 ? (
                        <TranslationSkeleton label="正在翻译这一页" />
                      ) : !translatedPage?.status && row.index === 0 ? (
                        <TranslationSkeleton label="等待整本翻译任务生成译文" />
                      ) : null}
                    </div>
                  ))}
                </section>
                {shouldRenderCurrentTextSelection(
                page.pageIndex,
                currentPage,
                selectionText,
                selectionAnchor,
                selectionRects,
              ) && !toolbarSuppressed ? (
                  <SelectionToolbar
                    askOpen={askOpen}
                    className="absolute z-20 max-w-[calc(100%-2rem)]"
                    disabled={!selectionText.trim()}
                    question={question}
                    style={
                      toolbarPosition
                        ? { left: toolbarPosition.left, top: toolbarPosition.top }
                        : { left: 28, top: 80 }
                    }
                    onAskToggle={onAskToggle}
                    onCopy={onCopySelection}
                    onExplain={onExplain}
                    onHighlight={onHighlight}
                    onPlainExplain={onPlainExplain}
                    onQuestionChange={onQuestionChange}
                    onQuestionSubmit={onQuestionSubmit}
                  />
                ) : null}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function translationPaneKey(pageIndex: number, kind: "source" | "translation") {
  return `${pageIndex}:${kind}`
}

function selectionPaneForPageSelection(
  selection: Selection | null | undefined,
  pageIndex: number,
  paneRefs: Map<string, HTMLElement>,
) {
  const anchorNode = selection?.anchorNode
  if (!anchorNode) {
    return null
  }
  const anchorElement =
    anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement
  const pane = anchorElement?.closest<HTMLElement>("[data-translation-pane]")
  if (pane?.dataset.pageIndex === String(pageIndex)) {
    return pane
  }
  return (
    paneRefs.get(translationPaneKey(pageIndex, "source")) ??
    paneRefs.get(translationPaneKey(pageIndex, "translation")) ??
    null
  )
}

function isTranslationComplete(translation: TranslationStatus | null) {
  return Boolean(
    translation &&
      translation.totalPages > 0 &&
      translation.completedPages >= translation.totalPages &&
      translation.failedPages === 0 &&
      !translation.running,
  )
}

function translationStatusSummary(translation: TranslationStatus | null) {
  if (!translation) {
    return "尚未生成整本中文译文"
  }
  const providerModel = [translation.provider || "provider 未配置", translation.model]
    .filter(Boolean)
    .join(" ")
  const failed = translation.failedPages > 0 ? ` · ${translation.failedPages} 页失败` : ""
  const cacheState =
    isTranslationComplete(translation)
      ? " · 本地缓存"
      : translation.completedPages > 0
        ? " · 已缓存部分页面"
        : ""
  return `${translation.completedPages}/${translation.totalPages} 页完成${failed} · ${providerModel}${cacheState}`
}

function TranslationSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
      <div className="h-4 w-11/12 rounded bg-muted" />
      <div className="h-4 w-10/12 rounded bg-muted" />
      <div className="h-4 w-8/12 rounded bg-muted" />
      <div className="mt-5 h-20 rounded bg-muted/70" />
    </div>
  )
}

function translationPageStatusLabel(status?: TranslationStatus["pages"][number]["status"]) {
  switch (status) {
    case "done":
      return "中文译文"
    case "failed":
      return "翻译失败"
    case "translating":
      return "正在翻译"
    case "pending":
    default:
      return "等待翻译"
  }
}

function translationPageStatusShortLabel(status: TranslationStatus["pages"][number]["status"]) {
  switch (status) {
    case "done":
      return "已完成"
    case "failed":
      return "失败"
    case "translating":
      return "进行中"
    case "pending":
      return "待处理"
  }
}

type AlignedTranslationRow = {
  index: number
  sourceMarkdown: string
  translatedMarkdown: string
}

type TranslationBlock = {
  id: string
  markdown: string
}

function translationSourceMarkdown(page: ParsedPage) {
  const markdown = page.markdown?.trim() || cleanPdfLineBreaks(page.text)
  return markdown
    .replace(/^#{1,6}\s*Page\s+\d+\s*\n+/i, "")
    .trim()
}

function alignedTranslationRows(
  sourceMarkdown: string,
  translatedMarkdown: string,
): AlignedTranslationRow[] {
  const sourceBlocks = sourceTranslationBlocks(sourceMarkdown)
  const numberedTranslatedBlocks = splitNumberedTranslationBlocks(translatedMarkdown)

  if (numberedTranslatedBlocks.length > 0) {
    const sourceIds = new Set(sourceBlocks.map((block) => block.id))
    const translatedById = new Map(
      numberedTranslatedBlocks.map((block) => [block.id, block.markdown]),
    )
    const rows = sourceBlocks.map((sourceBlock, index) => ({
      index,
      sourceMarkdown: sourceBlock.markdown,
      translatedMarkdown: translatedById.get(sourceBlock.id) ?? "",
    }))
    for (const block of numberedTranslatedBlocks) {
      if (sourceIds.has(block.id) || !block.markdown.trim()) {
        continue
      }
      rows.push({
        index: rows.length,
        sourceMarkdown: "",
        translatedMarkdown: block.markdown,
      })
    }
    if (rows.length > 0) {
      return rows
    }
  }

  const sourceMarkdownBlocks = sourceBlocks.map((block) => block.markdown)
  const translatedBlocks = splitMarkdownBlocks(translatedMarkdown)
  const rowCount = Math.max(sourceMarkdownBlocks.length, translatedBlocks.length, 1)

  return Array.from({ length: rowCount }, (_, index) => ({
    index,
    sourceMarkdown: sourceMarkdownBlocks[index] ?? "",
    translatedMarkdown: translatedBlocks[index] ?? "",
  }))
}

function sourceTranslationBlocks(sourceMarkdown: string): TranslationBlock[] {
  return splitMarkdownBlocks(sourceMarkdown).map((block, index) => ({
    id: translationBlockId(index),
    markdown: block,
  }))
}

function translationBlockId(index: number) {
  return `B${String(index + 1).padStart(3, "0")}`
}

function splitMarkdownBlocks(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim()
  if (!normalized) {
    return []
  }
  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function splitNumberedTranslationBlocks(markdown: string): TranslationBlock[] {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  if (!normalized) {
    return []
  }
  const blocks: TranslationBlock[] = []
  let currentId = ""
  let currentLines: string[] = []
  const flush = () => {
    if (!currentId) {
      currentLines = []
      return
    }
    blocks.push({
      id: currentId,
      markdown: currentLines.join("\n").trim(),
    })
    currentId = ""
    currentLines = []
  }

  for (const line of normalized.split("\n")) {
    const marker = line.match(/^\s*(?:[-*]\s*)?\[\[B(\d+)\]\]\s*(.*)$/i)
    if (marker) {
      flush()
      currentId = `B${String(Number(marker[1])).padStart(3, "0")}`
      const rest = marker[2]?.trimEnd()
      currentLines = rest ? [rest] : []
    } else if (currentId) {
      currentLines.push(line)
    }
  }
  flush()
  return blocks
}

function sanitizeDisplayedTranslationMarkdown(markdown: string, sourceMarkdown: string) {
  const sourceBlocks = splitMarkdownBlocks(sourceMarkdown)
  const sourceEchoes = new Set(
    sourceBlocks.map(normalizedBlockText).filter((block) => block.length >= 24),
  )
  const strippedMarkdown = markdown
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
  const numberedBlocks = splitNumberedTranslationBlocks(strippedMarkdown)
  if (numberedBlocks.length > 0) {
    return numberedBlocks
      .map((block) => {
        const cleaned = sanitizeNumberedTranslationBlock(block.markdown)
        return `[[${block.id}]]${cleaned ? `\n${cleaned}` : ""}`
      })
      .join("\n\n")
      .trim()
  }

  const blocks = splitMarkdownBlocks(strippedMarkdown)
  const cleanedBlocks = []

  for (const block of blocks) {
    if (isTranslationBoilerplateBlock(block)) {
      continue
    }
    if (isTranslationNotesBlock(block)) {
      break
    }
    if (isLongSourceEchoBlock(block, sourceEchoes)) {
      continue
    }
    cleanedBlocks.push(block)
  }

  return cleanedBlocks.join("\n\n").trim()
}

function sanitizeNumberedTranslationBlock(block: string) {
  const text = block.trim()
  if (isTranslationBoilerplateBlock(text) || isTranslationNotesBlock(text)) {
    return ""
  }
  return text
}

function isTranslationBoilerplateBlock(block: string) {
  const text = normalizedBlockText(block)
  return (
    /^(中文译文|已完成|译文)$/.test(text) ||
    /^以下是.*中文翻译/.test(text) ||
    /^下面是.*中文翻译/.test(text) ||
    /^Here is the Chinese translation/i.test(text)
  )
}

function isTranslationNotesBlock(block: string) {
  const text = normalizedBlockText(block)
  return /^(翻译说明|译者说明|说明)[:：]?/.test(text)
}

function isLongSourceEchoBlock(block: string, sourceEchoes: ReadonlySet<string>) {
  const text = normalizedBlockText(block)
  if (text.length < 24 || !sourceEchoes.has(text)) {
    return false
  }
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length
  return cjkCount === 0 && latinCount >= 12
}

function normalizedBlockText(block: string) {
  return block
    .replace(/[`*_>#\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function translationCellClass(kind: "source" | "translation", rowIndex: number) {
  const borderTop = rowIndex === 0 ? "" : " border-t"
  const sideBorder = kind === "source" ? " border-r" : ""
  return `min-w-0 px-7 py-4${borderTop}${sideBorder}`
}

function cleanPdfLineBreaks(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("")
        .replace(/([。！？；：，、])(?=\S)/g, "$1 ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n")
}

function shouldIgnoreSelectionClearTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(
    target.closest(
      [
        "[data-testid='selection-toolbar']",
        "[data-translation-toolbar]",
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
      ].join(","),
    ),
  )
}

function isInsideReaderPage(
  target: EventTarget | null,
  kind: "readable" | "translation",
) {
  if (!(target instanceof Element)) {
    return false
  }
  const selector = kind === "readable" ? "[data-readable-page]" : "[data-translation-page]"
  return Boolean(target.closest(selector))
}

function selectionToolbarPositionFromDom(
  selection: Selection,
  articleElement: HTMLElement | null,
  textElement: HTMLElement | null,
) {
  if (selection.rangeCount === 0 || !articleElement || !textElement) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (
    !textElement.contains(range.startContainer) ||
    !textElement.contains(range.endContainer)
  ) {
    return null
  }
  if (typeof range.getBoundingClientRect !== "function") {
    return null
  }
  const rect = range.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) {
    return null
  }
  const articleRect = articleElement.getBoundingClientRect()
  const toolbarWidth = 520
  const left = Math.min(
    Math.max(16, rect.left - articleRect.left),
    Math.max(16, articleRect.width - toolbarWidth - 16),
  )
  const top = Math.max(16, rect.top - articleRect.top - 58)
  return { left, top }
}

function textSelectionAnchorFromReadableDom(
  selection: Selection,
  page: ParsedPage,
  textElement: HTMLElement,
): TextSelectionAnchor | null {
  const sourceText = textElement.dataset.sourceText ?? textElement.innerText
  return textSelectionAnchorFromDomSelection(selection, sourceText, page.pageIndex, textElement)
}
