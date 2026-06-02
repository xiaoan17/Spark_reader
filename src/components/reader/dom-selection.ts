export function selectionRangesWithin(
  selection: Selection | null | undefined,
  container: HTMLElement | null | undefined,
) {
  if (!selection || !container) {
    return []
  }
  const ranges: Range[] = []
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (
      range.toString().trim() &&
      container.contains(range.startContainer) &&
      container.contains(range.endContainer)
    ) {
      ranges.push(range)
    }
  }
  return ranges
}

export function selectedTextFromRanges(ranges: Range[]) {
  return ranges
    .map((range) => range.toString().trim())
    .filter(Boolean)
    .join("\n\n")
}

export function selectionToolbarPositionFromRanges(
  ranges: Range[],
  articleElement: HTMLElement | null,
  toolbarSize?: { width: number; height: number } | null,
) {
  if (ranges.length === 0 || !articleElement) {
    return null
  }
  const rects = ranges.flatMap((range) => rangeClientRects(range))
  const rect =
    boundingClientRectForRects(rects) ??
    boundingClientRectForRects(ranges.flatMap((range) => rangeBoundingClientRect(range)))
  if (!rect || (rect.width <= 0 && rect.height <= 0)) {
    return null
  }
  const articleRect = articleElement.getBoundingClientRect()
  const safeArticleWidth = Math.max(1, articleRect.width)
  const safeArticleHeight = Math.max(1, articleRect.height)
  const horizontalPadding = Math.min(16, Math.max(0, safeArticleWidth / 4))
  const toolbarWidth = Math.max(
    1,
    Math.min(
      toolbarSize?.width && toolbarSize.width > 0 ? toolbarSize.width : 520,
      safeArticleWidth - horizontalPadding * 2,
    ),
  )
  const toolbarHeight = Math.max(
    1,
    toolbarSize?.height && toolbarSize.height > 0 ? toolbarSize.height : 50,
  )
  const centerLeft = rect.left - articleRect.left + rect.width / 2 - toolbarWidth / 2
  const left = clamp(
    centerLeft,
    horizontalPadding,
    Math.max(horizontalPadding, safeArticleWidth - toolbarWidth - horizontalPadding),
  )
  const verticalGap = 12
  const topAbove = rect.top - articleRect.top - toolbarHeight - verticalGap
  const topBelow = rect.bottom - articleRect.top + 12
  const top = topAbove >= 16 ? topAbove : clamp(topBelow, 0, Math.max(0, safeArticleHeight - toolbarHeight))
  return { left, top }
}

function rangeClientRects(range: Range) {
  if (typeof range.getClientRects !== "function") {
    return []
  }
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
}

function rangeBoundingClientRect(range: Range) {
  if (typeof range.getBoundingClientRect !== "function") {
    return []
  }
  const rect = range.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? [rect] : []
}

function boundingClientRectForRects(rects: DOMRect[]) {
  if (rects.length === 0) {
    return null
  }
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  } as DOMRect
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
