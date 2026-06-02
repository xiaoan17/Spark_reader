import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { ReaderView } from "./highlight-target-view"
import { useReaderViewMemory } from "./reader-view-memory"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

type HarnessState = {
  switchReaderView: ReturnType<typeof useReaderViewMemory>["switchReaderView"] | null
}

async function renderViewMemoryHarness({
  readerView,
  currentPage,
  totalPages,
  onPageChange,
}: {
  readerView: ReaderView
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const state: HarnessState = { switchReaderView: null }
  const setReaderView = vi.fn()

  function Probe(props: {
    readerView: ReaderView
    currentPage: number
    totalPages: number
  }) {
    const memory = useReaderViewMemory({
      ...props,
      setReaderView,
      onPageChange,
    })
    state.switchReaderView = memory.switchReaderView
    return null
  }

  async function render(nextProps: {
    readerView: ReaderView
    currentPage: number
    totalPages: number
  }) {
    await act(async () => {
      root.render(createElement(Probe, nextProps))
      await Promise.resolve()
    })
  }

  await render({ readerView, currentPage, totalPages })
  return {
    state,
    setReaderView,
    render,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe("reader view memory", () => {
  it("restores the last page for each view when switching manually", async () => {
    const onPageChange = vi.fn()
    const harness = await renderViewMemoryHarness({
      readerView: "text",
      currentPage: 8,
      totalPages: 20,
      onPageChange,
    })

    act(() => harness.state.switchReaderView?.("pdf"))
    expect(harness.setReaderView).toHaveBeenLastCalledWith("pdf")
    expect(onPageChange).toHaveBeenLastCalledWith(1)

    await harness.render({ readerView: "pdf", currentPage: 3, totalPages: 20 })
    act(() => harness.state.switchReaderView?.("text"))
    expect(harness.setReaderView).toHaveBeenLastCalledWith("text")
    expect(onPageChange).toHaveBeenLastCalledWith(8)

    await harness.render({ readerView: "text", currentPage: 8, totalPages: 20 })
    act(() => harness.state.switchReaderView?.("pdf"))
    expect(onPageChange).toHaveBeenLastCalledWith(3)
    harness.unmount()
  })

  it("honors explicit target pages for citation and search jumps", async () => {
    const onPageChange = vi.fn()
    const harness = await renderViewMemoryHarness({
      readerView: "pdf",
      currentPage: 9,
      totalPages: 20,
      onPageChange,
    })

    act(() => harness.state.switchReaderView?.("text", { page: 12 }))

    expect(harness.setReaderView).toHaveBeenLastCalledWith("text")
    expect(onPageChange).toHaveBeenLastCalledWith(12)
    harness.unmount()
  })
})
