import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PdfDocumentViewer } from "./PdfCanvasPage"
import type { PDFDocumentProxy } from "@/pdf/pdfjs-compat"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/pdf/pdfjs-compat", () => ({
  TextLayer: class {
    render = vi.fn(async () => undefined)
    cancel = vi.fn()
  },
}))

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

function makePdf() {
  return {
    getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: vi.fn(async () => ({ items: [], styles: Object.create(null) })),
    })),
  } as unknown as PDFDocumentProxy
}

describe("PdfDocumentViewer", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
  })

  it("clears the transient PDF selection when the user clicks blank page space", async () => {
    const onClearSelection = vi.fn()
    const { container, unmount } = await renderClient(
      <PdfDocumentViewer
        pdf={makePdf()}
        currentPage={1}
        totalPages={1}
        zoom={1}
        pageTextForPage={() => "page text"}
        selectionRects={[{ pageIndex: 0, x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }]}
        onSelection={vi.fn()}
        onClearSelection={onClearSelection}
        onCurrentPageChange={vi.fn()}
        onExplain={vi.fn()}
        onPlainExplain={vi.fn()}
        askOpen={false}
        question=""
        onAskToggle={vi.fn()}
        onQuestionChange={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onHighlight={vi.fn()}
        onCopy={vi.fn()}
        onRenderError={vi.fn()}
      />,
    )

    const page = container.querySelector("[data-pdf-page]")
    expect(page).not.toBeNull()
    expect(container.querySelector("[data-testid='selection-toolbar']")).not.toBeNull()

    await act(async () => {
      page?.dispatchEvent(new Event("pointerup", { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(onClearSelection).toHaveBeenCalledTimes(1)
    unmount()
  })
})
