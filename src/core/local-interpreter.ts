import type { EvidencePreview } from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { ParsedChunk, ParsedPage } from "@/stores/reader-store"
import { pageTextByIndex } from "@/core/page-lookup"

export function makeLocalEvidence(
  rects: NormalizedPageRect[],
  pages: ParsedPage[] = [],
  chunks: ParsedChunk[] = [],
  fallbackPageIndexes: number[] = [],
): EvidencePreview[] {
  const pageIndexes = [...new Set([...rects.map((rect) => rect.pageIndex), ...fallbackPageIndexes])]
  const evidence = chunks
    .filter((chunk) => pageIndexes.includes(chunk.pageIndex))
    .slice(0, 4)
    .map((chunk) => ({
      chunkId: chunk.chunkId,
      title: `第 ${chunk.pageIndex + 1} 页`,
      pageIndex: chunk.pageIndex,
    }))

  if (evidence.length > 0) {
    return evidence
  }

  return pageIndexes.map((pageIndex, index) => ({
      chunkId: `local-p${pageIndex + 1}-${index + 1}`,
      title: pageTextByIndex(pages, pageIndex) ? "转换稿上下文" : "当前选区",
      pageIndex,
    }))
}

export function makeLocalInterpretation(
  selectionText: string,
  rects: NormalizedPageRect[],
  pages: ParsedPage[] = [],
  chunks: ParsedChunk[] = [],
  hasBackendIndex = false,
  fallbackPageIndex?: number,
) {
  const compact = selectionText.replace(/\s+/g, " ").trim()
  const focus = compact.length > 120 ? `${compact.slice(0, 120)}…` : compact
  const pageIndex = rects[0]?.pageIndex ?? fallbackPageIndex
  const pageText = pageIndex !== undefined ? pageTextByIndex(pages, pageIndex) : ""
  const nearbyChunks = pageIndex !== undefined
    ? chunks.filter((chunk) => chunk.pageIndex === pageIndex).slice(0, 2)
    : []
  const citation = localCitationId(pageIndex, nearbyChunks)
  const context = pageText
    ? `\n\n已从转换稿附近文本中找到上下文 ${citation}：${pageText.slice(0, 220)}${pageText.length > 220 ? "…" : ""}`
    : ""
  const chunkContext =
    nearbyChunks.length > 0
      ? `\n\n命中的相关段落：${nearbyChunks
          .map((chunk) => `${localCitationId(chunk.pageIndex, [chunk])} ${chunk.text.slice(0, 90)}${chunk.text.length > 90 ? "…" : ""}`)
          .join(" ")}`
      : ""

  return [
    `这段文字的直接焦点是：“${focus}” ${citation}`,
    `${hasBackendIndex ? "当前版本已经把 PDF 转换成文字/Markdown，并写入本地 SQLite 文本索引。" : "当前版本已经先把 PDF 转换成文字/Markdown。"}这里的本地解读会使用转换后的正文文本，而不是直接拿 PDF 画面做处理。${context}${chunkContext}`,
    rects.length > 0
      ? "这次选区也带有规范页坐标，可用于高亮持久化；解读和引用会回到对应正文位置。"
      : "这次选区来自转换稿，会保存为文本锚点；解读和引用已经可以使用转换后的正文，原 PDF 坐标只用于更精确的版面校对。",
  ].join("\n\n")
}

export function makeLocalFollowUpAnswer(
  question: string,
  selectionText: string,
  pages: ParsedPage[] = [],
  rects: NormalizedPageRect[] = [],
  chunks: ParsedChunk[] = [],
  hasBackendIndex = false,
  fallbackPageIndex?: number,
) {
  const normalizedQuestion = question.trim()
  const compactSelection = selectionText.replace(/\s+/g, " ").trim()
  const pageIndex = rects[0]?.pageIndex ?? fallbackPageIndex
  const pageText = pageIndex !== undefined ? pageTextByIndex(pages, pageIndex) : ""
  const chunk = pageIndex !== undefined
    ? chunks.find((item) => item.pageIndex === pageIndex)
    : undefined
  const chunkText = chunk?.text ?? ""
  const citation = localCitationId(pageIndex, chunk ? [chunk] : [])

  return [
    `关于“${normalizedQuestion}”：当前回答基于你框选的文字和转换稿正文 ${citation}。`,
    compactSelection
      ? `这段原文的关键内容是“${compactSelection.slice(0, 90)}${compactSelection.length > 90 ? "…" : ""}”。如果你的问题是在问它的含义，第一层可以先看它在句内强调的因果、转折或定义关系。`
      : "还没有检测到选中文本，请先在转换稿上框选一段文字。",
    pageText
      ? `转换稿附近上下文 ${citation}：${pageText.slice(0, 180)}${pageText.length > 180 ? "…" : ""}`
      : "当前位置还没有可用的转换文本。",
    chunkText
      ? `相关段落 ${citation}：${chunkText.slice(0, 180)}${chunkText.length > 180 ? "…" : ""}`
      : "当前位置还没有生成可用正文。",
    hasBackendIndex
      ? "这次追问已优先使用桌面书库索引检索相关段落，再基于命中的证据回答。"
      : "当前运行环境没有可用的桌面书库索引，已回退到浏览器内存文本检索。",
  ].join("\n\n")
}

function localCitationId(pageIndex: number | undefined, chunks: ParsedChunk[]) {
  const firstChunkId = chunks[0]?.chunkId
  if (firstChunkId) {
    return `[${firstChunkId}]`
  }
  return pageIndex !== undefined ? `[local-p${pageIndex + 1}-1]` : "[local-selection]"
}

export function searchParsedPages(query: string, pages: ParsedPage[]) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) {
    return []
  }

  return pages
    .map((page) => {
      const haystack = page.text.toLowerCase()
      const score = terms.reduce((sum, term) => sum + countOccurrences(haystack, term), 0)
      return { page, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

export function searchParsedChunks(query: string, chunks: ParsedChunk[]) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) {
    return []
  }

  return chunks
    .map((chunk) => {
      const haystack = chunk.text.toLowerCase()
      const score = terms.reduce((sum, term) => sum + countOccurrences(haystack, term), 0)
      return { chunk, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
}

function countOccurrences(text: string, term: string) {
  let count = 0
  let index = text.indexOf(term)
  while (index !== -1) {
    count += 1
    index = text.indexOf(term, index + term.length)
  }
  return count
}
