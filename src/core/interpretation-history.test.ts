import { describe, expect, it } from "vitest"
import {
  restoreTargetForSavedInterpretation,
  summarizeInterpretationSessions,
} from "./interpretation-history"
import type { SavedInterpretation } from "@/stores/reader-store"

describe("restoreTargetForSavedInterpretation", () => {
  it("uses the first evidence chunk as the navigation and active focus target", () => {
    const restored = restoreTargetForSavedInterpretation(
      savedInterpretation({
        selectionText: "复利来自长期坚持",
        pageIndexes: [0],
        evidenceChunkIds: ["p3-c2", "p1-c1"],
        answer: "需要回到第三页证据。[p3-c2]",
      }),
      [
        { chunkId: "p1-c1", pageIndex: 0, text: "第一页证据", markdown: "", rects: [] },
        {
          chunkId: "p3-c2",
          pageIndex: 2,
          text: "第三页证据",
          markdown: "",
          rects: [{ pageIndex: 2, x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 }],
        },
      ],
      [{ pageIndex: 0, text: "第一页没有选中文本", markdown: "" }],
    )

    expect(restored.pageNumber).toBe(3)
    expect(restored.activeChunkId).toBe("p3-c2")
    expect(restored.selectionRects).toEqual([{ pageIndex: 2, x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 }])
    expect(restored.evidence.map((item) => item.chunkId)).toEqual(["p3-c2", "p1-c1"])
    expect(restored.interpretation).toBe("需要回到第三页证据。[p3-c2]")
    expect(restored.followUps).toEqual([])
  })

  it("restores a text anchor when the saved selection still exists on the original page", () => {
    const restored = restoreTargetForSavedInterpretation(
      savedInterpretation({
        selectionText: "复利来自长期坚持",
        pageIndexes: [4],
        evidenceChunkIds: ["p5-c1"],
        answer: "文本锚点应优先恢复。[p5-c1]",
      }),
      [
        {
          chunkId: "p5-c1",
          pageIndex: 4,
          text: "长期上下文",
          markdown: "",
          rects: [{ pageIndex: 4, x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.4 }],
        },
      ],
      [{ pageIndex: 4, text: "前文。复利来自长期坚持。后文。", markdown: "" }],
    )

    expect(restored.pageNumber).toBe(5)
    expect(restored.selectionRects).toEqual([])
    expect(restored.selectionAnchor).toEqual({
      pageIndex: 4,
      positionStart: 3,
      positionEnd: 11,
    })
  })

  it("uses persisted quote context to disambiguate repeated saved selections", () => {
    const restored = restoreTargetForSavedInterpretation(
      savedInterpretation({
        selectionText: "重复",
        prefix: "中间内容。",
        suffix: "。后文。",
        pageIndex: 0,
        positionStart: 0,
        positionEnd: 2,
        pageIndexes: [0],
        evidenceChunkIds: [],
        answer: "应该恢复到第二个重复。",
      }),
      [],
      [{ pageIndex: 0, text: "前缀。重复。中间内容。重复。后文。", markdown: "" }],
    )

    expect(restored.selectionAnchor).toEqual({
      pageIndex: 0,
      positionStart: 11,
      positionEnd: 13,
    })
  })

  it("keeps a saved follow-up as a follow-up turn", () => {
    const restored = restoreTargetForSavedInterpretation(
      savedInterpretation({
        selectionText: "复利来自长期坚持",
        pageIndexes: [0],
        evidenceChunkIds: ["p1-c1"],
        question: "为什么这里强调长期？",
        answer: "因为证据强调时间尺度。[p1-c1]",
      }),
      [{ chunkId: "p1-c1", pageIndex: 0, text: "复利来自长期坚持。", markdown: "", rects: [] }],
      [{ pageIndex: 0, text: "复利来自长期坚持。", markdown: "" }],
    )

    expect(restored.interpretation).toBe("")
    expect(restored.followUps).toEqual([
      {
        id: "saved-1",
        question: "为什么这里强调长期？",
        answer: "因为证据强调时间尺度。[p1-c1]",
      },
    ])
  })

  it("restores a full interpretation session with follow-up turns", () => {
    const session = [
      savedInterpretation({
        id: "turn-0",
        sessionId: "session-1",
        turnIndex: 0,
        selectionText: "复利来自长期坚持",
        pageIndexes: [0],
        evidenceChunkIds: ["p1-c1"],
        question: null,
        answer: "初始解读。[p1-c1]",
      }),
      savedInterpretation({
        id: "turn-1",
        sessionId: "session-1",
        turnIndex: 1,
        selectionText: "复利来自长期坚持",
        pageIndexes: [0],
        evidenceChunkIds: ["p1-c1"],
        question: "为什么强调长期？",
        answer: "因为时间拉长收益差异。[p1-c1]",
      }),
      savedInterpretation({
        id: "turn-2",
        sessionId: "session-1",
        turnIndex: 2,
        selectionText: "复利来自长期坚持",
        pageIndexes: [0],
        evidenceChunkIds: ["p1-c1"],
        question: "和耐心有什么关系？",
        answer: "耐心是等待复利兑现的条件。[p1-c1]",
      }),
    ]

    const restored = restoreTargetForSavedInterpretation(
      session[0],
      [{ chunkId: "p1-c1", pageIndex: 0, text: "复利来自长期坚持。", markdown: "", rects: [] }],
      [{ pageIndex: 0, text: "复利来自长期坚持。", markdown: "" }],
      session,
    )

    expect(restored.interpretation).toBe("初始解读。[p1-c1]")
    expect(restored.followUps).toEqual([
      {
        id: "turn-1",
        question: "为什么强调长期？",
        answer: "因为时间拉长收益差异。[p1-c1]",
      },
      {
        id: "turn-2",
        question: "和耐心有什么关系？",
        answer: "耐心是等待复利兑现的条件。[p1-c1]",
      },
    ])
  })

  it("summarizes multiple turns as one history entry per session", () => {
    const rows = [
      savedInterpretation({
        id: "turn-1",
        sessionId: "session-1",
        turnIndex: 1,
        question: "追问",
        answer: "回答",
        createdAt: "2026-06-01T00:02:00Z",
      }),
      savedInterpretation({
        id: "turn-0",
        sessionId: "session-1",
        turnIndex: 0,
        answer: "初始",
        createdAt: "2026-06-01T00:01:00Z",
      }),
      savedInterpretation({
        id: "other",
        sessionId: "session-2",
        turnIndex: 0,
        answer: "另一个",
        createdAt: "2026-06-01T00:00:00Z",
      }),
    ]

    expect(summarizeInterpretationSessions(rows).map((item) => item.id)).toEqual(["turn-0", "other"])
    expect(summarizeInterpretationSessions(rows)[0]).toMatchObject({
      id: "turn-0",
      turnCount: 2,
      followUpCount: 1,
      lastQuestion: "追问",
      lastAnswer: "回答",
      lastCreatedAt: "2026-06-01T00:02:00Z",
    })
  })
})

function savedInterpretation(
  overrides: Partial<SavedInterpretation>,
): SavedInterpretation {
  return {
    id: "saved-1",
    bookId: "book-1",
    selectionText: "复利来自长期坚持",
    sessionId: "saved-1",
    turnIndex: 0,
    pageIndexes: [],
    evidenceChunkIds: [],
    question: null,
    answer: "",
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  }
}
