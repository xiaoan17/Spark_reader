export type VirtualPageMetrics = {
  offsets: number[]
  heights: number[]
  totalHeight: number
}

export type VirtualPageItem = {
  index: number
  offsetTop: number
  height: number
}

export function buildVirtualPageMetrics({
  count,
  estimatedHeight,
  gap,
  measuredHeights,
}: {
  count: number
  estimatedHeight: number
  gap: number
  measuredHeights: Map<number, number>
}): VirtualPageMetrics {
  const offsets: number[] = []
  const heights: number[] = []
  let cursor = 0
  for (let index = 0; index < count; index += 1) {
    const measuredHeight = measuredHeights.get(index)
    const height = measuredHeight && measuredHeight > 0 ? measuredHeight : estimatedHeight
    offsets.push(cursor)
    heights.push(height)
    cursor += height + (index === count - 1 ? 0 : gap)
  }
  return { offsets, heights, totalHeight: cursor }
}

export function virtualPageItems({
  metrics,
  scrollTop,
  viewportHeight,
  overscan,
}: {
  metrics: VirtualPageMetrics
  scrollTop: number
  viewportHeight: number
  overscan: number
}): VirtualPageItem[] {
  const count = metrics.heights.length
  if (count === 0) {
    return []
  }
  const startOffset = Math.max(0, scrollTop - overscan)
  const endOffset = scrollTop + viewportHeight + overscan
  const start = findFirstPageEndingAfter(metrics, startOffset)
  const end = findLastPageStartingBefore(metrics, endOffset)
  const items: VirtualPageItem[] = []
  for (let index = start; index <= end; index += 1) {
    items.push({
      index,
      offsetTop: metrics.offsets[index],
      height: metrics.heights[index],
    })
  }
  return items
}

export function virtualPageIndexAtOffset(metrics: VirtualPageMetrics, offset: number, fallback = 0) {
  const count = metrics.heights.length
  if (count === 0) {
    return fallback
  }
  const index = findLastPageStartingBefore(metrics, offset)
  return Math.min(Math.max(index, 0), count - 1)
}

export function virtualPageOffset(metrics: VirtualPageMetrics, index: number, topOffset = 0) {
  if (metrics.offsets.length === 0) {
    return 0
  }
  const safeIndex = Math.min(Math.max(index, 0), metrics.offsets.length - 1)
  return Math.max(0, metrics.offsets[safeIndex] - topOffset)
}

function findFirstPageEndingAfter(metrics: VirtualPageMetrics, offset: number) {
  let low = 0
  let high = metrics.heights.length - 1
  let result = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (metrics.offsets[mid] + metrics.heights[mid] >= offset) {
      result = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  return result
}

function findLastPageStartingBefore(metrics: VirtualPageMetrics, offset: number) {
  let low = 0
  let high = metrics.offsets.length - 1
  let result = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (metrics.offsets[mid] <= offset) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}
