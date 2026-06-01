import { beforeEach, describe, expect, it } from "vitest"
import { useReaderStore } from "./reader-store"

describe("reader store navigation state", () => {
  beforeEach(() => {
    useReaderStore.setState({
      currentPage: 1,
      selectionText: "",
      selectionRects: [],
      selectionAnchor: null,
      evidence: [],
      agentTrace: [],
      interpretation: "",
      interpretationError: "",
      followUps: [],
      interpretationSessionId: "",
      activeChunkId: "",
      phase: "reading",
    })
  })

  it("can move citation focus to an evidence-only page without clearing interpretation context", () => {
    useReaderStore.setState({
      selectionText: "复利",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 2 },
      evidence: [{ chunkId: "missing-local-chunk", title: "Chunk missing-local-chunk", pageIndex: 8 }],
      interpretation: "已有解读。[missing-local-chunk]",
      followUps: [{ id: "turn-1", question: "为什么？", answer: "因为上下文如此。" }],
      interpretationSessionId: "session-1",
    })

    useReaderStore.getState().setVisiblePage(9)
    useReaderStore.getState().setActiveChunk("missing-local-chunk")

    expect(useReaderStore.getState()).toMatchObject({
      currentPage: 9,
      activeChunkId: "missing-local-chunk",
      selectionText: "复利",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 2 },
      interpretation: "已有解读。[missing-local-chunk]",
      interpretationSessionId: "session-1",
    })
    expect(useReaderStore.getState().followUps).toHaveLength(1)
  })

  it("keeps the original focus selection when a citation jumps to a different chunk", () => {
    useReaderStore.setState({
      currentPage: 1,
      selectionText: "复利来自长期坚持",
      selectionRects: [],
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 8 },
      evidence: [{ chunkId: "p2-c1", title: "Chunk p2-c1", pageIndex: 1 }],
      interpretation: "原始解读仍应围绕用户框选段落。[p2-c1]",
      followUps: [],
      interpretationSessionId: "session-1",
      activeChunkId: "",
    })

    useReaderStore
      .getState()
      .focusChunk(2, "p2-c1", "风险控制让长期计划不被短期波动打断。", [], true)

    expect(useReaderStore.getState()).toMatchObject({
      currentPage: 2,
      activeChunkId: "p2-c1",
      selectionText: "复利来自长期坚持",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 8 },
      interpretation: "原始解读仍应围绕用户框选段落。[p2-c1]",
      interpretationSessionId: "session-1",
    })
  })

  it("clears stale interpretation errors when a new answer or selection arrives", () => {
    useReaderStore.getState().setInterpretationError("DeepSeek API key 未配置")
    expect(useReaderStore.getState().interpretationError).toBe("DeepSeek API key 未配置")

    useReaderStore.getState().setInterpretation("新的解读")
    expect(useReaderStore.getState().interpretationError).toBe("")

    useReaderStore.getState().setInterpretationError("网络错误")
    useReaderStore.getState().setSelection("新选区", [], { pageIndex: 0, positionStart: 0, positionEnd: 3 })
    expect(useReaderStore.getState()).toMatchObject({
      selectionText: "新选区",
      interpretationError: "",
    })
  })
})
