import { describe, expect, it } from "vitest"
import {
  buildVirtualPageMetrics,
  virtualPageIndexAtOffset,
  virtualPageItems,
  virtualPageOffset,
} from "./virtual-pages"

describe("virtual page helpers", () => {
  it("keeps total height while rendering only the visible window plus overscan", () => {
    const metrics = buildVirtualPageMetrics({
      count: 100,
      estimatedHeight: 100,
      gap: 10,
      measuredHeights: new Map([[2, 180]]),
    })

    expect(metrics.totalHeight).toBe(11070)
    expect(virtualPageOffset(metrics, 3)).toBe(410)
    expect(virtualPageIndexAtOffset(metrics, 415)).toBe(3)

    const items = virtualPageItems({
      metrics,
      scrollTop: 390,
      viewportHeight: 250,
      overscan: 50,
    })

    expect(items.map((item) => item.index)).toEqual([2, 3, 4, 5])
    expect(items[0]).toEqual({ index: 2, offsetTop: 220, height: 180 })
  })
})
