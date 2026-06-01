export type TextQuoteSelector = {
  exact: string
  prefix: string
  suffix: string
  positionStart: number | null
  positionEnd: number | null
}

export type ResolvedTextQuoteSelector = {
  positionStart: number
  positionEnd: number
  strategy: "position" | "quote-context" | "exact"
}

const CONTEXT_CHARS = 32

export function makeTextQuoteSelector(
  pageText: string,
  selectionText: string,
  preferredPositionStart?: number | null,
): TextQuoteSelector {
  const exact = normalizeWhitespace(selectionText)
  const normalizedPage = normalizeWhitespace(pageText)
  if (!exact || !normalizedPage) {
    return emptySelector(exact)
  }

  const positionStart = resolvePositionStart(normalizedPage, exact, preferredPositionStart)
  if (positionStart < 0) {
    return emptySelector(exact)
  }

  const positionEnd = positionStart + exact.length
  return {
    exact,
    prefix: normalizedPage.slice(Math.max(0, positionStart - CONTEXT_CHARS), positionStart),
    suffix: normalizedPage.slice(positionEnd, positionEnd + CONTEXT_CHARS),
    positionStart,
    positionEnd,
  }
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export function resolveTextQuoteSelector(
  pageText: string,
  selector: Pick<TextQuoteSelector, "exact" | "prefix" | "suffix" | "positionStart" | "positionEnd">,
): ResolvedTextQuoteSelector | null {
  const exact = normalizeWhitespace(selector.exact)
  const normalizedPage = normalizeWhitespace(pageText)
  if (!exact || !normalizedPage) {
    return null
  }

  const contextMatch = findQuoteWithContext(
    normalizedPage,
    exact,
    normalizeWhitespace(selector.prefix),
    normalizeWhitespace(selector.suffix),
  )

  if (
    selector.positionStart !== null &&
    selector.positionStart !== undefined &&
    selector.positionStart >= 0 &&
    normalizedPage.slice(selector.positionStart, selector.positionStart + exact.length) === exact
  ) {
    if (contextMatch !== null && contextMatch !== selector.positionStart) {
      return {
        positionStart: contextMatch,
        positionEnd: contextMatch + exact.length,
        strategy: "quote-context",
      }
    }
    return {
      positionStart: selector.positionStart,
      positionEnd: selector.positionStart + exact.length,
      strategy: "position",
    }
  }

  if (contextMatch !== null) {
    return {
      positionStart: contextMatch,
      positionEnd: contextMatch + exact.length,
      strategy: "quote-context",
    }
  }

  const exactMatch = normalizedPage.indexOf(exact)
  if (exactMatch >= 0) {
    return {
      positionStart: exactMatch,
      positionEnd: exactMatch + exact.length,
      strategy: "exact",
    }
  }

  return null
}

function resolvePositionStart(
  normalizedPage: string,
  exact: string,
  preferredPositionStart?: number | null,
) {
  if (
    preferredPositionStart !== undefined &&
    preferredPositionStart !== null &&
    preferredPositionStart >= 0 &&
    normalizedPage.slice(preferredPositionStart, preferredPositionStart + exact.length) === exact
  ) {
    return preferredPositionStart
  }
  return normalizedPage.indexOf(exact)
}

function emptySelector(exact: string): TextQuoteSelector {
  return {
    exact,
    prefix: "",
    suffix: "",
    positionStart: null,
    positionEnd: null,
  }
}

function findQuoteWithContext(
  normalizedPage: string,
  exact: string,
  prefix: string,
  suffix: string,
) {
  let bestPosition: number | null = null
  let bestScore = -1
  let cursor = 0

  while (cursor <= normalizedPage.length) {
    const position = normalizedPage.indexOf(exact, cursor)
    if (position < 0) {
      break
    }
    const end = position + exact.length
    const score =
      contextSuffixScore(normalizedPage.slice(0, position), prefix) +
      contextPrefixScore(normalizedPage.slice(end), suffix)
    if (score > bestScore) {
      bestPosition = position
      bestScore = score
    }
    cursor = position + Math.max(1, exact.length)
  }

  return bestScore > 0 ? bestPosition : null
}

function contextSuffixScore(leftContext: string, prefix: string) {
  if (!prefix) {
    return 0
  }
  const max = Math.min(leftContext.length, prefix.length)
  for (let length = max; length > 0; length -= 1) {
    if (leftContext.endsWith(prefix.slice(prefix.length - length))) {
      return length
    }
  }
  return 0
}

function contextPrefixScore(rightContext: string, suffix: string) {
  if (!suffix) {
    return 0
  }
  const max = Math.min(rightContext.length, suffix.length)
  for (let length = max; length > 0; length -= 1) {
    if (rightContext.startsWith(suffix.slice(0, length))) {
      return length
    }
  }
  return 0
}
