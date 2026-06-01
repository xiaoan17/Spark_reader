import { normalizeWhitespace } from "@/core/text-quote-selector"
import type { TextSelectionAnchor } from "@/stores/reader-store"

export function textSelectionAnchorFromOffsets(
  pageText: string,
  selectedText: string,
  pageIndex: number,
  rawStart: number,
  rawEnd: number,
): TextSelectionAnchor | null {
  const exact = normalizeWhitespace(selectedText)
  if (!exact || rawEnd <= rawStart) {
    return null
  }
  const positionStart = normalizedOffsetForRawOffset(pageText, rawStart)
  const positionEnd = normalizedOffsetForRawOffset(pageText, rawEnd)
  if (positionEnd <= positionStart) {
    return null
  }
  const normalizedPage = normalizeWhitespace(pageText)
  if (normalizedPage.slice(positionStart, positionEnd) !== exact) {
    return null
  }
  return { pageIndex, positionStart, positionEnd }
}

export function textSelectionAnchorFromDom(
  selection: Selection,
  pageText: string,
  pageIndex: number,
  textElement: HTMLElement,
): TextSelectionAnchor | null {
  if (selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (
    !textElement.contains(range.startContainer) ||
    !textElement.contains(range.endContainer)
  ) {
    return null
  }
  const selectedText = range.toString()
  const normalizedSelected = normalizeWhitespace(selectedText)
  const normalizedSource = normalizeWhitespace(pageText)
  if (!normalizedSelected || !normalizedSource) {
    return null
  }

  const selectedOrdinal = selectedTextOccurrenceOrdinal(selection, textElement, normalizedSelected)
  const normalizedStart = normalizedOffsetForOccurrence(
    normalizedSource,
    normalizedSelected,
    selectedOrdinal,
  )
  if (normalizedStart < 0) {
    return null
  }
  const rawStart = rawOffsetForNormalizedOffset(pageText, normalizedStart)
  const rawEnd = rawOffsetForNormalizedOffset(pageText, normalizedStart + normalizedSelected.length)

  return textSelectionAnchorFromOffsets(pageText, selectedText, pageIndex, rawStart, rawEnd)
}

export function normalizedOffsetForRawOffset(text: string, rawOffset: number) {
  const boundedOffset = Math.min(Math.max(rawOffset, 0), text.length)
  let normalizedCursor = 0
  let inWhitespace = false

  for (let index = 0; index < boundedOffset; index += 1) {
    const char = text[index]
    if (/\s/.test(char)) {
      if (!inWhitespace && normalizedCursor > 0) {
        normalizedCursor += 1
        inWhitespace = true
      }
      continue
    }
    normalizedCursor += 1
    inWhitespace = false
  }

  return normalizedCursor
}

export function rawOffsetForNormalizedOffset(text: string, normalizedOffset: number) {
  let normalizedCursor = 0
  let inWhitespace = false

  for (let rawOffset = 0; rawOffset < text.length; rawOffset += 1) {
    if (normalizedCursor >= normalizedOffset) {
      return rawOffset
    }
    const char = text[rawOffset]
    if (/\s/.test(char)) {
      if (!inWhitespace && normalizedCursor > 0) {
        normalizedCursor += 1
        inWhitespace = true
      }
      continue
    }
    normalizedCursor += 1
    inWhitespace = false
  }

  return text.length
}

function selectedTextOccurrenceOrdinal(
  selection: Selection,
  textElement: HTMLElement,
  normalizedSelected: string,
) {
  const range = selection.getRangeAt(0)
  const preRange = document.createRange()
  preRange.selectNodeContents(textElement)
  preRange.setEnd(range.startContainer, range.startOffset)
  const normalizedBefore = normalizeWhitespace(preRange.toString())
  if (!normalizedBefore) {
    return 0
  }

  let ordinal = 0
  let cursor = 0
  while (cursor <= normalizedBefore.length) {
    const found = normalizedBefore.indexOf(normalizedSelected, cursor)
    if (found < 0) {
      break
    }
    ordinal += 1
    cursor = found + Math.max(1, normalizedSelected.length)
  }
  return ordinal
}

function normalizedOffsetForOccurrence(
  normalizedSource: string,
  normalizedSelected: string,
  ordinal: number,
) {
  let cursor = 0
  let seen = 0
  while (cursor <= normalizedSource.length) {
    const found = normalizedSource.indexOf(normalizedSelected, cursor)
    if (found < 0) {
      return -1
    }
    if (seen === ordinal) {
      return found
    }
    seen += 1
    cursor = found + Math.max(1, normalizedSelected.length)
  }
  return -1
}
