import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedPage, SavedInterpretation } from "@/stores/reader-store"
import type { TranslationStatus } from "@/core/library-api"
import { TranslationReader } from "./TranslationReader"
import { translationPageClassName } from "./translation-page-class"

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

describe("TranslationReader", () => {
  it("only applies document edge padding to true first and last pages", () => {
    const firstPage = translationPageClassName(0, 4)
    const middlePage = translationPageClassName(1, 4)
    const lastPage = translationPageClassName(3, 4)

    expect(firstPage).toContain("pt-4")
    expect(firstPage).not.toContain("pb-4")
    expect(middlePage).not.toContain("pt-4")
    expect(middlePage).not.toContain("pb-4")
    expect(lastPage).not.toContain("pt-4")
    expect(lastPage).toContain("pb-4")
  })

  it("does not treat the first rendered virtual item as the document first page", () => {
    expect(translationPageClassName(8, 40)).not.toContain("pt-4")
  })

  it("positions Spark margin dots from the rendered source text mark", async () => {
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
      text: "alpha selected phrase omega",
      markdown: "alpha selected phrase omega",
    }
    const translation: TranslationStatus = {
      bookId: "book-1",
      totalPages: 1,
      completedPages: 1,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          status: "done",
          sourceMarkdown: page.markdown,
          translatedMarkdown: "阿尔法 selected phrase 欧米伽",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    const item: SavedInterpretation = {
      id: "spark-translation-1",
      bookId: "book-1",
      selectionText: "selected phrase",
      sessionId: "spark-translation-1",
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
      <TranslationReader
        pages={[page]}
        currentPage={1}
        totalPages={1}
        translation={translation}
        busy={false}
        message=""
        selectionText={item.selectionText}
        selectionRects={[]}
        selectionAnchor={{ pageIndex: 0, positionStart: 6, positionEnd: 21 }}
        sparkItems={[item]}
        askOpen={false}
        question=""
        onCurrentPageChange={vi.fn()}
        onStart={vi.fn()}
        onRetranslate={vi.fn()}
        onRetryFailed={vi.fn()}
        onCancel={vi.fn()}
        onCopySelection={vi.fn()}
        onExplain={vi.fn()}
        onPlainExplain={vi.fn()}
        onAskToggle={vi.fn()}
        onQuestionChange={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onHighlight={vi.fn()}
        onTextSelection={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    const article = client.container.querySelector<HTMLElement>("[data-translation-page]")!
    const currentSelection = client.container.querySelector<HTMLElement>(
      "[data-current-selection='true']",
    )!
    article.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 100,
      right: 900,
      bottom: 1100,
      width: 900,
      height: 1000,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    }))
    currentSelection.getBoundingClientRect = vi.fn(() => ({
      left: 160,
      top: 590,
      right: 260,
      bottom: 610,
      width: 100,
      height: 20,
      x: 160,
      y: 590,
      toJSON: () => ({}),
    }))
    const margin = client.container.querySelector<HTMLElement>("[data-spark-margin-dots]")
    if (margin) {
      margin.getBoundingClientRect = vi.fn(() => ({
        left: 900,
        top: 200,
        right: 920,
        bottom: 1000,
        width: 20,
        height: 800,
        x: 900,
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
