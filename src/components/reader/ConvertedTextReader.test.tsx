import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedChunk, ParsedPage, SavedInterpretation } from "@/stores/reader-store"
import { ConvertedTextReader } from "./ConvertedTextReader"
import { readablePageClassName } from "./readable-page-class"

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
    rerender: async (nextElement: React.ReactElement) => {
      await act(async () => {
        root.render(nextElement)
        await Promise.resolve()
        await Promise.resolve()
      })
    },
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  HTMLElement.prototype.scrollTo = vi.fn(function scrollToMock(
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options === "object" && typeof options.top === "number") {
      this.scrollTop = options.top
    }
  })
})

function readerProps(overrides: Partial<React.ComponentProps<typeof ConvertedTextReader>> = {}) {
  return {
    pages: [],
    chunksByPage: new Map<number, ParsedChunk[]>(),
    activeChunkId: "",
    currentPage: 1,
    totalPages: 1,
    approximateSelection: false,
    highlights: [],
    selectionText: "",
    selectionRects: [],
    selectionAnchor: null,
    quality: null,
    onExplain: vi.fn(),
    onPlainExplain: vi.fn(),
    onHighlight: vi.fn(),
    onTextSelection: vi.fn(),
    onClearSelection: vi.fn(),
    onCurrentPageChange: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof ConvertedTextReader>
}

describe("ConvertedTextReader", () => {
  it("only applies document edge padding to true first and last pages", () => {
    const firstPage = readablePageClassName(0, 4)
    const middlePage = readablePageClassName(1, 4)
    const lastPage = readablePageClassName(3, 4)

    expect(firstPage).toContain("py-8")
    expect(firstPage).not.toContain("bg-card")
    expect(firstPage).not.toContain("shadow")
    expect(firstPage).not.toContain("pt-10")
    expect(firstPage).not.toContain("pb-16")
    expect(middlePage).not.toContain("pt-10")
    expect(middlePage).not.toContain("pb-16")
    expect(lastPage).not.toContain("pt-10")
    expect(lastPage).toContain("pb-16")
  })

  it("does not treat the first rendered virtual item as the document first page", () => {
    expect(readablePageClassName(6, 20)).not.toContain("pt-10")
  })

  it("renders loaded pages by pageIndex instead of array position", async () => {
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "第一页",
        markdown: "第一页",
        loaded: true,
      },
      {
        pageIndex: 1,
        text: "",
        markdown: "",
        loaded: false,
      },
      {
        pageIndex: 2,
        text: "第三页目标内容",
        markdown: "第三页目标内容",
        loaded: true,
      },
    ]

    const client = await renderClient(
      <ConvertedTextReader
        pages={[pages[0], pages[2]]}
        chunksByPage={new Map()}
        activeChunkId=""
        currentPage={3}
        totalPages={3}
        approximateSelection={false}
        highlights={[]}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        quality={null}
        onExplain={vi.fn()}
        onPlainExplain={vi.fn()}
        onHighlight={vi.fn()}
        onTextSelection={vi.fn()}
        onClearSelection={vi.fn()}
        onCurrentPageChange={vi.fn()}
      />,
    )

    expect(client.container.textContent).toContain("第三页目标内容")
    expect(client.container.textContent).not.toContain("这里没有抽取到可用文字")
    client.unmount()
  })

  it("only autoscrolls to the same active citation once", async () => {
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "The target citation paragraph explains the selected evidence.",
        markdown: "The target citation paragraph explains the selected evidence.",
      },
    ]
    const chunks: ParsedChunk[] = [
      {
        chunkId: "chunk-1",
        pageIndex: 0,
        text: "target citation paragraph",
        markdown: "target citation paragraph",
        rects: [],
      },
    ]

    function Reader({ pageMarkdown }: { pageMarkdown: string }) {
      return (
        <ConvertedTextReader
          pages={[{ ...pages[0], markdown: pageMarkdown }]}
          chunksByPage={new Map([[0, chunks]])}
          activeChunkId="chunk-1"
          currentPage={1}
          totalPages={1}
          approximateSelection={false}
          highlights={[]}
          selectionText=""
          selectionRects={[]}
          selectionAnchor={null}
          quality={null}
          onExplain={vi.fn()}
          onPlainExplain={vi.fn()}
          onHighlight={vi.fn()}
          onTextSelection={vi.fn()}
          onClearSelection={vi.fn()}
          onCurrentPageChange={vi.fn()}
        />
      )
    }

    const client = await renderClient(<Reader pageMarkdown={pages[0].markdown} />)
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    const scroller = client.container.firstElementChild as HTMLElement
    const scrollTo = vi.mocked(scroller.scrollTo)
    const initialScrollCalls = scrollTo.mock.calls.length
    expect(initialScrollCalls).toBeGreaterThanOrEqual(1)

    await client.rerender(
      <Reader pageMarkdown={`${pages[0].markdown}\n\nA later measurement update.`} />,
    )
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    expect(scrollTo).toHaveBeenCalledTimes(initialScrollCalls)
    client.unmount()
  })

  it("positions Spark margin dots from the rendered text selection mark", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = []
    class ResizeObserverStub {
      private callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        resizeCallbacks.push(callback)
      }

      observe() {}

      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    const page: ParsedPage = {
      pageIndex: 0,
      text: "alpha selected phrase omega with much more trailing text",
      markdown: "![figure](asset://figure.png)\n\nalpha selected phrase omega with much more trailing text",
    }
    const item: SavedInterpretation = {
      id: "spark-1",
      bookId: "book-1",
      selectionText: "selected phrase",
      sessionId: "spark-1",
      turnIndex: 0,
      pageIndex: 0,
      positionStart: 6,
      positionEnd: 21,
      pageIndexes: [0],
      evidenceChunkIds: [],
      answer: "",
      kind: "note",
      createdAt: "2026-06-01T00:00:00Z",
    }

    const client = await renderClient(
      <ConvertedTextReader
        {...readerProps({
          pages: [page],
          totalPages: 1,
          sparkItems: [item],
          selectionText: item.selectionText,
          selectionAnchor: { pageIndex: 0, positionStart: 6, positionEnd: 21 },
        })}
      />,
    )

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    const article = client.container.querySelector<HTMLElement>("[data-readable-page]")!
    const currentSelection = client.container.querySelector<HTMLElement>(
      "[data-current-selection='true']",
    )!
    article.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 100,
      right: 700,
      bottom: 1100,
      width: 700,
      height: 1000,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    }))
    currentSelection.getBoundingClientRect = vi.fn(() => ({
      left: 120,
      top: 590,
      right: 240,
      bottom: 610,
      width: 120,
      height: 20,
      x: 120,
      y: 590,
      toJSON: () => ({}),
    }))
    const margin = client.container.querySelector<HTMLElement>("[data-spark-margin-dots]")
    if (margin) {
      margin.getBoundingClientRect = vi.fn(() => ({
        left: 700,
        top: 200,
        right: 720,
        bottom: 1000,
        width: 20,
        height: 800,
        x: 700,
        y: 200,
        toJSON: () => ({}),
      }))
    }

    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver)
      }
      await Promise.resolve()
    })

    const dot = client.container.querySelector<HTMLButtonElement>("button[aria-label='打开 Note']")!
    expect(dot.style.top).toBe("50%")
    client.unmount()
    vi.unstubAllGlobals()
  })
})
