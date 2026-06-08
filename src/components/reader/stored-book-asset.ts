import type {
  ConvertedBookManifest,
  ConvertedBookPageWindow,
} from "@/core/library-api"
import { isCurrentTldrSourceVersion } from "@/core/tldr"
import type { ParsedPage } from "@/stores/reader-store"

/** Build a reader asset from a manifest + the currently-loaded page window. */
export function storedBookAssetFromManifestWindow(
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

/** Map an asset's TLDR fields into the metadata shape onParsedDocument expects. */
export function tldrMetadataFromAsset(asset: {
  tldrText?: string | null
  tldrGeneratedAt?: string | null
  tldrModel?: string | null
  tldrSourceVersion?: number | null
}) {
  if (!asset.tldrText?.trim() || !isCurrentTldrSourceVersion(asset.tldrSourceVersion)) {
    return {
      tldrText: null,
      tldrGeneratedAt: null,
      tldrModel: null,
      tldrSourceVersion: null,
    }
  }
  return {
    tldrText: asset.tldrText,
    tldrGeneratedAt: asset.tldrGeneratedAt ?? null,
    tldrModel: asset.tldrModel ?? null,
    tldrSourceVersion: asset.tldrSourceVersion,
  }
}

/** Placeholder page for not-yet-loaded windows in a large book. */
export function unloadedParsedPage(pageIndex: number): ParsedPage {
  return {
    pageIndex,
    text: "",
    markdown: "",
    loaded: false,
  }
}

/** Whether a parser engine produced a PDF-backed book (vs. a text-only import). */
export function bookHasPdfParser(parserEngine: string) {
  return !parserEngine.startsWith("text-import-")
}

/** Whether an asset has a usable original PDF for coordinate proofreading. */
export function assetHasPdfSource(asset: { parserEngine: string; originalPdfPath: string }) {
  return bookHasPdfParser(asset.parserEngine) && asset.originalPdfPath.toLowerCase().endsWith(".pdf")
}
