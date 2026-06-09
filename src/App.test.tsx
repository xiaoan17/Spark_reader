import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import {
  getLlmSettings,
  interpretSelection,
  isTauriRuntime,
  listenInterpretationStream,
  saveInterpretation,
  searchBook,
} from "@/core/library-api"
import { useReaderStore } from "@/stores/reader-store"
import type { FollowUpTurn } from "@/stores/reader-store"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

type MockReaderShellProps = {
  selectionText: string
  currentThreadSelectionText?: string
  interpretation: string
  answerSource?: string
  interpretationError?: string
  followUps: FollowUpTurn[]
  currentNoteDraft?: string
  currentNoteOpen?: boolean
  currentNoteSaving?: boolean
  currentThreadError?: string
  onDeepInterpret: () => void
  onComment?: () => void
  onQuestionSubmit: (question: string) => void
  onCurrentNoteChange?: (note: string) => void
  onCurrentNoteSave?: () => void
  onClearSelection: () => void
}

vi.mock("@/components/reader/ReaderShell", () => ({
  ReaderShell: ({
    selectionText,
    currentThreadSelectionText,
    interpretation,
    answerSource,
    interpretationError,
    followUps,
    currentNoteDraft,
    currentNoteOpen,
    currentNoteSaving,
    currentThreadError,
    onDeepInterpret,
    onComment,
    onQuestionSubmit,
    onCurrentNoteChange,
    onCurrentNoteSave,
    onClearSelection,
  }: MockReaderShellProps) => (
    <main>
      <div data-testid="selection">{currentThreadSelectionText || selectionText}</div>
      <div data-testid="answer-source">{answerSource ?? ""}</div>
      <div data-testid="interpretation-error">{interpretationError ?? ""}</div>
      <div data-testid="interpretation">{interpretation}</div>
      <div data-testid="note-open">{currentNoteOpen ? "open" : "closed"}</div>
      <div data-testid="note-draft">{currentNoteDraft ?? ""}</div>
      <div data-testid="note-saving">{currentNoteSaving ? "saving" : "idle"}</div>
      <div data-testid="thread-error">{currentThreadError ?? ""}</div>
      <div data-testid="follow-ups">
        {followUps.map((turn) => `${turn.question}\n${turn.answer}`).join("\n")}
      </div>
      <button type="button" onClick={onDeepInterpret}>
        深度解读
      </button>
      <button type="button" onClick={onComment}>
        批注
      </button>
      <button type="button" onClick={() => onCurrentNoteChange?.("这是我的 comment")}>
        写批注
      </button>
      <button type="button" onClick={onCurrentNoteSave}>
        保存笔记
      </button>
      <button type="button" onClick={() => onQuestionSubmit("为什么强调长期？")}>
        追问
      </button>
      <button type="button" onClick={onClearSelection}>
        取消选中
      </button>
    </main>
  ),
}))

vi.mock("@/core/library-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library-api")>()
  return {
    ...actual,
    cancelInterpretation: vi.fn(async () => true),
    deleteHighlight: vi.fn(async () => undefined),
    deleteInterpretation: vi.fn(async () => undefined),
    getChunk: vi.fn(async () => null),
    getLlmSettings: vi.fn(async () => ({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: false,
    })),
    interpretSelection: vi.fn(async () => {
      throw new Error("interpretSelection should not be called without an API key")
    }),
    isTauriRuntime: vi.fn(() => true),
    listenInterpretationStream: vi.fn(async () => null),
    listHighlights: vi.fn(async () => []),
    listInterpretations: vi.fn(async () => []),
    saveHighlight: vi.fn(async () => {
      throw new Error("unexpected saveHighlight call")
    }),
    saveInterpretation: vi.fn(async (request: import("@/core/library-api").SaveInterpretationRequest) => ({
      ...request,
      id: `saved-${request.question ? "follow-up" : "initial"}`,
      bookId: request.bookId,
      selectionText: request.selectionText,
      sessionId: request.sessionId?.trim() || "session-1",
      turnIndex: request.turnIndex ?? (request.question ? 1 : 0),
      prefix: request.prefix ?? "",
      suffix: request.suffix ?? "",
      pageIndex: request.pageIndex ?? null,
      positionStart: request.positionStart ?? null,
      positionEnd: request.positionEnd ?? null,
      question: request.question ?? null,
      answer: request.answer,
      answerSource: request.answerSource ?? "local_fallback",
      evidenceChunkSnapshots: request.evidenceChunkSnapshots ?? [],
      createdAt: "2026-06-02T00:00:00.000Z",
    })),
    searchBook: vi.fn(async () => [
      {
        chunkId: "book-1:p1-c1",
        pageIndex: 0,
        text: "复利来自长期坚持，也来自避免在短期波动中离场。",
        markdown: "复利来自长期坚持，也来自避免在短期波动中离场。",
        rects: [],
        coordinateVersion: 1,
        snippet: "复利来自长期坚持",
        score: 1,
      },
    ]),
  }
})

vi.mock("@/core/browser-library", () => ({
  browserLibraryAvailable: vi.fn(() => false),
  deleteBrowserHighlight: vi.fn(async () => undefined),
  deleteBrowserInterpretation: vi.fn(async () => undefined),
  listBrowserHighlights: vi.fn(async () => []),
  listBrowserInterpretations: vi.fn(async () => []),
  saveBrowserHighlight: vi.fn(async () => {
    throw new Error("unexpected saveBrowserHighlight call")
  }),
  saveBrowserInterpretation: vi.fn(async () => null),
}))

describe("App LLM key preflight", () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(getLlmSettings).mockResolvedValue({
      provider: "deep_seek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: false,
    })
    vi.mocked(interpretSelection).mockClear()
    vi.mocked(listenInterpretationStream).mockClear()
    vi.mocked(searchBook).mockClear()
    vi.mocked(saveInterpretation).mockClear()
    seedIndexedSelection()
  })

  it("falls back locally without calling backend interpretation when the active provider has no key", async () => {
    const { container, unmount } = await renderApp()

    await clickButton(container, "深度解读")
    await act(async () => {
      vi.advanceTimersByTime(300)
      await flushPromises()
    })
    await flushPromises()

    const state = useReaderStore.getState()
    expect(interpretSelection).not.toHaveBeenCalled()
    expect(listenInterpretationStream).not.toHaveBeenCalled()
    expect(searchBook).toHaveBeenCalledWith("book-1", "复利来自长期坚持", 6)
    expect(saveInterpretation).toHaveBeenCalled()
    expect(state.answerSource).toBe("local_fallback")
    expect(state.interpretationError).toContain("DeepSeek")
    expect(state.interpretationError).toContain("还没有配置 API Key")
    expect(state.interpretationError).toContain("完整 LLM 解读")
    expect(state.interpretationError).toContain("本地兜底")
    expect(state.interpretationError).not.toContain("后端")
    expect(textByTestId(container, "interpretation")).toContain("复利来自长期坚持")
    expect(textByTestId(container, "answer-source")).toBe("local_fallback")

    unmount()
  })

  it("falls back locally for follow-up questions without a doomed backend call", async () => {
    useReaderStore.setState({
      interpretation: "已有初始解读。[book-1:p1-c1]",
      answerSource: "llm",
    })
    const { container, unmount } = await renderApp()

    await clickButton(container, "追问")
    await flushPromises()

    const state = useReaderStore.getState()
    expect(interpretSelection).not.toHaveBeenCalled()
    expect(listenInterpretationStream).not.toHaveBeenCalled()
    expect(searchBook).toHaveBeenCalledWith("book-1", "复利来自长期坚持", 6)
    expect(state.answerSource).toBe("local_fallback")
    expect(state.interpretationError).toContain("完整 LLM 追问")
    expect(state.interpretationError).toContain("还没有配置 API Key")
    expect(state.interpretationError).not.toContain("后端")
    expect(state.followUps).toHaveLength(1)
    expect(state.followUps[0]?.question).toBe("为什么强调长期？")
    expect(textByTestId(container, "follow-ups")).toContain("当前回答基于你框选的文字")

    unmount()
  })

  it("keeps the active Spark thread available after clearing the text selection", async () => {
    const { container, unmount } = await renderApp()

    await clickButton(container, "深度解读")
    await act(async () => {
      vi.advanceTimersByTime(300)
      await flushPromises()
    })
    await flushPromises()

    await clickButton(container, "取消选中")

    expect(useReaderStore.getState().selectionText).toBe("")
    expect(useReaderStore.getState().currentThreadSelectionText).toBe("复利来自长期坚持")
    expect(textByTestId(container, "selection")).toBe("复利来自长期坚持")

    vi.mocked(searchBook).mockClear()
    await clickButton(container, "追问")
    await flushPromises()

    expect(searchBook).toHaveBeenCalledWith("book-1", "复利来自长期坚持", 6)
    expect(useReaderStore.getState().followUps).toHaveLength(1)

    unmount()
  })

  it("saves a comment as a note Spark without requesting an AI answer", async () => {
    const { container, unmount } = await renderApp()

    await clickButton(container, "批注")

    expect(useReaderStore.getState()).toMatchObject({
      currentThreadSelectionText: "复利来自长期坚持",
      currentNoteOpen: true,
      phase: "reading",
    })
    expect(textByTestId(container, "note-open")).toBe("open")
    expect(interpretSelection).not.toHaveBeenCalled()
    expect(listenInterpretationStream).not.toHaveBeenCalled()
    expect(searchBook).not.toHaveBeenCalled()

    await clickButton(container, "写批注")
    expect(useReaderStore.getState().currentNoteDraft).toBe("这是我的 comment")

    await clickButton(container, "保存笔记")
    await flushPromises()

    expect(saveInterpretation).toHaveBeenCalledTimes(1)
    const request = vi.mocked(saveInterpretation).mock.calls[0]?.[0]
    expect(request).toMatchObject({
      bookId: "book-1",
      selectionText: "复利来自长期坚持",
      turnIndex: 0,
      question: null,
      answer: "这是我的 comment",
      answerSource: "local_fallback",
      kind: "note",
      pageIndex: 0,
      positionStart: 0,
      positionEnd: "复利来自长期坚持".length,
    })
    expect(request?.sessionId).toContain("interpretation-session-")
    expect(useReaderStore.getState()).toMatchObject({
      currentNoteDraft: "",
      currentNoteOpen: false,
    })
    expect(interpretSelection).not.toHaveBeenCalled()
    expect(listenInterpretationStream).not.toHaveBeenCalled()
    expect(searchBook).not.toHaveBeenCalled()

    unmount()
  })
})

function seedIndexedSelection() {
  const text = "复利来自长期坚持，也来自避免在短期波动中离场。"
  const selectionText = "复利来自长期坚持"
  useReaderStore.setState({
    phase: "reading",
    bookTitle: "测试书",
    bookId: "book-1",
    libraryStatus: "indexed",
    libraryMessage: "",
    currentPage: 1,
    totalPages: 1,
    zoom: 1,
    selectionText,
    selectionRects: [],
    selectionAnchor: {
      pageIndex: 0,
      positionStart: 0,
      positionEnd: selectionText.length,
    },
    evidence: [],
    agentTrace: [],
    interpretation: "",
    answerSource: "llm",
    interpretationError: "",
    followUps: [],
    activeInterpretationSessionId: "",
    currentThreadLightweight: false,
    currentThreadSelectionText: "",
    currentThreadSelectionRects: [],
    currentThreadSelectionAnchor: null,
    currentThreadPageIndex: null,
    currentNoteDraft: "",
    currentNoteOpen: false,
    currentThreadError: "",
    highlights: [],
    interpretationHistory: [],
    parsedPages: [
      {
        pageIndex: 0,
        text,
        markdown: `## Page 1\n\n${text}`,
      },
    ],
    parsedChunks: [
      {
        chunkId: "book-1:p1-c1",
        pageIndex: 0,
        text,
        markdown: text,
        rects: [],
        coordinateVersion: 1,
      },
    ],
    parsedText: text,
    parsedMarkdown: `## Page 1\n\n${text}`,
    parserEngine: "test",
    coordinateMode: "normalized-page-rects",
    activeChunkId: "",
    textQuality: null,
  })
}

async function renderApp() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<App />)
    await flushPromises()
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

async function clickButton(container: ParentNode, label: string) {
  const button = [...container.querySelectorAll("button")].find((element) =>
    textContent(element).includes(label),
  )
  if (!button) {
    throw new Error(`missing button: ${label}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flushPromises()
  })
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

function textByTestId(container: ParentNode, testId: string) {
  return textContent(container.querySelector(`[data-testid="${testId}"]`))
}

function textContent(element: Element | null | undefined) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? ""
}
