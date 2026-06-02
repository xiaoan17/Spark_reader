import { describe, expect, it } from "vitest"
import {
  makeLocalEvidence,
  makeLocalFollowUpAnswer,
  makeLocalInterpretation,
} from "./local-interpreter"

const pages = [
  {
    pageIndex: 0,
    text: "复利来自长期坚持，时间会放大微小差异。",
    markdown: "## Page 1\n\n复利来自长期坚持，时间会放大微小差异。",
  },
]

const chunks = [
  {
    chunkId: "p1-c1",
    pageIndex: 0,
    text: "复利来自长期坚持。",
    markdown: "",
    rects: [],
  },
  {
    chunkId: "p1-c2",
    pageIndex: 0,
    text: "时间会放大微小差异。",
    markdown: "",
    rects: [],
  },
]

describe("local interpreter citations", () => {
  it("uses real chunk ids in fallback evidence and interpretation text", () => {
    const evidence = makeLocalEvidence([], pages, chunks, [0])
    const answer = makeLocalInterpretation(
      "复利来自长期坚持",
      [],
      pages,
      chunks,
      false,
      0,
    )

    expect(evidence.map((item) => item.chunkId)).toEqual(["p1-c1", "p1-c2"])
    expect(answer).toContain("[p1-c1]")
    expect(answer).not.toContain("[local-p1-1]")
  })

  it("keeps follow-up citations aligned with clickable chunk evidence", () => {
    const answer = makeLocalFollowUpAnswer(
      "为什么强调长期？",
      "复利来自长期坚持",
      pages,
      [],
      chunks,
      false,
      0,
    )

    expect(answer).toContain("[p1-c1]")
    expect(answer).toContain("浏览器内存文本检索")
    expect(answer).not.toContain("[local-p1-1]")
    expect(answer).not.toContain("后端")
  })

  it("describes indexed follow-up fallback in product language", () => {
    const answer = makeLocalFollowUpAnswer(
      "为什么强调长期？",
      "复利来自长期坚持",
      pages,
      [],
      chunks,
      true,
      0,
    )

    expect(answer).toContain("桌面书库索引")
    expect(answer).not.toContain("后端")
  })

  it("falls back to local page citation only when no chunk exists", () => {
    const answer = makeLocalInterpretation("复利", [], pages, [], false, 0)

    expect(answer).toContain("[local-p1-1]")
  })

  it("uses the focused chunk order supplied by the caller for fallback citations", () => {
    const reorderedChunks = [chunks[1], chunks[0]]
    const answer = makeLocalInterpretation(
      "时间会放大微小差异",
      [],
      pages,
      reorderedChunks,
      false,
      0,
    )
    const followUp = makeLocalFollowUpAnswer(
      "这句话为什么重要？",
      "时间会放大微小差异",
      pages,
      [],
      reorderedChunks,
      false,
      0,
    )

    expect(answer).toContain("[p1-c2]")
    expect(answer.indexOf("[p1-c2]")).toBeLessThan(answer.indexOf("[p1-c1]"))
    expect(followUp).toContain("[p1-c2]")
    expect(followUp).not.toContain("可检索 chunk 示例 [p1-c1]")
  })

  it("looks up page text by explicit page index instead of page array position", () => {
    const outOfOrderPages = [
      { pageIndex: 4, text: "第五页上下文", markdown: "" },
      { pageIndex: 9, text: "第十页上下文", markdown: "" },
    ]
    const answer = makeLocalInterpretation(
      "第十页",
      [],
      outOfOrderPages,
      [],
      false,
      9,
    )

    expect(answer).toContain("第十页上下文")
    expect(answer).not.toContain("第五页上下文")
  })
})
