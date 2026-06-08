import { useEffect, useRef, useState } from "react"
import {
  deleteBook,
  getConvertedBookManifest,
  getConvertedBookPages,
  isTauriRuntime,
  listBooks,
  type ConvertedBookAsset,
  type ConvertedBookManifest,
  type ConvertedBookPageWindow,
  type StoredBookSummary,
} from "@/core/library-api"
import {
  browserLibraryAvailable,
  deleteBrowserBook,
  getBrowserBook,
  listBrowserBooks,
} from "@/core/browser-library"
import type { LibraryStatus, ParsedChunk, ParsedPage, TextAssetMetadata } from "@/stores/reader-store"
import { clampPage } from "./page-navigation"
import {
  READER_SESSION_STORAGE_KEY,
  nextStartupRestoreTarget,
  parseStartupSession,
  serializeStartupSession,
  type StartupReaderView,
  type StartupRestoreTarget,
} from "./startup-restore"
import { assetHasPdfSource, storedBookAssetFromManifestWindow } from "./stored-book-asset"
import type { ReaderView } from "./highlight-target-view"

const STORED_BOOK_INITIAL_PAGE_WINDOW = 48

type OpenStoredBookOptions = {
  silent?: boolean
  page?: number
  readerView?: StartupReaderView
  zoom?: number
}

type UseReaderLibraryDeps = {
  bookId: string
  libraryStatus: LibraryStatus
  canUseLibrary: boolean
  totalPages: number
  currentPage: number
  readerView: ReaderView
  zoom: number
  resetPdf: (nextOriginalPdfPath?: string) => Promise<void>
  applyParsedBookAsset: (asset: ConvertedBookAsset) => void
  onBookLoaded: (title: string, totalPages: number) => void
  onParsedDocument: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text: string,
    markdown: string,
    metadata?: TextAssetMetadata | null,
  ) => void
  onParsedDocumentWindow: (
    pages: ParsedPage[],
    chunks: ParsedChunk[],
    text: string,
    markdown: string,
  ) => void
  onLibraryStatus: (status: LibraryStatus, message?: string, bookId?: string) => void
  onPageChange: (page: number) => void
  onZoomChange: (zoom: number) => void
  setReaderView: (view: ReaderView) => void
  setPanelOpen: (panel: "libraryOpen", open: boolean) => void
  pushNotice: (message: string) => void
}

/**
 * Stored-book library: list/open/delete books, lazy page windows, and the
 * startup-restore + session-persist lifecycle. Extracted from ReaderShell as the
 * last orchestration domain so the shell becomes a thin composition layer.
 */
export function useReaderLibrary(deps: UseReaderLibraryDeps) {
  const {
    bookId,
    libraryStatus,
    canUseLibrary,
    totalPages,
    currentPage,
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
  } = deps

  const [storedBooks, setStoredBooks] = useState<StoredBookSummary[]>([])
  const loadingPageWindowsRef = useRef(new Set<string>())

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

  async function loadStoredBookInitialWindow(storedBookId: string, page: number) {
    const manifest = await getConvertedBookManifest(storedBookId)
    const restoredPage = clampPage(page, manifest.totalPages)
    const halfWindow = Math.floor(STORED_BOOK_INITIAL_PAGE_WINDOW / 2)
    const startPage = Math.max(0, restoredPage - 1 - halfWindow)
    const window = await getConvertedBookPages(storedBookId, startPage, STORED_BOOK_INITIAL_PAGE_WINDOW)
    return storedBookAssetFromManifestWindow(manifest, window)
  }

  async function handleOpenStoredBook(storedBookId: string, options: OpenStoredBookOptions = {}) {
    try {
      const asset = isTauriRuntime()
        ? await loadStoredBookInitialWindow(storedBookId, options.page ?? 1)
        : await getBrowserBook(storedBookId)
      const hasPdfSource = assetHasPdfSource(asset)
      await resetPdf(hasPdfSource ? asset.originalPdfPath : "")
      onBookLoaded(asset.title, asset.totalPages)
      applyParsedBookAsset(asset)
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
              : options.readerView === "knowledge"
                ? "knowledge"
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
        await resetPdf()
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

  // On mount: list books and restore the last session (or single book) if any.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the active reading position so the next launch can restore it.
  useEffect(() => {
    if (!canUseLibrary || !bookId || libraryStatus !== "indexed" || totalPages <= 0) {
      return
    }
    window.localStorage.setItem(
      READER_SESSION_STORAGE_KEY,
      serializeStartupSession({
        bookId,
        currentPage,
        readerView,
        zoom,
        updatedAt: Date.now(),
      }),
    )
  }, [bookId, libraryStatus, currentPage, readerView, zoom, totalPages, canUseLibrary])

  return {
    storedBooks,
    refreshStoredBooks,
    loadStoredBookInitialWindow,
    handleOpenStoredBook,
    handleDeleteStoredBook,
    handleOpenStoredBookFromShelf,
    requestStoredPageWindow,
  }
}

export type { OpenStoredBookOptions }
