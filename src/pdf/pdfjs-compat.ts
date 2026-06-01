import "./pdfjs-webkit-polyfills"
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs"
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url"

GlobalWorkerOptions.workerSrc = workerUrl

export { getDocument, GlobalWorkerOptions, TextLayer }
export type { PDFDocumentProxy, PDFPageProxy, RenderTask }
