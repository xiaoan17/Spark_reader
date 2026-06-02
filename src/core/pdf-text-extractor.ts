import type { PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api"
import type { ParsedChunk } from "@/stores/reader-store"
import { COORDINATE_VERSION, normalizeRect, type NormalizedPageRect } from "@/core/coordinates"
import { makeChunkId } from "@/core/chunk-id"

export type ParsedPage = {
  pageIndex: number
  text: string
  markdown: string
}

export type TextBlock = {
  text: string
  rect: NormalizedPageRect | null
}

export type ParsedDocument = {
  engine: string
  coordinateMode: string
  quality: {
    charCount: number
    replacementCharRatio: number
    controlCharRatio: number
    looksUsable: boolean
  }
  pages: ParsedPage[]
  chunks: ParsedChunk[]
  text: string
  markdown: string
}

export type PdfTextExtractionProgress = {
  pageNumber: number
  totalPages: number
  percent: number
}

export type PdfTextExtractionOptions = {
  onProgress?: (progress: PdfTextExtractionProgress) => void
}

export async function extractPdfText(
  pdf: PDFDocumentProxy,
  options: PdfTextExtractionOptions = {},
): Promise<ParsedDocument> {
  const pages: ParsedPage[] = []
  const pageBlocks = new Map<number, TextBlock[]>()

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const text = textContentToPlainText(textContent)
    const markdown = pageToMarkdown(pageNumber, text)
    const blocks = textContentToBlocks(textContent, pageNumber - 1, viewport)
    pages.push({
      pageIndex: pageNumber - 1,
      text,
      markdown,
    })
    pageBlocks.set(pageNumber - 1, blocks)
    options.onProgress?.({
      pageNumber,
      totalPages: pdf.numPages,
      percent: Math.round((pageNumber / Math.max(1, pdf.numPages)) * 100),
    })
  }

  const text = pages.map((page) => page.text).join("\n\n")
  return {
    engine: "pdfjs",
    coordinateMode: "pdfjs-text-items-v1",
    quality: textQuality(text),
    pages,
    chunks: buildChunks(pages, pageBlocks),
    text,
    markdown: pages.map((page) => page.markdown).join("\n\n"),
  }
}

export function buildChunks(
  pages: ParsedPage[],
  pageBlocks: Map<number, TextBlock[]> = new Map(),
): ParsedChunk[] {
  const chunks: ParsedChunk[] = []

  for (const page of pages) {
    const blockChunks = buildChunksFromBlocks(page.pageIndex, pageBlocks.get(page.pageIndex) ?? [])
    if (blockChunks.length > 0) {
      chunks.push(...blockChunks)
      continue
    }

    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)

    if (paragraphs.length === 0 && page.text.trim()) {
      paragraphs.push(page.text.trim())
    }

    let buffer = ""
    let chunkIndex = 0
    for (const paragraph of paragraphs) {
      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph
      if (next.length > 900 && buffer) {
        chunks.push(makeChunk(page.pageIndex, chunkIndex, buffer))
        chunkIndex += 1
        buffer = paragraph
      } else {
        buffer = next
      }
    }

    if (buffer.trim()) {
      chunks.push(makeChunk(page.pageIndex, chunkIndex, buffer))
    }
  }

  return chunks
}

export function textContentToBlocks(
  textContent: TextContent,
  pageIndex: number,
  viewport: PdfViewportLike,
): TextBlock[] {
  const blocks: TextBlock[] = []
  let lineText = ""
  let lineRects: NormalizedPageRect[] = []

  function flushLine() {
    const text = normalizeText(lineText)
    if (text) {
      blocks.push({
        text,
        rect: mergeRects(pageIndex, lineRects),
      })
    }
    lineText = ""
    lineRects = []
  }

  for (const item of textContent.items) {
    if (!isTextItem(item)) {
      continue
    }
    const value = item.str.trim()
    if (value) {
      lineText += lineText ? ` ${value}` : value
      const rect = textItemToNormalizedRect(pageIndex, item, viewport)
      if (rect) {
        lineRects.push(rect)
      }
    }
    if (item.hasEOL) {
      flushLine()
    }
  }
  flushLine()

  return blocks
}

export type PdfViewportLike = {
  width: number
  height: number
  convertToViewportRectangle: (rect: [number, number, number, number]) => number[]
}

export function textItemToNormalizedRect(
  pageIndex: number,
  item: TextItem,
  viewport: PdfViewportLike,
): NormalizedPageRect | null {
  if (
    item.width <= 0 ||
    item.height <= 0 ||
    item.transform.length < 6 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null
  }

  const x = Number(item.transform[4])
  const y = Number(item.transform[5])
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  try {
    const viewportRect = viewport.convertToViewportRectangle([
      x,
      y,
      x + item.width,
      y + item.height,
    ])
    return normalizeRect({
      pageIndex,
      x0: viewportRect[0] / viewport.width,
      y0: viewportRect[1] / viewport.height,
      x1: viewportRect[2] / viewport.width,
      y1: viewportRect[3] / viewport.height,
    })
  } catch {
    return null
  }
}

function buildChunksFromBlocks(pageIndex: number, blocks: TextBlock[]): ParsedChunk[] {
  const chunks: ParsedChunk[] = []
  let buffer = ""
  let rects: NormalizedPageRect[] = []
  let chunkIndex = 0

  for (const block of blocks) {
    const next = buffer ? `${buffer}\n\n${block.text}` : block.text
    if (next.length > 900 && buffer) {
      chunks.push(makeChunk(pageIndex, chunkIndex, buffer, rects))
      chunkIndex += 1
      buffer = block.text
      rects = block.rect ? [block.rect] : []
    } else {
      buffer = next
      if (block.rect) {
        rects.push(block.rect)
      }
    }
  }

  if (buffer.trim()) {
    chunks.push(makeChunk(pageIndex, chunkIndex, buffer, rects))
  }

  return chunks
}

export function textContentToPlainText(textContent: TextContent) {
  const parts: string[] = []

  for (const item of textContent.items) {
    if (!isTextItem(item)) {
      continue
    }
    const value = item.str.trim()
    if (!value) {
      if (item.hasEOL) {
        parts.push("\n")
      }
      continue
    }

    parts.push(value)
    parts.push(item.hasEOL ? "\n" : " ")
  }

  return normalizeText(parts.join(""))
}

export function pageToMarkdown(pageNumber: number, text: string) {
  const body = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n")

  return `## Page ${pageNumber}\n\n${body}`
}

function normalizeText(input: string) {
  return input
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function textQuality(text: string) {
  const chars = [...text].filter((char) => !/\s/.test(char))
  if (chars.length === 0) {
    return {
      charCount: 0,
      replacementCharRatio: 1,
      controlCharRatio: 1,
      looksUsable: false,
    }
  }

  const replacement = chars.filter((char) => char === "\ufffd").length
  const control = chars.filter((char) => char.charCodeAt(0) < 32).length
  const replacementCharRatio = replacement / chars.length
  const controlCharRatio = control / chars.length
  return {
    charCount: chars.length,
    replacementCharRatio,
    controlCharRatio,
    looksUsable: chars.length > 200 && replacementCharRatio < 0.01 && controlCharRatio < 0.01,
  }
}

function makeChunk(
  pageIndex: number,
  chunkIndex: number,
  text: string,
  rects: NormalizedPageRect[] = [],
): ParsedChunk {
  const chunkId = makeChunkId("browser-preview", pageIndex, chunkIndex, text)
  return {
    chunkId,
    pageIndex,
    text,
    markdown: `### [${chunkId}] Page ${pageIndex + 1}\n\n${text}`,
    rects,
    coordinateVersion: COORDINATE_VERSION,
  }
}

function isTextItem(item: TextContent["items"][number]): item is TextItem {
  return "str" in item
}

function mergeRects(pageIndex: number, rects: NormalizedPageRect[]) {
  if (rects.length === 0) {
    return null
  }
  try {
    return normalizeRect({
      pageIndex,
      x0: Math.min(...rects.map((rect) => rect.x0)),
      y0: Math.min(...rects.map((rect) => rect.y0)),
      x1: Math.max(...rects.map((rect) => rect.x1)),
      y1: Math.max(...rects.map((rect) => rect.y1)),
    })
  } catch {
    return null
  }
}
