import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SelectionToolbarHost } from "./SelectionToolbarHost"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const defaultProps = {
  onComment: vi.fn(),
  onExplain: vi.fn(),
  onHighlight: vi.fn(),
  onPlainExplain: vi.fn(),
}

async function renderHost(present: boolean, extra: Partial<Parameters<typeof SelectionToolbarHost>[0]> = {}) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<SelectionToolbarHost present={present} {...defaultProps} {...extra} />)
    await Promise.resolve()
  })
  return {
    container,
    rerender: async (nextPresent: boolean) => {
      await act(async () => {
        root.render(<SelectionToolbarHost present={nextPresent} {...defaultProps} {...extra} />)
        await Promise.resolve()
      })
    },
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe("SelectionToolbarHost", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps the toolbar mounted briefly after present becomes false", async () => {
    const host = await renderHost(true)
    expect(host.container.querySelector("[data-testid='selection-toolbar']")).toBeTruthy()

    await host.rerender(false)

    expect(host.container.querySelector("[data-testid='selection-toolbar']")).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(79)
      await Promise.resolve()
    })

    expect(host.container.querySelector("[data-testid='selection-toolbar']")).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })

    expect(host.container.querySelector("[data-testid='selection-toolbar']")).toBeNull()
    host.unmount()
  })

  it("reports measured toolbar size when it is mounted", async () => {
    const onSizeChange = vi.fn()
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 241.2,
      height: 48.1,
      left: 0,
      top: 0,
      right: 241.2,
      bottom: 48.1,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

    const host = await renderHost(true, { onSizeChange })

    expect(onSizeChange).toHaveBeenCalledWith({ width: 242, height: 49 })
    host.unmount()
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })

  it("wires the comment action through the selection toolbar", async () => {
    const onComment = vi.fn()
    const host = await renderHost(true, { onComment })

    const button = [...host.container.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("批注"),
    )
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onComment).toHaveBeenCalledTimes(1)
    expect(defaultProps.onExplain).not.toHaveBeenCalled()
    host.unmount()
  })
})
