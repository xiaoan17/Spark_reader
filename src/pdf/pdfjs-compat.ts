import "./pdfjs-webkit-polyfills"
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs"
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url"

type PdfJsRuntime = typeof import("pdfjs-dist/legacy/build/pdf.mjs")

let pdfjsRuntimePromise: Promise<PdfJsRuntime> | null = null

export async function loadPdfJs() {
  if (!pdfjsRuntimePromise) {
    pdfjsRuntimePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
      module.GlobalWorkerOptions.workerSrc = workerUrl
      return module
    })
  }
  return pdfjsRuntimePromise
}

export async function loadPdfDocument(source: Parameters<PdfJsRuntime["getDocument"]>[0]) {
  const { getDocument } = await loadPdfJs()
  return getDocument(source).promise
}

export type { PDFDocumentProxy, PDFPageProxy, RenderTask }
