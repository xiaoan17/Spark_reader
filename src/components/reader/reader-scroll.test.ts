import { describe, expect, it, vi } from "vitest"
import { buildVirtualPageMetrics } from "./virtual-pages"
import {
  clearProgrammaticPageScroll,
  consumeVisiblePageUpdateFromReaderScroll,
  scrollElementIntoScrollerView,
  scrollVirtualPageIntoScrollerView,
  startProgrammaticPageScroll,
  type ProgrammaticPageScrollRef,
} from "./reader-scroll"

function elementWithRect(rect: Partial<DOMRect>, scrollTop = 0) {
  const listeners = new Map<string, EventListener>()
  return {
    scrollTop,
    scrollTo: vi.fn(function (this: { scrollTop: number }, options: ScrollToOptions) {
      this.scrollTop = Number(options.top ?? 0)
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type)
    }),
    getBoundingClientRect: () => ({
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      right: rect.right ?? 0,
      bottom: rect.bottom ?? 0,
      width: rect.width ?? 0,
      height: rect.height ?? 0,
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      toJSON: () => ({}),
    }),
    listeners,
  } as unknown as HTMLElement & {
    scrollTo: ReturnType<typeof vi.fn>
    listeners: Map<string, EventListener>
  }
}

describe("reader scroll helpers", () => {
  it("scrolls a concrete page element into the scroller coordinate space", () => {
    const scroller = elementWithRect({ top: 10 }, 120)
    const target = elementWithRect({ top: 250 })

    expect(scrollElementIntoScrollerView(scroller, target, { topOffset: 24 })).toBe(336)
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 336, behavior: "smooth" })
  })

  it("scrolls virtual pages using precomputed metrics", () => {
    const scroller = elementWithRect({ top: 0 }, 0)
    const metrics = buildVirtualPageMetrics({
      count: 5,
      estimatedHeight: 100,
      gap: 10,
      measuredHeights: new Map([[0, 120]]),
    })

    expect(scrollVirtualPageIntoScrollerView(scroller, metrics, 2, { topOffset: 12 })).toBe(228)
  })

  it("cleans up pending programmatic scroll state", () => {
    vi.useFakeTimers()
    const scroller = elementWithRect({ top: 0 }, 0)
    const ref: ProgrammaticPageScrollRef = { current: null }

    startProgrammaticPageScroll(ref, 3, 420, scroller)

    expect(ref.current?.page).toBe(3)
    expect(scroller.addEventListener).toHaveBeenCalledWith("scrollend", expect.any(Function), {
      once: true,
    })

    clearProgrammaticPageScroll(ref)

    expect(ref.current).toBeNull()
    expect(scroller.removeEventListener).toHaveBeenCalledWith("scrollend", expect.any(Function))
    vi.useRealTimers()
  })

  it("consumes reader-originated page updates once", () => {
    const ref = { current: 4 }

    expect(consumeVisiblePageUpdateFromReaderScroll(ref, 4)).toBe(true)
    expect(ref.current).toBeNull()
    expect(consumeVisiblePageUpdateFromReaderScroll(ref, 4)).toBe(false)
  })
})
