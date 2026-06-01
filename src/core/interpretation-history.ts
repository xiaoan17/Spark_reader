import {
  makeTextQuoteSelector,
  normalizeWhitespace,
  resolveTextQuoteSelector,
} from "@/core/text-quote-selector"
import type {
  EvidencePreview,
  FollowUpTurn,
  ParsedChunk,
  ParsedPage,
  SavedInterpretation,
  TextSelectionAnchor,
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"

export type InterpretationRestoreTarget = {
  pageNumber: number
  selectionText: string
  selectionRects: NormalizedPageRect[]
  selectionAnchor: TextSelectionAnchor | null
  activeChunkId: string
  evidence: EvidencePreview[]
  interpretation: string
  followUps: FollowUpTurn[]
}

export type InterpretationSessionSummary = SavedInterpretation & {
  turnCount: number
  followUpCount: number
  lastQuestion: string | null
  lastAnswer: string
  lastCreatedAt: string
}

export function summarizeInterpretationSessions(items: SavedInterpretation[]): InterpretationSessionSummary[] {
  const sessions = new Map<string, SavedInterpretation[]>()
  for (const item of items) {
    const sessionId = item.sessionId || item.id
    const group = sessions.get(sessionId) ?? []
    group.push(item)
    sessions.set(sessionId, group)
  }

  return [...sessions.values()]
    .map(sessionSummary)
    .filter((item): item is InterpretationSessionSummary => Boolean(item))
    .sort((left, right) => right.lastCreatedAt.localeCompare(left.lastCreatedAt))
}

function sessionSummary(group: SavedInterpretation[]): InterpretationSessionSummary | null {
  const turns = [...group].sort(
    (left, right) =>
      left.turnIndex - right.turnIndex || left.createdAt.localeCompare(right.createdAt),
  )
  const first = turns[0]
  if (!first) {
    return null
  }
  const last = [...turns].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? first
  const followUps = turns.filter((turn) => Boolean(turn.question))
  const lastFollowUp = [...followUps].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0]

  return {
    ...first,
    turnCount: turns.length,
    followUpCount: followUps.length,
    lastQuestion: lastFollowUp?.question ?? null,
    lastAnswer: last.answer,
    lastCreatedAt: last.createdAt,
  }
}

export function restoreTargetForSavedInterpretation(
  item: SavedInterpretation,
  chunks: ParsedChunk[],
  pages: ParsedPage[],
  history: SavedInterpretation[] = [],
): InterpretationRestoreTarget {
  const sessionTurns = sessionTurnsForItem(item, history)
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]))
  const pagesByIndex = new Map(pages.map((page) => [page.pageIndex, page]))
  const evidence = item.evidenceChunkIds.map((chunkId) => {
    const chunk = chunksById.get(chunkId)
    return {
      chunkId,
      title: `Chunk ${chunkId}`,
      pageIndex: chunk?.pageIndex ?? item.pageIndexes[0] ?? 0,
    }
  })
  const firstEvidenceChunk = item.evidenceChunkIds
    .map((chunkId) => chunksById.get(chunkId))
    .find((chunk): chunk is ParsedChunk => Boolean(chunk))

  const anchoredSelection = findSelectionAnchor(item, pagesByIndex)
  const targetPageIndex =
    anchoredSelection?.pageIndex ??
    firstEvidenceChunk?.pageIndex ??
    item.pageIndexes[0] ??
    0
  const targetPage = pagesByIndex.get(targetPageIndex)
  const selectionAnchor =
    anchoredSelection ??
    (targetPage ? selectionAnchorForPage(targetPage, item.selectionText) : null)
  const selectionRects =
    selectionAnchor || firstEvidenceChunk?.pageIndex !== targetPageIndex
      ? []
      : firstEvidenceChunk?.rects ?? []

  return {
    pageNumber: targetPageIndex + 1,
    selectionText: item.selectionText,
    selectionRects,
    selectionAnchor,
    activeChunkId: firstEvidenceChunk?.chunkId ?? item.evidenceChunkIds[0] ?? "",
    evidence,
    interpretation:
      sessionTurns.find((turn) => !turn.question)?.answer ??
      (item.question ? "" : item.answer),
    followUps: sessionTurns
      .filter((turn) => turn.question)
      .map((turn) => ({
        id: turn.id,
        question: turn.question ?? "",
        answer: turn.answer,
      })),
  }
}

function sessionTurnsForItem(item: SavedInterpretation, history: SavedInterpretation[]) {
  const sessionId = item.sessionId || item.id
  const turns = history
    .filter((candidate) => (candidate.sessionId || candidate.id) === sessionId)
    .sort((left, right) => left.turnIndex - right.turnIndex)
  return turns.length > 0 ? turns : [item]
}

function findSelectionAnchor(item: SavedInterpretation, pagesByIndex: Map<number, ParsedPage>) {
  const storedPageIndex = item.pageIndex
  if (storedPageIndex !== null && storedPageIndex !== undefined) {
    const page = pagesByIndex.get(storedPageIndex)
    if (page) {
      const resolved = resolveStoredAnchor(item, page)
      if (resolved) {
        return resolved
      }
    }
  }

  const preferredPages = [
    ...item.pageIndexes,
    ...pagesByIndex.keys(),
  ]
  const seen = new Set<number>()
  for (const pageIndex of preferredPages) {
    if (seen.has(pageIndex)) continue
    seen.add(pageIndex)
    const page = pagesByIndex.get(pageIndex)
    if (!page) continue
    const anchor = selectionAnchorForPage(page, item.selectionText)
    if (anchor) {
      return anchor
    }
  }
  return null
}

function resolveStoredAnchor(
  item: SavedInterpretation,
  page: ParsedPage,
): TextSelectionAnchor | null {
  const resolved = resolveTextQuoteSelector(page.text, {
    exact: item.selectionText,
    prefix: item.prefix ?? "",
    suffix: item.suffix ?? "",
    positionStart: item.positionStart ?? null,
    positionEnd: item.positionEnd ?? null,
  })
  if (!resolved) {
    return null
  }
  return {
    pageIndex: page.pageIndex,
    positionStart: resolved.positionStart,
    positionEnd: resolved.positionEnd,
  }
}

function selectionAnchorForPage(
  page: ParsedPage,
  selectionText: string,
): TextSelectionAnchor | null {
  if (!normalizeWhitespace(selectionText) || !normalizeWhitespace(page.text)) {
    return null
  }
  const selector = makeTextQuoteSelector(page.text, selectionText)
  if (selector.positionStart === null || selector.positionEnd === null) {
    return null
  }
  return {
    pageIndex: page.pageIndex,
    positionStart: selector.positionStart,
    positionEnd: selector.positionEnd,
  }
}
