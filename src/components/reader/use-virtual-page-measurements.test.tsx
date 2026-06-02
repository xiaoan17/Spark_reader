import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { useVirtualPageMeasurements } from "./use-virtual-page-measurements"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

async function renderClient(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
  return {
    container,
    rerender: (nextElement: React.ReactElement) => {
      act(() => root.render(nextElement))
    },
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe("useVirtualPageMeasurements", () => {
  it("defers ref measurement state updates outside the ref commit", async () => {
    const heightSnapshots: number[] = []

    function Harness() {
      const { measuredPageHeights, getPageMeasurementRef } = useVirtualPageMeasurements()
      useEffect(() => {
        heightSnapshots.push(measuredPageHeights.get(0) ?? 0)
      }, [measuredPageHeights])
      return <div ref={getPageMeasurementRef(0)}>Measured page</div>
    }

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 600,
      height: 321,
      left: 0,
      top: 0,
      right: 600,
      bottom: 321,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

    const client = await renderClient(<Harness />)

    expect(heightSnapshots).toEqual([0])

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    expect(heightSnapshots).toEqual([0, 321])
    client.unmount()
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })

  it("can refresh mounted measurements without dropping offscreen measured heights", async () => {
    const heightSnapshots: Array<Array<[number, number]>> = []
    const resetCalls: Array<() => void> = []

    function Harness({ showSecond }: { showSecond: boolean }) {
      const {
        measuredPageHeights,
        getPageMeasurementRef,
        resetMeasuredPageHeights,
      } = useVirtualPageMeasurements()
      useEffect(() => {
        heightSnapshots.push([...measuredPageHeights.entries()])
      }, [measuredPageHeights])
      useEffect(() => {
        resetCalls[0] = () => resetMeasuredPageHeights({ preserveExisting: true })
      }, [resetMeasuredPageHeights])
      return (
        <>
          <div data-page="0" ref={getPageMeasurementRef(0)}>
            First measured page
          </div>
          {showSecond ? (
            <div data-page="1" ref={getPageMeasurementRef(1)}>
              Second measured page
            </div>
          ) : null}
        </>
      )
    }

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function measuredRect() {
      const page = this.getAttribute("data-page")
      return {
        width: 600,
        height: page === "1" ? 520 : 320,
        left: 0,
        top: 0,
        right: 600,
        bottom: page === "1" ? 520 : 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }

    const client = await renderClient(<Harness showSecond />)
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    expect(heightSnapshots.at(-1)).toEqual([
      [0, 320],
      [1, 520],
    ])

    await act(async () => {
      client.rerender(<Harness showSecond={false} />)
      await Promise.resolve()
    })

    act(() => {
      resetCalls[0]?.()
    })
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    expect(heightSnapshots.at(-1)).toEqual([
      [0, 320],
      [1, 520],
    ])
    client.unmount()
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })
})
