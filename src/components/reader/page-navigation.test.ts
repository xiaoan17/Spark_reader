import { act, createElement, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import {
  clampPage,
  useReaderPageNavigation,
  type ReaderPageNavigation,
} from "./page-navigation"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

async function renderNavigationHook(props: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onInvalidPage?: () => void
}) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const state: { current: ReaderPageNavigation | null } = { current: null }

  function Probe(nextProps: typeof props) {
    state.current = useReaderPageNavigation(nextProps)
    return null
  }

  async function render(nextProps: typeof props) {
    await act(async () => {
      root.render(createElement(Probe, nextProps))
      await Promise.resolve()
    })
  }

  await render(props)
  return {
    get current() {
      if (!state.current) {
        throw new Error("navigation hook did not render")
      }
      return state.current
    },
    render,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe("reader page navigation", () => {
  it("clamps pages and derives progress", async () => {
    expect(clampPage(Number.NaN, 10)).toBe(1)
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(11, 10)).toBe(10)
    expect(clampPage(4.8, 10)).toBe(4)

    const onPageChange = vi.fn()
    const hook = await renderNavigationHook({
      currentPage: 3,
      totalPages: 10,
      onPageChange,
    })

    expect(hook.current.safePage).toBe(3)
    expect(hook.current.progress).toBe(30)
    expect(hook.current.pageJumpValue).toBe("3")

    await hook.render({ currentPage: 12, totalPages: 10, onPageChange })
    expect(hook.current.safePage).toBe(10)
    expect(hook.current.pageJumpValue).toBe("10")
    hook.unmount()
  })

  it("submits valid pages and reports invalid input", async () => {
    const onPageChange = vi.fn()
    const onInvalidPage = vi.fn()
    const hook = await renderNavigationHook({
      currentPage: 2,
      totalPages: 5,
      onPageChange,
      onInvalidPage,
    })

    act(() => hook.current.goToNextPage())
    expect(onPageChange).toHaveBeenLastCalledWith(3)

    act(() => hook.current.goToPage(99))
    expect(onPageChange).toHaveBeenLastCalledWith(5)

    act(() => hook.current.setPageJumpValue("abc"))
    act(() =>
      hook.current.handlePageJumpSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>),
    )
    expect(onInvalidPage).toHaveBeenCalledTimes(1)
    hook.unmount()
  })
})
