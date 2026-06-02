import type { ParsedChunk, ParsedPage } from "@/stores/reader-store"
import type { PDFDocumentProxy } from "@/pdf/pdfjs-compat"

export type ReaderOutlineEntry = {
  id: string
  pageIndex: number
  title: string
  level: number
  chunkCount: number
  preview: string
  firstChunkId?: string
  sectionNumber?: string
  anchorText?: string
}

export function buildReaderOutline(
  pages: ParsedPage[],
  chunks: ParsedChunk[],
  totalPages: number,
  pdfOutlineEntries: ReaderOutlineEntry[] = [],
): ReaderOutlineEntry[] {
  const extractedEntries =
    pdfOutlineEntries.length > 0 ? pdfOutlineEntries : buildParsedHeadingOutline(pages, chunks)
  if (extractedEntries.length === 0) {
    return []
  }

  const chunkCounts = new Map<number, number>()
  const firstChunkIds = new Map<number, string>()
  const firstChunkText = new Map<number, string>()
  const chunksByPage = new Map<number, ParsedChunk[]>()
  for (const chunk of chunks) {
    chunkCounts.set(chunk.pageIndex, (chunkCounts.get(chunk.pageIndex) ?? 0) + 1)
    if (!firstChunkIds.has(chunk.pageIndex)) {
      firstChunkIds.set(chunk.pageIndex, chunk.chunkId)
      firstChunkText.set(chunk.pageIndex, chunk.text)
    }
    const pageChunks = chunksByPage.get(chunk.pageIndex) ?? []
    pageChunks.push(chunk)
    chunksByPage.set(chunk.pageIndex, pageChunks)
  }
  const pageMap = new Map(pages.map((page) => [page.pageIndex, page]))

  return extractedEntries
    .filter((entry) => totalPages <= 0 || (entry.pageIndex >= 0 && entry.pageIndex < totalPages))
    .map((entry) => {
      const page = pageMap.get(entry.pageIndex)
      const preview = entry.preview || compactPreview(page?.text ?? firstChunkText.get(entry.pageIndex) ?? "")
      const anchorText = entry.anchorText ?? anchorTextForHeading(entry, chunksByPage)
      return {
        ...entry,
        level: clampOutlineLevel(entry.level),
        chunkCount: chunkCounts.get(entry.pageIndex) ?? entry.chunkCount ?? 0,
        preview,
        anchorText,
        firstChunkId:
          entry.firstChunkId ??
          firstChunkIdForHeading({ ...entry, anchorText }, chunksByPage) ??
          firstChunkIds.get(entry.pageIndex),
      }
    })
}

export async function buildPdfOutlineEntries(pdf: PDFDocumentProxy): Promise<ReaderOutlineEntry[]> {
  if (typeof pdf.getOutline !== "function") {
    return []
  }
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline || outline.length === 0) {
    return []
  }

  const entries: ReaderOutlineEntry[] = []
  let order = 0

  async function visit(items: PdfOutlineNode[], level: number) {
    for (const item of items) {
      const parsedTitle = parseOutlineHeading(item.title)
      const pageIndex = await pageIndexForPdfDest(pdf, item.dest)
      if (parsedTitle && pageIndex !== null) {
        entries.push({
          id: `pdf-outline-${order}`,
          pageIndex,
          title: parsedTitle.title,
          level: parsedTitle.sectionNumber
            ? sectionLevel(parsedTitle.sectionNumber)
            : clampOutlineLevel(level),
          sectionNumber: parsedTitle.sectionNumber,
          anchorText: cleanOutlineLine(item.title),
          chunkCount: 0,
          preview: "",
        })
        order += 1
      }
      if (item.items?.length) {
        await visit(item.items, level + 1)
      }
    }
  }

  await visit(outline as PdfOutlineNode[], 1)
  return entries
}

type PdfOutlineNode = {
  title: string
  dest: string | unknown[] | null
  items?: PdfOutlineNode[]
}

type ParsedOutlineHeading = {
  title: string
  sectionNumber?: string
}

function buildParsedHeadingOutline(
  pages: ParsedPage[],
  chunks: ParsedChunk[],
): ReaderOutlineEntry[] {
  const entries: ReaderOutlineEntry[] = []
  const chunksByPage = new Map<number, ParsedChunk[]>()
  for (const chunk of chunks) {
    const pageChunks = chunksByPage.get(chunk.pageIndex) ?? []
    pageChunks.push(chunk)
    chunksByPage.set(chunk.pageIndex, pageChunks)
  }

  for (const page of [...pages].sort((left, right) => left.pageIndex - right.pageIndex)) {
    const pageEntries = [
      ...outlineEntriesFromMarkdown(page.markdown, page.pageIndex),
      ...outlineEntriesFromText(page.text, page.pageIndex),
    ]
    entries.push(...pageEntries)
  }

  if (entries.length === 0) {
    for (const chunk of chunks) {
      entries.push(...outlineEntriesFromText(chunk.text, chunk.pageIndex, "chunk-text"))
    }
  }

  return dedupeOutlineEntries(entries)
    .slice(0, 300)
    .map((entry) => ({
      ...entry,
      firstChunkId: entry.firstChunkId ?? firstChunkIdForHeading(entry, chunksByPage),
    }))
}

function outlineEntriesFromMarkdown(markdown: string, pageIndex: number) {
  const entries: ReaderOutlineEntry[] = []
  let inFence = false
  let order = 0

  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (/^```/.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }

    const headingMatch = rawLine.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (headingMatch) {
      const parsed = parseOutlineHeading(headingMatch[2])
      if (parsed) {
        entries.push({
          id: `markdown-${pageIndex}-${order}`,
          pageIndex,
          title: parsed.title,
          level: parsed.sectionNumber
            ? sectionLevel(parsed.sectionNumber)
            : clampOutlineLevel(headingMatch[1].length),
          sectionNumber: parsed.sectionNumber,
          anchorText: cleanOutlineLine(headingMatch[2]),
          chunkCount: 0,
          preview: "",
        })
        order += 1
      }
      continue
    }

    const numberedHeading = parseNumberedOutlineHeading(rawLine)
    if (numberedHeading) {
      entries.push({
        id: `markdown-numbered-${pageIndex}-${order}`,
        pageIndex,
        title: numberedHeading.title,
        level: sectionLevel(numberedHeading.sectionNumber),
        sectionNumber: numberedHeading.sectionNumber,
        anchorText: cleanOutlineLine(rawLine),
        chunkCount: 0,
        preview: "",
      })
      order += 1
    }
  }
  return entries
}

function outlineEntriesFromText(text: string, pageIndex: number, source = "text") {
  const entries: ReaderOutlineEntry[] = []
  let order = 0
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseNumberedOutlineHeading(line)
    if (!parsed) {
      continue
    }
    entries.push({
      id: `${source}-${pageIndex}-${order}`,
      pageIndex,
      title: parsed.title,
      level: sectionLevel(parsed.sectionNumber),
      sectionNumber: parsed.sectionNumber,
      anchorText: cleanOutlineLine(line),
      chunkCount: 0,
      preview: "",
    })
    order += 1
  }
  return entries
}

function dedupeOutlineEntries(entries: ReaderOutlineEntry[]) {
  const seen = new Set<string>()
  const deduped: ReaderOutlineEntry[] = []
  for (const entry of entries) {
    const key = `${entry.pageIndex}:${entry.sectionNumber ?? ""}:${normalizeKey(entry.title)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

function firstChunkIdForHeading(
  entry: ReaderOutlineEntry,
  chunksByPage: Map<number, ParsedChunk[]>,
) {
  const chunks = chunksByPage.get(entry.pageIndex) ?? []
  const headingNeedles = [
    entry.anchorText ?? "",
    entry.sectionNumber ? `${entry.sectionNumber} ${entry.title}` : "",
    entry.title,
  ]
    .map(normalizeHeadingKey)
    .filter(Boolean)
  return (
    chunks.find((chunk) => {
      const haystack = normalizeHeadingKey(`${chunk.markdown}\n${chunk.text}`)
      return headingNeedles.some((needle) => haystack.includes(needle))
    })?.chunkId ?? chunks[0]?.chunkId
  )
}

function anchorTextForHeading(
  entry: ReaderOutlineEntry,
  chunksByPage: Map<number, ParsedChunk[]>,
) {
  const chunks = chunksByPage.get(entry.pageIndex) ?? []
  for (const chunk of chunks) {
    for (const line of `${chunk.text}\n${chunk.markdown}`.split(/\r?\n/)) {
      const cleaned = cleanOutlineLine(line)
      const parsed = parseOutlineHeading(cleaned)
      if (!parsed || !outlineHeadingMatches(entry, parsed)) {
        continue
      }
      return cleaned
    }
  }
  return undefined
}

function outlineHeadingMatches(entry: ReaderOutlineEntry, parsed: ParsedOutlineHeading) {
  const entryTitle = normalizeHeadingKey(entry.title)
  const parsedTitle = normalizeHeadingKey(parsed.title)
  if (!entryTitle || entryTitle !== parsedTitle) {
    return false
  }
  if (!entry.sectionNumber) {
    return true
  }
  return (
    !parsed.sectionNumber ||
    normalizeHeadingKey(entry.sectionNumber) === normalizeHeadingKey(parsed.sectionNumber)
  )
}

async function pageIndexForPdfDest(pdf: PDFDocumentProxy, dest: string | unknown[] | null) {
  const explicitDest = typeof dest === "string" ? await pdf.getDestination(dest).catch(() => null) : dest
  if (!Array.isArray(explicitDest)) {
    return null
  }
  const destRef = explicitDest[0]
  let pageIndex: number | null = null
  if (isPdfPageRef(destRef)) {
    const cachedPageNumber = pdf.cachedPageNumber(destRef)
    pageIndex =
      cachedPageNumber !== null
        ? cachedPageNumber - 1
        : await pdf.getPageIndex(destRef).catch(() => null)
  } else if (Number.isInteger(destRef)) {
    pageIndex = destRef as number
  }
  if (pageIndex === null || pageIndex < 0 || pageIndex >= pdf.numPages) {
    return null
  }
  return pageIndex
}

function isPdfPageRef(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isInteger((value as { num?: unknown }).num) &&
    Number.isInteger((value as { gen?: unknown }).gen)
  )
}

function parseOutlineHeading(value: string): ParsedOutlineHeading | null {
  const cleaned = cleanOutlineLine(value)
  if (!cleaned || isSyntheticPageHeading(cleaned) || !looksLikeHeading(cleaned)) {
    return null
  }
  return splitSectionNumber(cleaned)
}

function parseNumberedOutlineHeading(value: string): Required<ParsedOutlineHeading> | null {
  const cleaned = cleanOutlineLine(value)
  if (!cleaned || isSyntheticPageHeading(cleaned) || !looksLikeHeading(cleaned)) {
    return null
  }
  const parsed = splitSectionNumber(cleaned)
  if (!parsed.sectionNumber) {
    return null
  }
  if (!parsed.sectionNumber.includes(".") && !/^第.+[章节篇部]$/.test(parsed.sectionNumber)) {
    return null
  }
  return {
    sectionNumber: parsed.sectionNumber,
    title: parsed.title,
  }
}

function splitSectionNumber(value: string): ParsedOutlineHeading {
  const normalized = value.replace(/[．。]/g, ".")
  const decimalMatch = normalized.match(
    /^((?:\d+|[A-Za-z])(?:\.\d+){1,5})(?:\.)?\s*[-–—、:：]?\s*(\S.*)$/,
  )
  if (decimalMatch) {
    return {
      sectionNumber: decimalMatch[1],
      title: decimalMatch[2].trim(),
    }
  }
  const singleNumberMatch = normalized.match(/^(\d+)(?:\.\s+|\s+|[、:：-]+)(\S.*)$/)
  if (singleNumberMatch) {
    return {
      sectionNumber: singleNumberMatch[1],
      title: singleNumberMatch[2].trim(),
    }
  }
  const chineseChapterMatch = value.match(
    /^(第[一二三四五六七八九十百千万零〇两\d]+[章节篇部])\s*[、:：.-]?\s*(\S.*)$/,
  )
  if (chineseChapterMatch) {
    return {
      sectionNumber: chineseChapterMatch[1],
      title: chineseChapterMatch[2].trim(),
    }
  }
  return { title: value }
}

function sectionLevel(sectionNumber: string) {
  if (/^第.+[章节篇部]$/.test(sectionNumber)) {
    return 1
  }
  return clampOutlineLevel(sectionNumber.split(".").filter(Boolean).length)
}

function compactPreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 96)
}

function cleanOutlineLine(value: string) {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*>\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/^\[[^\]]+]\s*/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96)
}

function isSyntheticPageHeading(value: string) {
  return (
    /^page\s+\d+$/i.test(value) ||
    /^第\s*[一二三四五六七八九十百千万零〇两\d]+\s*页$/.test(value) ||
    /^p\d+-c\d+\s+page\s+\d+$/i.test(value)
  )
}

function looksLikeHeading(value: string) {
  if (value.length < 2 || value.length > 96) {
    return false
  }
  if (/^\|.*\|$/.test(value) || value.includes("://")) {
    return false
  }
  return true
}

function normalizeKey(value: string) {
  return value.replace(/\s+/g, "").toLowerCase()
}

function normalizeHeadingKey(value: string) {
  return value
    .replace(/[\s.#*_`~:：、，,;；\-–—()[\]{}]+/g, "")
    .toLowerCase()
}

function clampOutlineLevel(level: number) {
  if (!Number.isFinite(level)) {
    return 1
  }
  return Math.min(Math.max(Math.round(level), 1), 6)
}
