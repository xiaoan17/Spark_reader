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
      activeInterpretationSessionId: "",
      currentNoteDraft: "",
      currentNoteOpen: false,
      currentThreadError: "",
      currentThreadLightweight: false,
      currentThreadSelectionText: "",
      currentThreadSelectionRects: [],
      currentThreadSelectionAnchor: null,
      currentThreadPageIndex: null,
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
      activeInterpretationSessionId: "session-1",
    })

    useReaderStore.getState().setVisiblePage(9)
    useReaderStore.getState().setActiveChunk("missing-local-chunk")

    expect(useReaderStore.getState()).toMatchObject({
      currentPage: 9,
      activeChunkId: "missing-local-chunk",
      selectionText: "复利",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 2 },
      interpretation: "已有解读。[missing-local-chunk]",
      activeInterpretationSessionId: "session-1",
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
      activeInterpretationSessionId: "session-1",
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
      activeInterpretationSessionId: "session-1",
    })
  })

  it("clears stale interpretation errors when a new answer or selection arrives", () => {
    useReaderStore.getState().setInterpretationError("DeepSeek API key 未配置")
    expect(useReaderStore.getState().interpretationError).toBe("DeepSeek API key 未配置")

    useReaderStore.getState().setInterpretation("新的解读")
    expect(useReaderStore.getState().interpretationError).toBe("")

    useReaderStore.getState().setAnswerSource("local_fallback")
    useReaderStore.getState().setInterpretationError("已切换到本地兜底，请检查 API Key")
    useReaderStore.getState().setInterpretation("本地兜底解读")
    expect(useReaderStore.getState().interpretationError).toBe("已切换到本地兜底，请检查 API Key")

    useReaderStore.getState().setAnswerSource("llm")
    expect(useReaderStore.getState().interpretationError).toBe("")

    useReaderStore.getState().setAnswerSource("local_fallback")
    useReaderStore.getState().setInterpretationError("网络错误")
    useReaderStore.getState().setSelection("新选区", [], { pageIndex: 0, positionStart: 0, positionEnd: 3 })
    expect(useReaderStore.getState()).toMatchObject({
      selectionText: "新选区",
      interpretationError: "",
    })
  })

  it("resets the active current thread when a new text selection arrives", () => {
    useReaderStore.setState({
      selectionText: "旧选区",
      activeInterpretationSessionId: "thread-session-1",
      currentNoteDraft: "临时 note",
      currentThreadError: "旧错误",
      currentThreadLightweight: true,
    })

    useReaderStore.getState().setSelection("新选区", [], { pageIndex: 0, positionStart: 0, positionEnd: 3 })

    expect(useReaderStore.getState()).toMatchObject({
      selectionText: "新选区",
      activeInterpretationSessionId: "",
      currentThreadSelectionText: "新选区",
      currentNoteDraft: "",
      currentThreadError: "",
      currentThreadLightweight: false,
    })
  })

  it("keeps a generated thread after clearing the visible selection", () => {
    useReaderStore.setState({
      selectionText: "复利来自长期坚持",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 8 },
      currentThreadSelectionText: "复利来自长期坚持",
      currentThreadSelectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 8 },
      currentThreadPageIndex: 0,
      interpretation: "已有 Spark 解读",
      activeInterpretationSessionId: "session-1",
    })

    useReaderStore.getState().clearSelection()

    expect(useReaderStore.getState()).toMatchObject({
      selectionText: "",
      selectionAnchor: null,
      currentThreadSelectionText: "复利来自长期坚持",
      currentThreadSelectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 8 },
      currentThreadPageIndex: 0,
      interpretation: "已有 Spark 解读",
      activeInterpretationSessionId: "session-1",
    })
  })

  it("drops a transient selection when clearing before any Spark content exists", () => {
    useReaderStore.setState({
      selectionText: "临时选区",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 4 },
      currentThreadSelectionText: "临时选区",
      currentThreadSelectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 4 },
      currentThreadPageIndex: 0,
      interpretation: "",
      followUps: [],
      activeInterpretationSessionId: "",
      currentNoteDraft: "",
      currentNoteOpen: false,
    })

    useReaderStore.getState().clearSelection()

    expect(useReaderStore.getState()).toMatchObject({
      selectionText: "",
      currentThreadSelectionText: "",
      currentThreadSelectionAnchor: null,
      currentThreadPageIndex: null,
    })
  })

  it("keeps the current Spark focus while a new comment panel is open", () => {
    useReaderStore.setState({
      selectionText: "可批注选区",
      selectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 5 },
      currentThreadSelectionText: "可批注选区",
      currentThreadSelectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 5 },
      currentThreadPageIndex: 0,
      currentNoteOpen: true,
      interpretation: "",
      followUps: [],
      activeInterpretationSessionId: "",
      currentNoteDraft: "",
    })

    useReaderStore.getState().clearSelection()

    expect(useReaderStore.getState()).toMatchObject({
      selectionText: "",
      selectionAnchor: null,
      currentThreadSelectionText: "可批注选区",
      currentThreadSelectionAnchor: { pageIndex: 0, positionStart: 0, positionEnd: 5 },
      currentThreadPageIndex: 0,
      currentNoteOpen: true,
    })
  })

  it("merges lazy-loaded converted page windows in page order", () => {
    useReaderStore.getState().setParsedDocument(
      [
        { pageIndex: 0, text: "第一页", markdown: "## Page 1\n\n第一页", loaded: true },
        { pageIndex: 1, text: "", markdown: "", loaded: false },
        { pageIndex: 2, text: "", markdown: "", loaded: false },
      ],
      [
        {
          chunkId: "p1-c1",
          pageIndex: 0,
          text: "第一页",
          markdown: "### [p1-c1] Page 1\n\n第一页",
          rects: [],
        },
      ],
      "第一页",
      "## Page 1\n\n第一页",
      null,
    )

    useReaderStore.getState().mergeParsedDocumentWindow(
      [{ pageIndex: 2, text: "第三页", markdown: "## Page 3\n\n第三页" }],
      [
        {
          chunkId: "p3-c1",
          pageIndex: 2,
          text: "第三页",
          markdown: "### [p3-c1] Page 3\n\n第三页",
          rects: [],
        },
      ],
      "第三页",
      "## Page 3\n\n第三页",
    )

    expect(useReaderStore.getState().parsedPages).toEqual([
      { pageIndex: 0, text: "第一页", markdown: "## Page 1\n\n第一页", loaded: true },
      { pageIndex: 1, text: "", markdown: "", loaded: false },
      { pageIndex: 2, text: "第三页", markdown: "## Page 3\n\n第三页", loaded: true },
    ])
    expect(useReaderStore.getState().parsedChunks.map((chunk) => chunk.chunkId)).toEqual([
      "p1-c1",
      "p3-c1",
    ])
    expect(useReaderStore.getState().parsedText).toBe("第一页\n\n第三页")
    expect(useReaderStore.getState().parsedMarkdown).toBe("## Page 1\n\n第一页\n\n## Page 3\n\n第三页")
  })

  it("does not restore stale TLDR cache from parsed document metadata", () => {
    useReaderStore.getState().setParsedDocument([], [], "", "", {
      parserEngine: "text-import",
      coordinateMode: "text-only",
      tldrText: "旧版 TLDR",
      tldrGeneratedAt: "2026-06-01T00:00:00Z",
      tldrModel: "Anthropic/MiniMax-M3",
      tldrSourceVersion: 2,
    })

    expect(useReaderStore.getState().tldr).toBeNull()

    useReaderStore.getState().setParsedDocument([], [], "", "", {
      parserEngine: "text-import",
      coordinateMode: "text-only",
      tldrText: "新版 TLDR",
      tldrGeneratedAt: "2026-06-08T00:00:00Z",
      tldrModel: "Anthropic/MiniMax-M3",
      tldrSourceVersion: 3,
    })

    expect(useReaderStore.getState().tldr).toMatchObject({
      text: "新版 TLDR",
      sourceVersion: 3,
    })
  })
})
