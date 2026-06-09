import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedInterpretation } from "@/stores/reader-store"
import { SparkMarginDots } from "./SparkMarginDots"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

async function renderClient(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe("SparkMarginDots", () => {
  const originalRangeGetClientRects = Range.prototype.getClientRects
  const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect
  const originalResizeObserver = globalThis.ResizeObserver

  let resizeCallbacks: ResizeObserverCallback[] = []

  beforeEach(() => {
    document.body.replaceChildren()
    resizeCallbacks = []
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }

      observe() {}

      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  })

  afterEach(() => {
    Range.prototype.getClientRects = originalRangeGetClientRects
    Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect
    if (originalResizeObserver) {
      vi.stubGlobal("ResizeObserver", originalResizeObserver)
    } else {
      vi.unstubAllGlobals()
    }
  })

  it("positions a dot from normalized source offsets when no highlight mark is rendered", async () => {
    Range.prototype.getClientRects = vi.fn(function getClientRectsMock(this: Range) {
      return [rect(590, 20, 120, 90)] as unknown as DOMRectList
    })
    Range.prototype.getBoundingClientRect = vi.fn(() => rect(590, 20, 120, 90))

    const pageText = "alpha selected phrase omega"
    const item: SavedInterpretation = {
      id: "spark-range",
      bookId: "book-1",
      selectionText: "selected phrase",
      sessionId: "spark-range",
      turnIndex: 0,
      prefix: "alpha ",
      suffix: " omega",
      pageIndex: 0,
      positionStart: 6,
      positionEnd: 21,
      pageIndexes: [0],
      evidenceChunkIds: [],
      answer: "",
      kind: "interpretation",
      createdAt: "2026-06-01T00:00:00Z",
    }

    const client = await renderClient(
      <article data-readable-page data-page-index="0">
        <div data-spark-text-root>{pageText}</div>
        <SparkMarginDots
          pageIndex={0}
          pageText={pageText}
          pageSelector="[data-readable-page]"
          items={[item]}
        />
      </article>,
    )

    const margin = client.container.querySelector<HTMLElement>("[data-spark-margin-dots]")!
    margin.getBoundingClientRect = vi.fn(() => rect(200, 800, 700, 20))

    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver)
      }
      await Promise.resolve()
    })

    const dot = client.container.querySelector<HTMLButtonElement>("button[aria-label='打开 Spark']")!
    expect(dot.style.top).toBe("50%")
    expect(Range.prototype.getClientRects).toHaveBeenCalled()
    client.unmount()
  })
})
