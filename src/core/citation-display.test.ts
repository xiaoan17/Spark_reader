import { describe, expect, it } from "vitest"
import {
  chunkIdEvidenceLabel,
  chunkIdsInCitation,
  knowledgeEvidenceLabel,
  replaceInternalCitationsWithReadableLabels,
  retrievalEvidenceLabel,
  summarizeQuote,
} from "./citation-display"

const chunkA = "b12345678-p1-c1-abcdef12"
const chunkB = "b12345678-p2-c3-0000abcd"

describe("citation display parsing", () => {
  it("accepts only namespaced chunk ids while ignoring ordinary labels", () => {
    expect(chunkIdsInCitation(`${chunkA}, p1-c1, chunk-02, mineru_block_12, chap03_pg5, 说明`)).toEqual([
      chunkA,
    ])
  })

  it("replaces bracketed citation ids but leaves ordinary brackets", () => {
    const text = `普通说明 [不是引用] 保留，证据见 [${chunkA}; ${chunkB}]，旧证据 [p1-c1] 不处理。`

    expect(replaceInternalCitationsWithReadableLabels(text)).toBe(
      "普通说明 [不是引用] 保留，证据见 （引用）（引用），旧证据 [p1-c1] 不处理。",
    )
  })
})

describe("knowledge evidence label", () => {
  it("builds a human page + snippet label, never exposing the chunk id", () => {
    const label = knowledgeEvidenceLabel({
      pageIndex: 2,
      quote: "复利来自时间、纪律和风险控制。",
    })
    expect(label).toBe("第 3 页 · 复利来自时间、纪律和风险控制…")
    expect(label).not.toContain(chunkA)
  })

  it("falls back to 未知页 / 原文片段 when page or quote is missing", () => {
    expect(knowledgeEvidenceLabel({ pageIndex: null, quote: "" })).toBe("未知页 · 原文片段")
    expect(knowledgeEvidenceLabel({ pageIndex: 0 })).toBe("第 1 页 · 原文片段")
  })

  it("summarizes quotes to a compact single line", () => {
    expect(summarizeQuote("  多  空白\n换行  ", 20)).toBe("多 空白 换行")
    expect(summarizeQuote("一二三四五六七八九十", 4)).toBe("一二三四…")
    expect(summarizeQuote("")).toBe("")
  })

  it("derives a page label from a bare chunk id without exposing it", () => {
    expect(chunkIdEvidenceLabel(chunkA)).toBe("第 1 页 · 原文证据")
    expect(chunkIdEvidenceLabel("bookdense-p43-c1-00")).toBe("第 43 页 · 原文证据")
    expect(chunkIdEvidenceLabel("no-page-here")).toBe("原文证据")
  })
})

describe("retrieval evidence label", () => {
  it("prefers a meaningful title, differentiating chips", () => {
    expect(retrievalEvidenceLabel({ title: "第一章 · 复利", pageIndex: 7 })).toBe("第一章 · 复利")
    expect(retrievalEvidenceLabel({ title: "当前选区", pageIndex: 0 })).toBe("当前选区")
  })

  it("falls back to page then ordinal when no title is available", () => {
    expect(retrievalEvidenceLabel({ title: "", pageIndex: 4 })).toBe("第 5 页")
    expect(retrievalEvidenceLabel({ title: null, pageIndex: null }, 2)).toBe("第 3 段")
  })

  it("never leaks a raw chunk id even if it leaks into the title field", () => {
    expect(retrievalEvidenceLabel({ title: `Chunk ${chunkA}`, pageIndex: 2 })).toBe("第 3 页")
    expect(retrievalEvidenceLabel({ title: chunkA, pageIndex: 2 })).toBe("第 3 页")
  })
})
