import { describe, expect, it } from "vitest"
import {
  makeTextQuoteSelector,
  normalizeWhitespace,
  resolveTextQuoteSelector,
} from "./text-quote-selector"

describe("text quote selectors", () => {
  it("stores exact text with surrounding context and position hints", () => {
    const pageText = "第一句作为铺垫。复利来自时间和耐心。最后一句收束。"
    const selector = makeTextQuoteSelector(pageText, "复利来自时间和耐心")

    expect(selector.exact).toBe("复利来自时间和耐心")
    expect(selector.prefix).toBe("第一句作为铺垫。")
    expect(selector.suffix).toBe("。最后一句收束。")
    expect(selector.positionStart).toBe(8)
    expect(selector.positionEnd).toBe(17)
  })

  it("normalizes whitespace before matching", () => {
    expect(normalizeWhitespace("复利\n  来自\t时间")).toBe("复利 来自 时间")
    const selector = makeTextQuoteSelector("复利 来自 时间 和耐心", "复利\n来自 时间")
    expect(selector.positionStart).toBe(0)
    expect(selector.positionEnd).toBe(8)
  })

  it("keeps exact text even when the page cannot be matched", () => {
    const selector = makeTextQuoteSelector("另一页内容", "复利来自时间")
    expect(selector.exact).toBe("复利来自时间")
    expect(selector.prefix).toBe("")
    expect(selector.positionStart).toBeNull()
    expect(selector.positionEnd).toBeNull()
  })

  it("uses a verified preferred position for repeated text", () => {
    const selector = makeTextQuoteSelector("重复。中间内容。重复。", "重复", 8)

    expect(selector.positionStart).toBe(8)
    expect(selector.positionEnd).toBe(10)
    expect(selector.prefix).toBe("重复。中间内容。")
    expect(selector.suffix).toBe("。")
  })

  it("falls back to the first match when the preferred position is stale", () => {
    const selector = makeTextQuoteSelector("重复。中间内容。重复。", "重复", 4)

    expect(selector.positionStart).toBe(0)
    expect(selector.positionEnd).toBe(2)
  })

  it("resolves text quote selectors from verified position hints", () => {
    expect(
      resolveTextQuoteSelector("第一句。目标文本。最后一句。", {
        exact: "目标文本",
        prefix: "第一句。",
        suffix: "。最后一句。",
        positionStart: 4,
        positionEnd: 8,
      }),
    ).toEqual({
      positionStart: 4,
      positionEnd: 8,
      strategy: "position",
    })
  })

  it("lets quote context override a still-matching stale position hint", () => {
    expect(
      resolveTextQuoteSelector("前缀。重复。中间改写。重复。后文。", {
        exact: "重复",
        prefix: "中间改写。",
        suffix: "。后文。",
        positionStart: 3,
        positionEnd: 5,
      }),
    ).toEqual({
      positionStart: 11,
      positionEnd: 13,
      strategy: "quote-context",
    })
  })

  it("uses quote context when repeated text makes the old position stale", () => {
    expect(
      resolveTextQuoteSelector("前缀。重复。中间改写。重复。后文。", {
        exact: "重复",
        prefix: "中间内容。",
        suffix: "。后文。",
        positionStart: 0,
        positionEnd: 2,
      }),
    ).toEqual({
      positionStart: 11,
      positionEnd: 13,
      strategy: "quote-context",
    })
  })

  it("falls back to exact matching when context is unavailable", () => {
    expect(
      resolveTextQuoteSelector("前文。目标。后文。", {
        exact: "目标",
        prefix: "",
        suffix: "",
        positionStart: null,
        positionEnd: null,
      }),
    ).toEqual({
      positionStart: 3,
      positionEnd: 5,
      strategy: "exact",
    })
  })
})
