import { describe, expect, it, vi } from "vitest"
import {
  selectedTextFromRanges,
  selectionRangesWithin,
  selectionToolbarPositionFromRanges,
} from "./dom-selection"

describe("DOM selection helpers", () => {
  it("collects multiple selected ranges inside the same container", () => {
    const container = document.createElement("div")
    container.innerHTML = "<p>第一段核心概念。</p><p>第二段补充说明。</p>"
    document.body.append(container)
    const paragraphs = container.querySelectorAll("p")
    const firstRange = document.createRange()
    firstRange.selectNodeContents(paragraphs[0]!)
    const secondRange = document.createRange()
    secondRange.selectNodeContents(paragraphs[1]!)
    const selection = {
      rangeCount: 2,
      getRangeAt: (index: number) => (index === 0 ? firstRange : secondRange),
    } as Selection

    const ranges = selectionRangesWithin(selection, container)

    expect(ranges).toEqual([firstRange, secondRange])
    expect(selectedTextFromRanges(ranges)).toBe("第一段核心概念。\n\n第二段补充说明。")
    container.remove()
  })

  it("positions the toolbar against the union of selected range rects", () => {
    const article = document.createElement("article")
    article.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 100,
      right: 900,
      bottom: 900,
      width: 800,
      height: 800,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }))
    const firstRange = {
      getClientRects: () => [
        { left: 300, top: 260, right: 420, bottom: 285, width: 120, height: 25 },
      ],
      getBoundingClientRect: () => ({ left: 300, top: 260, right: 420, bottom: 285, width: 120, height: 25 }),
    } as unknown as Range
    const secondRange = {
      getClientRects: () => [
        { left: 500, top: 420, right: 650, bottom: 450, width: 150, height: 30 },
      ],
      getBoundingClientRect: () => ({ left: 500, top: 420, right: 650, bottom: 450, width: 150, height: 30 }),
    } as unknown as Range

    const position = selectionToolbarPositionFromRanges([firstRange, secondRange], article)

    expect(position).toEqual({ left: 115, top: 98 })
  })

  it("keeps the toolbar inside narrow selection containers", () => {
    const article = document.createElement("article")
    article.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      top: 20,
      right: 110,
      bottom: 220,
      width: 100,
      height: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }))
    const range = {
      getClientRects: () => [
        { left: 24, top: 34, right: 96, bottom: 54, width: 72, height: 20 },
      ],
      getBoundingClientRect: () => ({
        left: 24,
        top: 34,
        right: 96,
        bottom: 54,
        width: 72,
        height: 20,
      }),
    } as unknown as Range

    const position = selectionToolbarPositionFromRanges([range], article)

    expect(position).toEqual({ left: 16, top: 46 })
  })

  it("uses the measured toolbar size when centering and flipping below the selection", () => {
    const article = document.createElement("article")
    article.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 100,
      right: 700,
      bottom: 400,
      width: 600,
      height: 300,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }))
    const range = {
      getClientRects: () => [
        { left: 350, top: 112, right: 450, bottom: 132, width: 100, height: 20 },
      ],
      getBoundingClientRect: () => ({
        left: 350,
        top: 112,
        right: 450,
        bottom: 132,
        width: 100,
        height: 20,
      }),
    } as unknown as Range

    const position = selectionToolbarPositionFromRanges([range], article, {
      width: 240,
      height: 80,
    })

    expect(position).toEqual({ left: 180, top: 44 })
  })
})
