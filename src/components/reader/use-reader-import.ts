import { useState, type DragEvent as ReactDragEvent, type RefObject } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { loadPdfDocument, type PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import { extractPdfText } from "@/core/pdf-text-extractor"
import {
  browserLibraryAvailable,
  browserPdfFingerprint,
  findBrowserBookBySourceFingerprint,
  getBrowserBook,
  saveBrowserBook,
} from "@/core/browser-library"
import {
  findBookBySourcePdf,
  importMineruOutput,
  importPdfWithMineru,
  importPlainBook,
  importZoteroItem,
  isTauriRuntime,
  listenMineruProgress,
  readPdfFile,
  searchZoteroItems,
  type ConvertedBookAsset,
  type ZoteroSearchResult,
} from "@/core/library-api"
import type { LibraryStatus, ParsedChunk, ParsedPage, TextAssetMetadata } from "@/stores/reader-store"
import { mineruProgressMessage } from "./mineru-progress"
import type { ReaderView } from "./highlight-target-view"

type ImportedPdfState = {
  pdf: PDFDocumentProxy | null
  loadedPdfPath: string
  originalPdfPath: string
  pdfLoadStatus: "idle" | "loading" | "error"
  pdfLoadError: string
}

type UseReaderImportDeps = {
  fileInputRef: RefObject<HTMLInputElement | null>
  setPanelOpen: (panel: "importMenuOpen" | "zoteroOpen", open: boolean) => void
  onBookLoaded: (title: string, totalPages: number) => void
  onParsedDocument: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text: string,
    markdown: string,
    metadata?: TextAssetMetadata | null,
  ) => void
  onLibraryStatus: (status: LibraryStatus, message?: string, bookId?: string) => void
  onPhaseChange: (phase: "reading" | "error") => void
  setReaderView: (view: ReaderView) => void
  pushNotice: (message: string) => void
  applyParsedBookAsset: (asset: ConvertedBookAsset) => void
  applyImportedPdf: (next: ImportedPdfState) => Promise<void>
  resetPdf: (nextOriginalPdfPath?: string) => Promise<void>
  setPdfLoadStatus: (status: "idle" | "loading" | "error") => void
  setPdfLoadError: (message: string) => void
  loadStoredBookInitialWindow: (bookId: string, page: number) => Promise<ConvertedBookAsset>
  handleOpenStoredBook: (bookId: string) => Promise<string | null | undefined>
  refreshStoredBooks: () => Promise<unknown>
  handleImportFailure: (error: unknown, noticeMessage: string) => void
}

/**
 * All book-import flows (drag/drop, local PDF → MinerU, TXT/EPUB, MinerU output
 * directory, Zotero) plus their extract/zotero state. Extracted from ReaderShell
 * so the shell composes flows instead of owning ~400 lines of import mechanics.
 */
export function useReaderImport(deps: UseReaderImportDeps) {
  const {
    fileInputRef,
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
  } = deps

  const [isExtracting, setIsExtracting] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [isImportDragOver, setIsImportDragOver] = useState(false)
  const [zoteroQuery, setZoteroQuery] = useState("")
  const [zoteroResults, setZoteroResults] = useState<ZoteroSearchResult[]>([])
  const [zoteroStatus, setZoteroStatus] = useState<"idle" | "searching" | "importing" | "error">("idle")
  const [zoteroImportingItemKey, setZoteroImportingItemKey] = useState<string | null>(null)
  const [zoteroMessage, setZoteroMessage] = useState("")

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
      await applyImportedPdf({
        pdf: loadedPdf,
        loadedPdfPath: "",
        originalPdfPath: file.name,
        pdfLoadStatus: "idle",
        pdfLoadError: "",
      })
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
        applyParsedBookAsset(asset)
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
    return [...event.dataTransfer.files].find(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
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
      fileInputRef.current?.click()
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
        saved = await importPdfWithMineru(pdfPath, defaultMineruParseOptions(), pendingPdf.numPages)
      } finally {
        unlistenProgress?.()
      }
      const asset = await loadStoredBookInitialWindow(saved.bookId, 1)
      await applyImportedPdf({
        pdf: pendingPdf,
        loadedPdfPath: asset.originalPdfPath,
        originalPdfPath: asset.originalPdfPath,
        pdfLoadStatus: "idle",
        pdfLoadError: "",
      })
      pendingPdf = null
      onBookLoaded(asset.title, asset.totalPages)
      applyParsedBookAsset(asset)
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
      await resetPdf()
      onBookLoaded(asset.title, asset.totalPages)
      applyParsedBookAsset(asset)
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
      await resetPdf(asset.originalPdfPath)
      onBookLoaded(asset.title, asset.totalPages)
      applyParsedBookAsset(asset)
      setReaderView("text")
      onLibraryStatus("indexed", `已导入 MinerU 转换稿：${saved.textCharCount} 字`, saved.bookId)
      void refreshStoredBooks()
      onPhaseChange("reading")
      pushNotice("已导入 MinerU 文本和版面坐标；解读、搜索会使用转换文字")
    } catch (error) {
      handleImportFailure(error, "MinerU 转换稿导入失败")
    } finally {
      setIsExtracting(false)
    }
  }

  async function handleZoteroSearch() {
    if (!isTauriRuntime()) {
      setZoteroStatus("error")
      setZoteroImportingItemKey(null)
      setZoteroMessage("从 Zotero 导入需要桌面版读取本机 Zotero 库")
      return
    }
    const query = zoteroQuery.trim()
    if (!query) {
      setZoteroStatus("idle")
      setZoteroImportingItemKey(null)
      setZoteroResults([])
      setZoteroMessage("请输入论文标题或关键词")
      return
    }
    setZoteroStatus("searching")
    setZoteroImportingItemKey(null)
    setZoteroMessage("")
    try {
      const results = await searchZoteroItems(query, 8)
      setZoteroResults(results)
      setZoteroStatus("idle")
      setZoteroImportingItemKey(null)
      setZoteroMessage(
        results.length > 0
          ? `找到 ${results.length} 条 Zotero 文献`
          : "没有找到匹配文献；请确认 Zotero 已打开、PDF 附件仍在本机，并尝试更短标题；也可以改用本地 PDF 导入。",
      )
    } catch (error) {
      setZoteroResults([])
      setZoteroStatus("error")
      setZoteroImportingItemKey(null)
      setZoteroMessage(error instanceof Error ? error.message : "Zotero 搜索失败")
    }
  }

  async function handleImportZoteroItem(result: ZoteroSearchResult) {
    if (!result.hasPdf) {
      setZoteroStatus("error")
      setZoteroImportingItemKey(null)
      setZoteroMessage("这条 Zotero 文献没有可用 PDF 附件；请在 Zotero 中确认附件路径，或改用本地 PDF 导入。")
      return
    }
    setLoadError("")
    setIsExtracting(true)
    setZoteroStatus("importing")
    setZoteroImportingItemKey(result.itemKey)
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
      await applyImportedPdf({
        pdf: pendingPdf,
        loadedPdfPath: pendingPdf ? asset.originalPdfPath : "",
        originalPdfPath: asset.originalPdfPath,
        pdfLoadStatus: pendingPdf ? "idle" : asset.originalPdfPath ? "error" : "idle",
        pdfLoadError: pendingPdf || !asset.originalPdfPath ? "" : "原 PDF 资产不可用",
      })
      pendingPdf = null
      onBookLoaded(asset.title, asset.totalPages)
      applyParsedBookAsset(asset)
      setReaderView("text")
      onLibraryStatus(
        "indexed",
        `已从 Zotero 导入并云端解析 ${saved.textCharCount} 字正文`,
        saved.bookId,
      )
      void refreshStoredBooks()
      setZoteroStatus("idle")
      setZoteroImportingItemKey(null)
      setZoteroMessage("Zotero 文献已导入")
      setPanelOpen("zoteroOpen", false)
      onPhaseChange("reading")
      pushNotice("已从 Zotero 导入并打开转换稿")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setZoteroStatus("error")
      setZoteroImportingItemKey(null)
      setZoteroMessage(message)
      handleImportFailure(error, "Zotero 导入失败")
    } finally {
      if (pendingPdf) {
        await pendingPdf.cleanup()
      }
      unlistenProgress?.()
      setZoteroImportingItemKey(null)
      setIsExtracting(false)
    }
  }

  return {
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
