import { describe, expect, it } from "vitest"
import {
  textSelectionAnchorFromDom,
  textSelectionAnchorFromOffsets,
} from "./text-selection-anchor"

describe("text selection anchors", () => {
  it("anchors the repeated selected text at the actual raw offset", () => {
    expect(
      textSelectionAnchorFromOffsets("重复。中间内容。重复。", "重复", 0, 8, 10),
    ).toEqual({
      pageIndex: 0,
      positionStart: 8,
      positionEnd: 10,
    })
  })

  it("rejects stale raw offsets that do not match the selected text", () => {
    expect(
      textSelectionAnchorFromOffsets("重复。中间内容。重复。", "重复", 0, 4, 6),
    ).toBeNull()
  })

  it("uses the DOM occurrence ordinal to anchor repeated text layer selections", () => {
    const textElement = document.createElement("div")
    textElement.append("重复。中间内容。")
    const second = document.createElement("span")
    second.textContent = "重复"
    textElement.append(second, "。")
    document.body.append(textElement)

    const range = document.createRange()
    range.selectNodeContents(second)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(
      selection
        ? textSelectionAnchorFromDom(selection, "重复。中间内容。重复。", 0, textElement)
        : null,
    ).toEqual({
      pageIndex: 0,
      positionStart: 8,
      positionEnd: 10,
    })

    selection?.removeAllRanges()
    textElement.remove()
  })

  it("maps text layer occurrence ordinal onto converted text with different whitespace", () => {
    const textElement = document.createElement("div")
    textElement.append("重复。中间")
    const second = document.createElement("span")
    second.textContent = "重复"
    textElement.append(second, "。")
    document.body.append(textElement)

    const range = document.createRange()
    range.selectNodeContents(second)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(
      selection
        ? textSelectionAnchorFromDom(selection, "重复。\n中间\n重复。", 2, textElement)
        : null,
    ).toEqual({
      pageIndex: 2,
      positionStart: 7,
      positionEnd: 9,
    })

    selection?.removeAllRanges()
    textElement.remove()
  })
})
