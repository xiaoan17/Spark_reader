import type { NormalizedPageRect } from "@/core/coordinates"
import type { ParsedChunk, ParsedPage, TextSelectionAnchor } from "@/stores/reader-store"
import { normalizeWhitespace } from "@/core/text-quote-selector"

export function focusChunkIdsForSelection({
  selectionText,
  selectionRects,
  selectionAnchor,
  currentPage,
  chunks,
  pages = [],
  limit = 4,
}: {
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  currentPage: number
  chunks: ParsedChunk[]
  pages?: ParsedPage[]
  limit?: number
}) {
  const normalizedSelection = normalizeWhitespace(selectionText)
  if (!normalizedSelection || chunks.length === 0 || limit <= 0) {
    return []
  }

  const candidatePageIndexes = new Set<number>()
  for (const rect of selectionRects) {
    candidatePageIndexes.add(rect.pageIndex)
  }
  if (selectionAnchor) {
    candidatePageIndexes.add(selectionAnchor.pageIndex)
  }
  if (candidatePageIndexes.size === 0 && currentPage > 0) {
    candidatePageIndexes.add(currentPage - 1)
  }

  const pageOrder = new Map(
    [...candidatePageIndexes].map((pageIndex, order) => [pageIndex, order]),
  )
  const chunkRanges = inferChunkRanges(chunks, pages)
  const scored = chunks
    .filter((chunk) => candidatePageIndexes.has(chunk.pageIndex))
    .map((chunk) => {
      const textScore = textOverlapScore(normalizedSelection, normalizeWhitespace(chunk.text))
      const rectOverlap = rectOverlapScore(selectionRects, chunk.rects)
      const anchorOverlap = anchorOverlapScore(selectionAnchor, chunkRanges.get(chunk.chunkId))
      const hasDirectSignal = textScore > 0 || rectOverlap > 0 || anchorOverlap > 0
      return {
        chunk,
        anchorOverlap,
        rectOverlap,
        score:
          textScore +
          rectOverlap +
          anchorOverlap +
          (hasDirectSignal ? anchorPageScore(selectionAnchor, chunk) : 0),
      }
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.anchorOverlap - a.anchorOverlap ||
        compareNumberDesc(b.rectOverlap, a.rectOverlap) ||
        compareNumberDesc(b.score, a.score) ||
        (pageOrder.get(a.chunk.pageIndex) ?? Number.MAX_SAFE_INTEGER) -
          (pageOrder.get(b.chunk.pageIndex) ?? Number.MAX_SAFE_INTEGER) ||
        a.chunk.pageIndex - b.chunk.pageIndex ||
        a.chunk.chunkId.localeCompare(b.chunk.chunkId),
    )

  return scored.slice(0, limit).map((item) => item.chunk.chunkId)
}

function textOverlapScore(selection: string, chunkText: string) {
  if (!selection || !chunkText) {
    return 0
  }
  if (chunkText.includes(selection)) {
    return 1000 + selection.length
  }
  if (selection.includes(chunkText)) {
    return 700 + chunkText.length
  }

  const terms = lexicalTerms(selection)
  if (terms.length === 0) {
    return 0
  }
  return terms.reduce((score, term) => score + (chunkText.includes(term) ? term.length : 0), 0)
}

function anchorPageScore(anchor: TextSelectionAnchor | null, chunk: ParsedChunk) {
  if (!anchor || anchor.pageIndex !== chunk.pageIndex) {
    return 0
  }
  const normalizedChunk = normalizeWhitespace(chunk.text)
  if (!normalizedChunk) {
    return 0
  }
  return 20
}

function anchorOverlapScore(anchor: TextSelectionAnchor | null, chunkRange?: ChunkTextRange) {
  if (!anchor || !chunkRange || anchor.pageIndex !== chunkRange.pageIndex) {
    return 0
  }
  const overlap = Math.max(
    0,
    Math.min(anchor.positionEnd, chunkRange.end) - Math.max(anchor.positionStart, chunkRange.start),
  )
  if (overlap <= 0) {
    return 0
  }
  return 5000 + overlap * 20
}

function rectOverlapScore(selectionRects: NormalizedPageRect[], chunkRects: NormalizedPageRect[]) {
  if (selectionRects.length === 0 || chunkRects.length === 0) {
    return 0
  }

  let score = 0
  for (const selectionRect of selectionRects) {
    for (const chunkRect of chunkRects) {
      if (selectionRect.pageIndex !== chunkRect.pageIndex) {
        continue
      }
      score += rectIntersectionArea(selectionRect, chunkRect)
    }
  }
  return score * 1000
}

function rectIntersectionArea(left: NormalizedPageRect, right: NormalizedPageRect) {
  const width = Math.max(0, Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0))
  const height = Math.max(0, Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0))
  return width * height
}

function compareNumberDesc(left: number, right: number) {
  return Math.abs(left - right) < 1e-9 ? 0 : left - right
}

function lexicalTerms(value: string) {
  const compact = value.toLowerCase()
  const terms = compact
    .split(/[\s，。；：！？、,.;:!?()[\]（）"'“”‘’]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)

  const cjkChars = [...compact].filter((char) => /[\p{Script=Han}]/u.test(char))
  for (let index = 0; index < cjkChars.length - 1 && index < 80; index += 1) {
    terms.push(cjkChars.slice(index, index + 2).join(""))
  }
  for (let index = 0; index < cjkChars.length - 2 && index < 80; index += 1) {
    terms.push(cjkChars.slice(index, index + 3).join(""))
  }

  return [...new Set(terms)]
}

type ChunkTextRange = {
  pageIndex: number
  start: number
  end: number
}

function inferChunkRanges(chunks: ParsedChunk[], pages: ParsedPage[]) {
  const pageTextByIndex = new Map(
    pages.map((page) => [page.pageIndex, normalizeWhitespace(page.text)]),
  )
  const cursorByPage = new Map<number, number>()
  const ranges = new Map<string, ChunkTextRange>()

  for (const chunk of chunks) {
    const pageText = pageTextByIndex.get(chunk.pageIndex)
    const chunkText = normalizeWhitespace(chunk.text)
    if (!pageText || !chunkText) {
      continue
    }

    const cursor = cursorByPage.get(chunk.pageIndex) ?? 0
    let start = pageText.indexOf(chunkText, cursor)
    if (start < 0) {
      start = pageText.indexOf(chunkText)
    }
    if (start < 0) {
      continue
    }

    const end = start + chunkText.length
    ranges.set(chunk.chunkId, {
      pageIndex: chunk.pageIndex,
      start,
      end,
    })
    cursorByPage.set(chunk.pageIndex, end)
  }

  return ranges
}
