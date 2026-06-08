import { useEffect, useRef, useState } from "react"
import { loadPdfDocument, type PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import { isTauriRuntime, openBookAsset, readPdfFile } from "@/core/library-api"
import { buildPdfOutlineEntries, type ReaderOutlineEntry } from "./reader-outline"
import type { ReaderView } from "./highlight-target-view"

type SwitchReaderView = (
  nextView: ReaderView,
  options?: { page?: number; restorePage?: boolean },
) => void

type UseReaderPdfDeps = {
  bookId: string
  readerView: ReaderView
  switchReaderView: SwitchReaderView
  pushNotice: (message: string) => void
}

type ImportedPdfState = {
  pdf: PDFDocumentProxy | null
  loadedPdfPath: string
  originalPdfPath: string
  pdfLoadStatus: "idle" | "loading" | "error"
  pdfLoadError: string
}

/**
 * Owns the original-PDF document and its load lifecycle (load/reset/outline),
 * shared by the PDF view and every import path. Extracted from ReaderShell so the
 * shell no longer holds PDF mechanics (coding-style 小文件原则).
 */
export function useReaderPdf({ bookId, readerView, switchReaderView, pushNotice }: UseReaderPdfDeps) {
  const originalPdfLoadingPathRef = useRef("")
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadedPdfPath, setLoadedPdfPath] = useState("")
  const [originalPdfPath, setOriginalPdfPath] = useState("")
  const [pdfLoadStatus, setPdfLoadStatus] = useState<"idle" | "loading" | "error">("idle")
  const [pdfLoadError, setPdfLoadError] = useState("")
  const [pdfOutlineEntries, setPdfOutlineEntries] = useState<ReaderOutlineEntry[]>([])

  // Release the pdf.js document when it is replaced or the reader unmounts.
  useEffect(() => {
    return () => {
      void pdf?.cleanup()
    }
  }, [pdf])

  // Lazily load the original PDF when the PDF view opens for a book that has one.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerView, originalPdfPath, loadedPdfPath, pdf, pdfLoadStatus])

  // Rebuild the PDF outline whenever the loaded document changes.
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

  /** Replace the active PDF document (e.g. after an import that produced one). */
  async function applyImportedPdf(next: ImportedPdfState) {
    await pdf?.cleanup()
    setPdf(next.pdf)
    setLoadedPdfPath(next.loadedPdfPath)
    setOriginalPdfPath(next.originalPdfPath)
    setPdfLoadStatus(next.pdfLoadStatus)
    setPdfLoadError(next.pdfLoadError)
  }

  /** Clear the active PDF (used by text-only imports and book deletion). */
  async function resetPdf(nextOriginalPdfPath = "") {
    await pdf?.cleanup()
    setPdf(null)
    setLoadedPdfPath("")
    setOriginalPdfPath(nextOriginalPdfPath)
    setPdfLoadStatus("idle")
    setPdfLoadError("")
  }

  /** Surface a PDF render failure (from the canvas) and drop the broken document. */
  async function handlePdfRenderError(message: string) {
    setPdfLoadStatus("error")
    setPdfLoadError(message)
    await pdf?.cleanup()
    setPdf(null)
  }

  return {
    pdf,
    loadedPdfPath,
    originalPdfPath,
    pdfLoadStatus,
    pdfLoadError,
    pdfOutlineEntries,
    setPdf,
    setLoadedPdfPath,
    setOriginalPdfPath,
    setPdfLoadStatus,
    setPdfLoadError,
    loadOriginalPdf,
    handlePdfViewClick,
    handleOpenOriginalPdfExternally,
    handlePdfRenderError,
    applyImportedPdf,
    resetPdf,
  }
}
