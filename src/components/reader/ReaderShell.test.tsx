import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getDocument, type PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import { open } from "@tauri-apps/plugin-dialog"
import { buildReaderOutline } from "./reader-outline"
import {
  nextAutoOpenBookId,
  nextStartupRestoreTarget,
  parseStartupSession,
  serializeStartupSession,
} from "./startup-restore"
import { formatInterpretationClipboardText } from "./interpretation-clipboard"
import { shouldRenderCurrentTextSelection } from "./current-selection"
import type {
  AgentTraceStep,
  EvidencePreview,
  FollowUpTurn,
  LibraryStatus,
  ParsedChunk,
  ParsedPage,
  ReaderPhase,
  SavedHighlight,
  SavedInterpretation,
  TextSelectionAnchor,
  TextAssetMetadata,
  TextQuality,
} from "@/stores/reader-store"
import {
  findBookBySourcePdf,
  getConvertedBook,
  importPdfWithMineru,
  importZoteroItem,
  isTauriRuntime,
  listenMineruProgress,
  listBooks,
  openBookAsset,
  readPdfFile,
  searchIndexSummary,
  searchZoteroItems,
  startTranslation,
  translationStatus,
  cancelTranslation,
  type StoredBookSummary,
  type TranslationStatus,
} from "@/core/library-api"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/pdf/pdfjs-compat", () => ({
  getDocument: vi.fn(() => {
    throw new Error("unexpected pdfjs getDocument call in ReaderShell tests")
  }),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}))

vi.mock("@/core/library-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library-api")>()
  return {
    ...actual,
    findBookBySourcePdf: vi.fn(async () => null),
    getConvertedBook: vi.fn(),
    importPdfWithMineru: vi.fn(),
    importZoteroItem: vi.fn(),
    isTauriRuntime: vi.fn(() => false),
    listenMineruProgress: vi.fn(async () => null),
    listBooks: vi.fn(async () => []),
    openBookAsset: vi.fn(),
    readPdfFile: vi.fn(),
    searchZoteroItems: vi.fn(async () => []),
    startTranslation: vi.fn(),
    translationStatus: vi.fn(),
    cancelTranslation: vi.fn(async () => false),
    searchIndexSummary: vi.fn(async (bookId: string) => ({
      bookId,
      chunkCount: 0,
      vectorCount: 0,
      embeddingProvider: "",
      embeddingBaseUrl: "",
      embeddingModel: "",
      embeddingDim: 0,
      embeddingLastError: "",
      embeddingEnabled: false,
      embeddingKeyConfigured: false,
      embeddingMatchesConfig: false,
      ftsReady: false,
    })),
  }
})

async function renderClient(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function buttonByText(container: ParentNode, text: string, index = 0) {
  return elementsByText(container, "button", text)[index] as HTMLButtonElement
}

function elementsByText(container: ParentNode, selector: string, text: string) {
  return [...container.querySelectorAll(selector)].filter((element) =>
    textContent(element).includes(text),
  )
}

function textContent(element: Element | null | undefined) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

function inputByPlaceholder(container: ParentNode, placeholder: string) {
  const element = container.querySelector(`[placeholder="${placeholder}"]`)
  if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) {
    throw new Error(`missing input placeholder: ${placeholder}`)
  }
  return element
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

async function clickAsync(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

function changeInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    )
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function storedBook(overrides: Partial<StoredBookSummary> & Pick<StoredBookSummary, "bookId" | "title" | "createdAt">): StoredBookSummary {
  return {
    totalPages: 1,
    chunkCount: 1,
    textCharCount: 1000,
    markdownCharCount: 1200,
    textPath: "/tmp/book.txt",
    markdownPath: "/tmp/book.md",
    originalPdfPath: "",
    sourcePdfPath: "",
    sourcePdfFingerprint: "",
    parserEngine: "mineru-layout",
    coordinateMode: "normalized-page-rects",
    quality: {
      charCount: 1000,
      replacementCharRatio: 0,
      controlCharRatio: 0,
      looksUsable: true,
    },
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  document.body.replaceChildren()
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn(function scrollToMock(this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object" && typeof options.top === "number") {
      this.scrollTop = options.top
    }
  })
  vi.mocked(open).mockReset()
  vi.mocked(open).mockResolvedValue(null)
  vi.mocked(getDocument).mockReset()
  vi.mocked(getDocument).mockImplementation(() => {
    throw new Error("unexpected pdfjs getDocument call in ReaderShell tests")
  })
  vi.mocked(isTauriRuntime).mockReturnValue(false)
  vi.mocked(findBookBySourcePdf).mockResolvedValue(null)
  vi.mocked(getConvertedBook).mockReset()
  vi.mocked(importPdfWithMineru).mockReset()
  vi.mocked(importZoteroItem).mockReset()
  vi.mocked(listenMineruProgress).mockResolvedValue(null)
  vi.mocked(listBooks).mockResolvedValue([])
  vi.mocked(openBookAsset).mockResolvedValue({ path: "/tmp/original.pdf" })
  vi.mocked(readPdfFile).mockResolvedValue([])
  vi.mocked(searchZoteroItems).mockResolvedValue([])
  vi.mocked(startTranslation).mockReset()
  vi.mocked(translationStatus).mockReset()
  vi.mocked(cancelTranslation).mockReset()
  vi.mocked(translationStatus).mockImplementation(async (bookId: string) => ({
    bookId,
    totalPages: 0,
    completedPages: 0,
    failedPages: 0,
    running: false,
    provider: "",
    model: "",
    pages: [],
  }))
  vi.mocked(cancelTranslation).mockResolvedValue(false)
  vi.mocked(searchIndexSummary).mockResolvedValue({
    bookId: "",
    chunkCount: 0,
    vectorCount: 0,
    embeddingProvider: "",
    embeddingBaseUrl: "",
    embeddingModel: "",
    embeddingDim: 0,
    embeddingLastError: "",
    embeddingEnabled: false,
    embeddingKeyConfigured: false,
    embeddingMatchesConfig: false,
    ftsReady: false,
  })
  vi.useRealTimers()
})

describe("ReaderShell startup restore", () => {
  it("opens the most recent converted book only in an idle desktop runtime", () => {
    const books = [{ bookId: "book-newest" }, { bookId: "book-older" }]

    expect(nextAutoOpenBookId(true, "", "idle", books)).toBe("book-newest")
    expect(nextAutoOpenBookId(false, "", "idle", books)).toBeNull()
    expect(nextAutoOpenBookId(true, "book-current", "idle", books)).toBeNull()
    expect(nextAutoOpenBookId(true, "", "indexed", books)).toBeNull()
    expect(nextAutoOpenBookId(true, "", "idle", [])).toBeNull()
  })

  it("can restore from any persistent library runtime", () => {
    const books = [{ bookId: "browser-book" }]

    expect(nextAutoOpenBookId(true, "", "idle", books)).toBe("browser-book")
    expect(nextAutoOpenBookId(false, "", "idle", books)).toBeNull()
  })

  it("prefers the last reading session when that book still exists", () => {
    const books = [{ bookId: "book-newest" }, { bookId: "book-last" }]

    expect(
      nextStartupRestoreTarget(true, "", "idle", books, {
        bookId: "book-last",
        currentPage: 42,
        readerView: "pdf",
        zoom: 1.4,
      }),
    ).toEqual({
      bookId: "book-last",
      currentPage: 42,
      readerView: "pdf",
      zoom: 1.4,
      source: "last-session",
    })
  })

  it("falls back to the newest converted book when the saved session is stale", () => {
    expect(
      nextStartupRestoreTarget(
        true,
        "",
        "idle",
        [{ bookId: "book-newest" }],
        { bookId: "deleted-book", currentPage: 9, readerView: "text" },
      ),
    ).toEqual({ bookId: "book-newest", source: "most-recent" })
  })

  it("normalizes persisted startup sessions", () => {
    expect(
      parseStartupSession(
        serializeStartupSession({
          bookId: "book-1",
          currentPage: 0,
          readerView: "pdf",
          zoom: 9,
          updatedAt: 123,
        }),
      ),
    ).toEqual({
      bookId: "book-1",
      currentPage: 1,
      readerView: "pdf",
      zoom: 2.2,
      updatedAt: 123,
    })

    expect(parseStartupSession("{bad json")).toBeNull()
    expect(parseStartupSession(JSON.stringify({ bookId: "" }))).toBeNull()
  })
})

describe("ReaderShell outline", () => {
  it("builds clickable directory entries from real headings", () => {
    const outline = buildReaderOutline(
      [
        {
          pageIndex: 0,
          text: "第一页正文，不应该变成目录。",
          markdown: "## 第一章 复利来自时间\n\n正文",
        },
        {
          pageIndex: 2,
          text: "1.1 风险控制\n\n正文",
          markdown: "",
        },
      ],
      [
        { chunkId: "p1-c1", pageIndex: 0, text: "第一章 复利来自时间", markdown: "", rects: [] },
        { chunkId: "p1-c2", pageIndex: 0, text: "正文", markdown: "", rects: [] },
        { chunkId: "p3-c1", pageIndex: 2, text: "1.1 风险控制", markdown: "", rects: [] },
      ],
      3,
    )

    expect(outline).toEqual([
      {
        id: "markdown-0-0",
        pageIndex: 0,
        title: "复利来自时间",
        level: 1,
        sectionNumber: "第一章",
        chunkCount: 2,
        preview: "第一页正文，不应该变成目录。",
        firstChunkId: "p1-c1",
      },
      {
        id: "text-2-0",
        pageIndex: 2,
        title: "风险控制",
        level: 2,
        sectionNumber: "1.1",
        chunkCount: 1,
        preview: "1.1 风险控制 正文",
        firstChunkId: "p3-c1",
      },
    ])
  })

  it("does not invent page-number directory entries when headings are missing", () => {
    const outline = buildReaderOutline(
      [],
      [{ chunkId: "p4-c1", pageIndex: 3, text: "第四页 chunk 文本", markdown: "", rects: [] }],
      0,
    )

    expect(outline).toEqual([])
  })

  it("uses native PDF outline entries before parsed fallback headings", () => {
    const outline = buildReaderOutline(
      [{ pageIndex: 0, text: "1.1 fallback", markdown: "## 1.1 fallback" }],
      [{ chunkId: "p1-c1", pageIndex: 0, text: "PDF 书签标题", markdown: "", rects: [] }],
      1,
      [
        {
          id: "pdf-outline-0",
          pageIndex: 0,
          title: "PDF 书签标题",
          level: 2,
          sectionNumber: "1.2",
          chunkCount: 0,
          preview: "",
        },
      ],
    )

    expect(outline).toEqual([
      {
        id: "pdf-outline-0",
        pageIndex: 0,
        title: "PDF 书签标题",
        level: 2,
        sectionNumber: "1.2",
        chunkCount: 1,
        preview: "1.1 fallback",
        firstChunkId: "p1-c1",
      },
    ])
  })

})

describe("ReaderShell interpretation clipboard", () => {
  it("copies selection, answer, follow-ups and evidence as one reusable note", () => {
    const text = formatInterpretationClipboardText(
      "复利来自长期坚持",
      "这句话强调时间尺度。[p1-c1]",
      [
        {
          id: "turn-1",
          question: "为什么强调长期？",
          answer: "因为短期波动会掩盖复利效果。[p2-c1]",
        },
      ],
      [{ chunkId: "p1-c1", title: "Chunk p1-c1", pageIndex: 0 }],
    )

    expect(text).toContain("选中文本：")
    expect(text).toContain("AI 解读：")
    expect(text).toContain("追问：")
    expect(text).toContain("引用证据：")
    expect(text).toContain("第 1 页 · 相关段落")
    expect(text).not.toContain("[p1-c1]")
    expect(text).not.toContain("[p2-c1]")
  })
})

describe("ReaderShell current text selection rendering", () => {
  it("renders an anchored text selection only on the anchored page", () => {
    expect(
      shouldRenderCurrentTextSelection(
        4,
        1,
        "重复文字",
        { pageIndex: 4, positionStart: 3, positionEnd: 7 },
        [],
      ),
    ).toBe(true)
    expect(
      shouldRenderCurrentTextSelection(
        0,
        1,
        "重复文字",
        { pageIndex: 4, positionStart: 3, positionEnd: 7 },
        [],
      ),
    ).toBe(false)
  })

  it("falls back to the current page for selection text without an anchor", () => {
    expect(shouldRenderCurrentTextSelection(1, 2, "重复文字", null, [])).toBe(true)
    expect(shouldRenderCurrentTextSelection(2, 2, "重复文字", null, [])).toBe(false)
  })

  it("keeps the current selection visible in converted markdown pages", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const pageText = "第一段正文。需要保持可见的选中文字。最后一句。"
    const selectionText = "需要保持可见"
    const selectionStart = pageText.indexOf(selectionText)

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-selection"
        libraryStatus="indexed"
        libraryMessage=""
        bookTitle="选区高亮测试"
        currentPage={1}
        totalPages={1}
        selectionText={selectionText}
        selectionRects={[]}
        selectionAnchor={{
          pageIndex: 0,
          positionStart: selectionStart,
          positionEnd: selectionStart + selectionText.length,
        }}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: pageText,
            markdown: `## Page 1\n\n${pageText}`,
          },
        ]}
        parsedChunks={[]}
        parserEngine="test"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    const currentSelection = container.querySelector(
      'mark[data-current-selection="true"]',
    )
    expect(textContent(currentSelection)).toBe(selectionText)
    expect(currentSelection?.className).toContain("reader-current-text-selection")
    unmount()
  })

  it("clears the converted markdown selection when clicking without a new selection", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const pageText = "第一段正文。需要取消的选中文字。最后一句。"
    const selectionText = "需要取消"
    const selectionStart = pageText.indexOf(selectionText)
    const onClearSelection = vi.fn()

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-selection"
        libraryStatus="indexed"
        libraryMessage=""
        bookTitle="选区取消测试"
        currentPage={1}
        totalPages={1}
        selectionText={selectionText}
        selectionRects={[]}
        selectionAnchor={{
          pageIndex: 0,
          positionStart: selectionStart,
          positionEnd: selectionStart + selectionText.length,
        }}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: pageText,
            markdown: `## Page 1\n\n${pageText}`,
          },
        ]}
        parsedChunks={[]}
        parserEngine="test"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onClearSelection={onClearSelection}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    const readablePage = container.querySelector("[data-readable-page]")
    expect(readablePage).not.toBeNull()

    await act(async () => {
      readablePage?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 40 }),
      )
      readablePage?.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 40 }),
      )
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      await Promise.resolve()
    })

    expect(onClearSelection).toHaveBeenCalledTimes(1)
    unmount()
  })
})

describe("ReaderShell MinerU progress labels", () => {
  it("formats long PDF batch metadata when MinerU emits structured progress", async () => {
    const { mineruProgressBatchLabel } = await import("./mineru-progress")

    expect(
      mineruProgressBatchLabel({
        stage: "polling",
        message: "MinerU 解析状态：running",
        batchId: "batch-1",
        pollCount: 3,
        state: "running",
        batchIndex: 2,
        batchTotal: 4,
        pageRange: "201-400",
      }),
    ).toBe("第 2/4 批")
  })

  it("omits invalid batch metadata", async () => {
    const { mineruProgressBatchLabel } = await import("./mineru-progress")

    expect(
      mineruProgressBatchLabel({
        stage: "preparing",
        message: "准备上传",
        pollCount: 0,
        batchIndex: 0,
        batchTotal: 4,
      }),
    ).toBe("")
  })
})

describe("ReaderShell runtime affordances", () => {
  it("hides internal chunk terminology and ids from reader-facing chrome", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "1.1 目录结构\n\n第一页正文讲目录。",
        markdown: "## 1.1 目录结构\n\n第一页正文。",
      },
      {
        pageIndex: 1,
        text: "1.2 TTC 指标\n\n第二页正文包含 TTC。",
        markdown: "## 1.2 TTC 指标\n\n第二页正文包含 TTC。",
      },
    ]
    const parsedChunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "第一页正文。",
        markdown: "",
        rects: [],
      },
      {
        chunkId: "p2-c1",
        pageIndex: 1,
        text: "第二页正文包含 TTC。",
        markdown: "",
        rects: [],
      },
    ]
    const history: SavedInterpretation[] = [
      {
        id: "history-1",
        bookId: "book-1",
        selectionText: "这个是什么？",
        sessionId: "session-1",
        turnIndex: 0,
        prefix: "",
        suffix: "",
        pageIndex: 1,
        positionStart: 0,
        positionEnd: 6,
        pageIndexes: [1],
        evidenceChunkIds: ["p2-c1"],
        question: null,
        answer: "这个指标可从公式理解。[p2-c1]",
        createdAt: "2026-06-01T00:00:00Z",
      },
    ]

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-1"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿：42 字纯文本、2 个 chunk，原 PDF 可校对"
        bookTitle="测试书"
        currentPage={2}
        totalPages={2}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={history}
        parsedPages={pages}
        parsedChunks={parsedChunks}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 42,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    const visibleText = textContent(container)
    expect(visibleText).not.toContain("chunk")
    expect(visibleText).not.toContain("chunks")
    expect(visibleText).not.toContain("chunk_id")
    expect(visibleText).not.toContain("[p2-c1]")
    expect(visibleText).not.toContain("坐标锚点")
    expect(visibleText).toContain("目录与索引")
    expect(visibleText).toContain("1.1目录结构")
    expect(visibleText).toContain("1.2TTC 指标")
    expect(visibleText).toContain("第二页正文包含 TTC。")
    expect(visibleText).not.toContain("第 2 页 · 第二页正文包含 TTC。")
    expect(visibleText).not.toContain("这个指标可从公式理解。（第 2 页 · 引用）")
    unmount()
  }, 10_000)

  it("marks browser preview mode and explains desktop-only MinerU actions", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="empty"
        bookId=""
        libraryStatus="idle"
        libraryMessage=""
        bookTitle="未导入 PDF"
        currentPage={1}
        totalPages={0}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[]}
        parsedChunks={[]}
        parserEngine=""
        coordinateMode=""
        activeChunkId=""
        textQuality={null}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(textContent(container)).toContain("浏览器预览")
    expect(textContent(container)).toContain("浏览器预览会使用已转换文本做本地兜底解读")
    expect(buttonByText(container, "从 Zotero 导入").title).toContain(
      "需要 Tauri 桌面端后端",
    )
    unmount()
  })

  it("toggles the settings panel from the top-right gear button", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="empty"
        bookId=""
        libraryStatus="idle"
        libraryMessage=""
        bookTitle="未导入 PDF"
        currentPage={1}
        totalPages={0}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[]}
        parsedChunks={[]}
        parserEngine=""
        coordinateMode=""
        activeChunkId=""
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    const settingsButton = container.querySelector('[data-testid="settings-button"]')
    if (!settingsButton) {
      throw new Error("missing settings button")
    }
    expect(container.querySelector('[data-testid="settings-panel"]')).toBeNull()
    await clickAsync(settingsButton)
    expect(container.querySelector('[data-testid="settings-panel"]')).not.toBeNull()
    expect(textContent(container)).toContain("保存全部")
    await clickAsync(settingsButton)
    expect(container.querySelector('[data-testid="settings-panel"]')).toBeNull()
    unmount()
  })

  it("opens a dedicated cover shelf for converted books", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(listBooks).mockResolvedValue([
      storedBook({
        bookId: "book-shelf",
        title: "财富公式",
        createdAt: "2026-06-01T00:00:00Z",
        totalPages: 163,
        chunkCount: 320,
        textCharCount: 120000,
        markdownCharCount: 135000,
        textPath: "/tmp/book.txt",
        markdownPath: "/tmp/book.md",
        originalPdfPath: "/tmp/book.pdf",
        sourcePdfPath: "/tmp/source.pdf",
        sourcePdfFingerprint: "pdf-fnv1a64-shelf",
        parserEngine: "mineru-layout",
        coordinateMode: "normalized-page-rects",
        quality: {
          charCount: 120000,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        },
      }),
    ])

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="empty"
        bookId=""
        libraryStatus="idle"
        libraryMessage=""
        bookTitle="未导入 PDF"
        currentPage={1}
        totalPages={0}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[]}
        parsedChunks={[]}
        parserEngine=""
        coordinateMode=""
        activeChunkId=""
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await vi.waitFor(() => expect(listBooks).toHaveBeenCalled())
    await clickAsync(buttonByText(container, "书架"))

    expect(textContent(container)).toContain("1 本已转换图书")
    expect(textContent(container)).toContain("财富公式")
    expect(textContent(container)).toContain("163 页")
    expect(textContent(container)).toContain("120000 字")
    expect(textContent(container)).not.toContain("135000 MD 字符")
    expect(textContent(container)).not.toContain("320 chunks")
    expect(textContent(container)).toContain("源 PDF")
    expect(textContent(container)).toContain("可校对")
    unmount()
  })

  it("filters and groups shelf books by search text and import date", async () => {
    const { ReaderShell, __readerShellTestUtils } = await import("./ReaderShell")
    const now = new Date("2026-06-03T12:00:00")
    vi.setSystemTime(now)
    const todayBook = storedBook({
      bookId: "book-today",
      title: "今日论文",
      createdAt: "2026-06-03T01:30:00",
      parserEngine: "mineru-layout",
    })
    const weekBook = storedBook({
      bookId: "book-week",
      title: "本周论文",
      createdAt: "2026-06-02T08:00:00",
      parserEngine: "pymupdf",
    })
    const olderBook = storedBook({
      bookId: "book-older",
      title: "上月旧书",
      createdAt: "2026-05-10T08:00:00",
      parserEngine: "unknown",
    })

    expect(__readerShellTestUtils.groupLibraryBooksByRange([todayBook, weekBook, olderBook], now).map((group) => [
      group.title,
      group.books.map((book) => book.bookId),
    ])).toEqual([
      ["今天", ["book-today"]],
      ["本周", ["book-week"]],
      ["本月及以前", ["book-older"]],
    ])
    expect(__readerShellTestUtils.filterLibraryBooks([todayBook, weekBook, olderBook], "pymupdf", "all", now)).toEqual([
      weekBook,
    ])

    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(listBooks).mockResolvedValue([todayBook, weekBook, olderBook])

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId=""
        libraryStatus="idle"
        libraryMessage=""
        bookTitle="未导入 PDF"
        currentPage={1}
        totalPages={0}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[]}
        parsedChunks={[]}
        parserEngine=""
        coordinateMode=""
        activeChunkId=""
        textQuality={null}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await vi.waitFor(() => expect(listBooks).toHaveBeenCalled())
    await clickAsync(buttonByText(container, "书架"))
    expect(textContent(container)).toContain("今天1 本")
    expect(textContent(container)).toContain("本周1 本")
    expect(textContent(container)).toContain("本月及以前1 本")

    changeInput(inputByPlaceholder(container, "搜索书名、解析器或标签"), "pymupdf")
    expect(textContent(container)).toContain("显示 1 / 3 本")
    expect(textContent(container)).toContain("本周论文")
    expect(textContent(container)).not.toContain("今日论文")

    await clickAsync(buttonByText(container, "今天"))
    expect(textContent(container)).toContain("没有匹配的图书")
    unmount()
  })

  it("keeps completed translation status out of the scrolling page content", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const translation: TranslationStatus = {
      bookId: "book-translated",
      totalPages: 1,
      completedPages: 1,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          sourceMarkdown: "## Page 1\n\nEnglish source.",
          translatedMarkdown: "中文译文。",
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-translated"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿"
        bookTitle="已翻译论文"
        currentPage={1}
        totalPages={1}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "English source.",
            markdown: "## Page 1\n\nEnglish source.",
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 15,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-translated"))

    const toolbar = container.querySelector("[data-translation-toolbar]")
    const scroller = container.querySelector("[data-translation-scroller]")
    expect(toolbar).not.toBeNull()
    expect(scroller).not.toBeNull()
    expect(toolbar?.className).not.toContain("sticky")
    expect(scroller?.className).toContain("overflow-y-auto")
    expect(textContent(toolbar)).toContain("本地缓存")
    expect(textContent(toolbar)).toContain("1/1 页完成")
    expect(textContent(toolbar)).toContain("重新翻译")
    expect(textContent(toolbar)).not.toContain("继续翻译")
    expect(textContent(toolbar)).not.toContain("重试失败")
    expect(textContent(scroller)).toContain("English source.")
    expect(textContent(scroller)).toContain("中文译文。")
    expect(textContent(scroller)).not.toContain("本地缓存")
    unmount()
  })

  it("does not snap the translation page when scrolling naturally reveals the next page", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "First page source.",
        markdown: "## Page 1\n\nFirst page source.",
      },
      {
        pageIndex: 1,
        text: "Second page source.",
        markdown: "## Page 2\n\nSecond page source.",
      },
    ]
    const translation: TranslationStatus = {
      bookId: "book-natural-scroll",
      totalPages: 2,
      completedPages: 2,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: pages.map((page) => ({
        pageIndex: page.pageIndex,
        sourceMarkdown: page.markdown,
        translatedMarkdown: page.pageIndex === 0 ? "第一页译文。" : "第二页译文。",
        status: "done",
        error: "",
        provider: "deep_seek",
        model: "deepseek-v4-flash",
        updatedAt: "2026-06-01T00:00:00Z",
      })),
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)

    function Harness() {
      const [currentPage, setCurrentPage] = useState(1)
      return (
        <ReaderShell
          phase="reading"
          bookId="book-natural-scroll"
          libraryStatus="indexed"
          libraryMessage="已打开转换稿"
          bookTitle="自然滚动测试"
          currentPage={currentPage}
          totalPages={2}
          selectionText=""
          selectionRects={[]}
          selectionAnchor={null}
          evidence={[]}
          agentTrace={[]}
          interpretation=""
          followUps={[]}
          highlights={[]}
          interpretationHistory={[]}
          parsedPages={pages}
          parsedChunks={[]}
          parserEngine="mineru-layout"
          coordinateMode="normalized-page-rects"
          activeChunkId=""
          textQuality={{
            charCount: 40,
            replacementCharRatio: 0,
            controlCharRatio: 0,
            looksUsable: true,
          }}
          zoom={1}
          onBookLoaded={vi.fn()}
          onLibraryStatus={vi.fn()}
          onParsedDocument={vi.fn()}
          onPageChange={setCurrentPage}
          onVisiblePageChange={setCurrentPage}
          onZoomChange={vi.fn()}
          onSelection={vi.fn()}
          onActiveChunk={vi.fn()}
          onChunkFocus={vi.fn()}
          onPhaseChange={vi.fn()}
          onDeepInterpret={vi.fn()}
          onPlainExplain={vi.fn()}
          onQuestionSubmit={vi.fn()}
          onSaveHighlight={vi.fn(async () => false)}
          onOpenHighlight={vi.fn()}
          onDeleteHighlight={vi.fn()}
          onOpenInterpretation={vi.fn()}
          onDeleteInterpretation={vi.fn()}
          onRegenerate={vi.fn()}
          onStop={vi.fn()}
        />
      )
    }

    const { container, unmount } = await renderClient(<Harness />)
    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-natural-scroll"))
    const scroller = container.querySelector("[data-translation-scroller]") as HTMLElement
    const articles = scroller.querySelectorAll("article")
    Object.defineProperty(scroller, "scrollTop", { value: 520, writable: true, configurable: true })
    scroller.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      bottom: 700,
      right: 900,
      width: 900,
      height: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    articles[0]!.getBoundingClientRect = vi.fn(() => ({
      top: -520,
      left: 0,
      bottom: 80,
      right: 900,
      width: 900,
      height: 600,
      x: 0,
      y: -520,
      toJSON: () => ({}),
    }))
    articles[1]!.getBoundingClientRect = vi.fn(() => ({
      top: 120,
      left: 0,
      bottom: 720,
      right: 900,
      width: 900,
      height: 600,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    }))
    vi.mocked(scroller.scrollTo).mockClear()
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    act(() => {
      scroller.dispatchEvent(new Event("scroll"))
    })

    await vi.waitFor(() => expect(textContent(container)).toContain("第 2 / 2 页"))
    expect(scroller.scrollTo).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    unmount()
  })

  it("smoothly scrolls the translation scroller when footer pagination changes page", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "First page source.",
        markdown: "## Page 1\n\nFirst page source.",
      },
      {
        pageIndex: 1,
        text: "Second page source.",
        markdown: "## Page 2\n\nSecond page source.",
      },
    ]
    const translation: TranslationStatus = {
      bookId: "book-translation-scroll",
      totalPages: 2,
      completedPages: 2,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: pages.map((page) => ({
        pageIndex: page.pageIndex,
        sourceMarkdown: page.markdown,
        translatedMarkdown: page.pageIndex === 0 ? "第一页译文。" : "第二页译文。",
        status: "done",
        error: "",
        provider: "deep_seek",
        model: "deepseek-v4-flash",
        updatedAt: "2026-06-01T00:00:00Z",
      })),
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)

    function Harness() {
      const [currentPage, setCurrentPage] = useState(1)
      return (
        <ReaderShell
          phase="reading"
          bookId="book-translation-scroll"
          libraryStatus="indexed"
          libraryMessage="已打开转换稿"
          bookTitle="翻译滚动测试"
          currentPage={currentPage}
          totalPages={2}
          selectionText=""
          selectionRects={[]}
          selectionAnchor={null}
          evidence={[]}
          agentTrace={[]}
          interpretation=""
          followUps={[]}
          highlights={[]}
          interpretationHistory={[]}
          parsedPages={pages}
          parsedChunks={[]}
          parserEngine="mineru-layout"
          coordinateMode="normalized-page-rects"
          activeChunkId=""
          textQuality={{
            charCount: 40,
            replacementCharRatio: 0,
            controlCharRatio: 0,
            looksUsable: true,
          }}
          zoom={1}
          onBookLoaded={vi.fn()}
          onLibraryStatus={vi.fn()}
          onParsedDocument={vi.fn()}
          onPageChange={setCurrentPage}
          onVisiblePageChange={setCurrentPage}
          onZoomChange={vi.fn()}
          onSelection={vi.fn()}
          onActiveChunk={vi.fn()}
          onChunkFocus={vi.fn()}
          onPhaseChange={vi.fn()}
          onDeepInterpret={vi.fn()}
          onPlainExplain={vi.fn()}
          onQuestionSubmit={vi.fn()}
          onSaveHighlight={vi.fn(async () => false)}
          onOpenHighlight={vi.fn()}
          onDeleteHighlight={vi.fn()}
          onOpenInterpretation={vi.fn()}
          onDeleteInterpretation={vi.fn()}
          onRegenerate={vi.fn()}
          onStop={vi.fn()}
        />
      )
    }

    const { container, unmount } = await renderClient(<Harness />)
    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-translation-scroll"))
    const scroller = container.querySelector("[data-translation-scroller]") as HTMLElement
    const articles = scroller.querySelectorAll("article")
    Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true, configurable: true })
    scroller.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      bottom: 700,
      right: 900,
      width: 900,
      height: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    articles[0]!.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      bottom: 600,
      right: 900,
      width: 900,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    articles[1]!.getBoundingClientRect = vi.fn(() => ({
      top: 760,
      left: 0,
      bottom: 1360,
      right: 900,
      width: 900,
      height: 600,
      x: 0,
      y: 760,
      toJSON: () => ({}),
    }))

    click(container.querySelector('[aria-label="下一页"]')!)

    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 760, behavior: "smooth" })
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    unmount()
  })

  it("renders translation source and target as paired markdown blocks", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const translation: TranslationStatus = {
      bookId: "book-aligned",
      totalPages: 1,
      completedPages: 1,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          sourceMarkdown: "",
          translatedMarkdown: [
            "**中文译文**",
            "第一段中文。",
            "Second English paragraph is echoed by the model.",
            "第二段中文。",
            "翻译说明：保留了格式。",
          ].join("\n\n"),
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-aligned"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿"
        bookTitle="已翻译论文"
        currentPage={1}
        totalPages={1}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "First English paragraph.\n\nSecond English paragraph is echoed by the model.",
            markdown:
              "## Page 1\n\nFirst English paragraph.\n\nSecond English paragraph is echoed by the model.",
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 70,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-aligned"))

    const sourceRows = container.querySelectorAll('[data-translation-block-pane="source"]')
    const translationRows = container.querySelectorAll('[data-translation-block-pane="translation"]')
    expect(sourceRows).toHaveLength(2)
    expect(translationRows).toHaveLength(2)
    expect(sourceRows[0]?.getAttribute("data-translation-block-row")).toBe("0")
    expect(translationRows[0]?.getAttribute("data-translation-block-row")).toBe("0")
    expect(textContent(sourceRows[0])).toContain("First English paragraph.")
    expect(textContent(translationRows[0])).toContain("第一段中文。")
    expect(textContent(sourceRows[1])).toContain("Second English paragraph is echoed by the model.")
    expect(textContent(translationRows[1])).toContain("第二段中文。")
    expect([...translationRows].map((row) => textContent(row)).join("\n")).not.toContain(
      "中文译文",
    )
    expect([...translationRows].map((row) => textContent(row)).join("\n")).not.toContain(
      "翻译说明",
    )
    unmount()
  })

  it("keeps numbered translation blocks aligned when the model omits short source blocks", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const translation: TranslationStatus = {
      bookId: "book-numbered-aligned",
      totalPages: 1,
      completedPages: 1,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          sourceMarkdown: "",
          translatedMarkdown: [
            "[[B1]]",
            "**REACT：协同语言模型中的推理与行动**",
            "[[B3]]",
            "摘要中文应该仍然对齐到英文摘要。",
          ].join("\n\n"),
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-numbered-aligned"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿"
        bookTitle="已翻译论文"
        currentPage={1}
        totalPages={1}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: [
              "REACT: SYNERGIZING REASONING AND ACTING IN LANGUAGE MODELS",
              "Shunyu Yao, Jeffrey Zhao",
              "ABSTRACT",
            ].join("\n\n"),
            markdown: [
              "## Page 1",
              "REACT: SYNERGIZING REASONING AND ACTING IN LANGUAGE MODELS",
              "Shunyu Yao, Jeffrey Zhao",
              "ABSTRACT",
            ].join("\n\n"),
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 120,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-numbered-aligned"))

    const sourceRows = container.querySelectorAll('[data-translation-block-pane="source"]')
    const translationRows = container.querySelectorAll('[data-translation-block-pane="translation"]')
    expect(sourceRows).toHaveLength(3)
    expect(translationRows).toHaveLength(3)
    expect(textContent(sourceRows[1])).toContain("Shunyu Yao")
    expect(textContent(translationRows[1])).toBe("")
    expect(textContent(sourceRows[2])).toContain("ABSTRACT")
    expect(textContent(translationRows[2])).toContain("摘要中文应该仍然对齐到英文摘要。")
    expect([...translationRows].map((row) => textContent(row)).join("\n")).not.toContain("[[B")
    unmount()
  })

  it("supports selection actions inside the translation view", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const translation: TranslationStatus = {
      bookId: "book-translated",
      totalPages: 1,
      completedPages: 1,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          sourceMarkdown: "## Page 1\n\nEnglish source.",
          translatedMarkdown: "中文译文包含 ALFWorld。",
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)
    const onSelection = vi.fn()
    const onDeepInterpret = vi.fn()
    const onQuestionSubmit = vi.fn()

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-translated"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿"
        bookTitle="已翻译论文"
        currentPage={1}
        totalPages={1}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "English source.",
            markdown: "## Page 1\n\nEnglish source.",
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 15,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={onSelection}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={onDeepInterpret}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={onQuestionSubmit}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-translated"))
    const translatedPane = container.querySelector('[data-translation-pane="translation"]')
    const translatedBlock = container.querySelector('[data-translation-block-pane="translation"]')
    expect(translatedBlock).toBeTruthy()
    const range = document.createRange()
    range.selectNodeContents(translatedBlock!)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    act(() => {
      translatedPane?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))
    })
    await vi.waitFor(() => expect(onSelection).toHaveBeenCalled())
    expect(onSelection.mock.calls.at(-1)?.[0]).toContain("ALFWorld")

    unmount()

    const { container: selectedContainer, unmount: unmountSelected } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-translated"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿"
        bookTitle="已翻译论文"
        currentPage={1}
        totalPages={1}
        selectionText="中文译文包含 ALFWorld。"
        selectionRects={[]}
        selectionAnchor={{ pageIndex: 0, positionStart: 0, positionEnd: 18 }}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "English source.",
            markdown: "## Page 1\n\nEnglish source.",
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 15,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={onDeepInterpret}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={onQuestionSubmit}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(selectedContainer, "对照翻译"))
    await vi.waitFor(() => expect(selectedContainer.querySelector('[data-testid="selection-toolbar"]')).not.toBeNull())
    click(buttonByText(selectedContainer, "深度解读"))
    expect(onDeepInterpret).toHaveBeenCalled()
    click(buttonByText(selectedContainer, "提问", 0))
    const questionBox = inputByPlaceholder(selectedContainer, "输入你的问题或解读要求")
    changeInput(questionBox, "解释这个术语在论文中的作用")
    click(buttonByText(selectedContainer, "发送"))
    expect(onQuestionSubmit).toHaveBeenCalledWith("解释这个术语在论文中的作用")
    unmountSelected()
  })
})

describe("ReaderShell desktop import", () => {
  it("imports a PDF through the Rust backend and opens the converted Markdown asset", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(open).mockResolvedValue("/tmp/desk-book.pdf")
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    const loadedPdf = { numPages: 1, cleanup: vi.fn() } as unknown as PDFDocumentProxy
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(loadedPdf),
    } as ReturnType<typeof getDocument>)
    vi.mocked(importPdfWithMineru).mockResolvedValue({
      bookId: "book-desktop",
      pageCount: 1,
      chunkCount: 1,
      textCharCount: 10,
      markdownCharCount: 22,
      textPath: "/tmp/book-desktop/book.txt",
      markdownPath: "/tmp/book-desktop/book.md",
      originalPdfPath: "/tmp/book-desktop/original.pdf",
      sourcePdfPath: "/tmp/desk-book.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-test",
    })
    const quality: TextQuality = {
      charCount: 10,
      replacementCharRatio: 0,
      controlCharRatio: 0,
      looksUsable: true,
    }
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "后端生成 TXT 内容",
        markdown: "## Page 1\n\n后端生成 TXT 内容",
      },
    ]
    const chunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "后端生成 TXT 内容",
        markdown: "### [p1-c1] Page 1\n\n后端生成 TXT 内容",
        rects: [],
      },
    ]
    vi.mocked(getConvertedBook).mockResolvedValue({
      bookId: "book-desktop",
      title: "后端转换书",
      totalPages: 1,
      text: "后端生成 TXT 内容",
      markdown: "## Page 1\n\n后端生成 TXT 内容",
      textPath: "/tmp/book-desktop/book.txt",
      markdownPath: "/tmp/book-desktop/book.md",
      originalPdfPath: "/tmp/book-desktop/original.pdf",
      sourcePdfPath: "/tmp/desk-book.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-test",
      parserEngine: "mineru-layout",
      coordinateMode: "normalized-page-rects",
      quality,
      pages,
      chunks,
    })

    const onParsedDocument = vi.fn()
    const onLibraryStatus = vi.fn()

    function Harness() {
      const [phase, setPhase] = useState<ReaderPhase>("empty")
      const [bookId, setBookId] = useState("")
      const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("idle")
      const [libraryMessage, setLibraryMessage] = useState("")
      const [bookTitle, setBookTitle] = useState("未导入 PDF")
      const [currentPage, setCurrentPage] = useState(1)
      const [totalPages, setTotalPages] = useState(0)
      const [loadedPages, setLoadedPages] = useState<ParsedPage[]>([])
      const [loadedChunks, setLoadedChunks] = useState<ParsedChunk[]>([])
      const [parserEngine, setParserEngine] = useState("")
      const [coordinateMode, setCoordinateMode] = useState("")
      const [loadedQuality, setLoadedQuality] = useState<TextQuality | null>(null)

      return (
        <ReaderShell
          phase={phase}
          bookId={bookId}
          libraryStatus={libraryStatus}
          libraryMessage={libraryMessage}
          bookTitle={bookTitle}
          currentPage={currentPage}
          totalPages={totalPages}
          selectionText=""
          selectionRects={[]}
          selectionAnchor={null}
          evidence={[]}
          agentTrace={[]}
          interpretation=""
          followUps={[]}
          highlights={[]}
          interpretationHistory={[]}
          parsedPages={loadedPages}
          parsedChunks={loadedChunks}
          parserEngine={parserEngine}
          coordinateMode={coordinateMode}
          activeChunkId=""
          textQuality={loadedQuality}
          zoom={1}
          onBookLoaded={(title, pageCount) => {
            setBookTitle(title)
            setTotalPages(pageCount)
          }}
          onLibraryStatus={(status, message = "", nextBookId) => {
            onLibraryStatus(status, message, nextBookId)
            setLibraryStatus(status)
            setLibraryMessage(message)
            if (nextBookId) setBookId(nextBookId)
          }}
          onParsedDocument={(
            nextPages: ParsedPage[],
            nextChunks: ParsedChunk[],
            text: string,
            markdown: string,
            metadata?: TextAssetMetadata | null,
          ) => {
            onParsedDocument(nextPages, nextChunks, text, markdown, metadata)
            setLoadedPages(nextPages)
            setLoadedChunks(nextChunks)
            setParserEngine(metadata?.parserEngine ?? "")
            setCoordinateMode(metadata?.coordinateMode ?? "")
            setLoadedQuality(metadata?.quality ?? null)
          }}
          onPageChange={setCurrentPage}
          onVisiblePageChange={setCurrentPage}
          onZoomChange={vi.fn()}
          onSelection={vi.fn()}
          onActiveChunk={vi.fn()}
          onChunkFocus={vi.fn()}
          onPhaseChange={setPhase}
          onDeepInterpret={vi.fn()}
          onPlainExplain={vi.fn()}
          onQuestionSubmit={vi.fn()}
          onSaveHighlight={vi.fn(async () => false)}
          onOpenHighlight={vi.fn()}
          onDeleteHighlight={vi.fn()}
          onOpenInterpretation={vi.fn()}
          onDeleteInterpretation={vi.fn()}
          onRegenerate={vi.fn()}
          onStop={vi.fn()}
        />
      )
    }

    const { container, unmount } = await renderClient(<Harness />)
    await clickAsync(buttonByText(container, "导入文件"))

    await vi.waitFor(() => {
      expect(importPdfWithMineru).toHaveBeenCalledWith(
        "/tmp/desk-book.pdf",
        {
          isOcr: false,
          language: "ch",
          modelVersion: "vlm",
          enableFormula: true,
          enableTable: true,
          pageRanges: null,
        },
        1,
      )
      expect(getConvertedBook).toHaveBeenCalledWith("book-desktop")
    })
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    })
    expect(readPdfFile).toHaveBeenCalledWith("/tmp/desk-book.pdf")
    expect(findBookBySourcePdf).toHaveBeenCalledWith("/tmp/desk-book.pdf")
    expect(onParsedDocument).toHaveBeenCalledWith(pages, chunks, "后端生成 TXT 内容", "## Page 1\n\n后端生成 TXT 内容", {
      parserEngine: "mineru-layout",
      coordinateMode: "normalized-page-rects",
      quality,
      textPath: "/tmp/book-desktop/book.txt",
      markdownPath: "/tmp/book-desktop/book.md",
      originalPdfPath: "/tmp/book-desktop/original.pdf",
      sourcePdfPath: "/tmp/desk-book.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-test",
    })
    expect(onLibraryStatus).toHaveBeenCalledWith(
      "indexed",
      "MinerU 已解析 10 字，并生成 Markdown 转换稿",
      "book-desktop",
    )
    expect(textContent(container)).toContain("后端生成 TXT 内容")
    expect(textContent(container)).toContain("目录与索引")
    expect(textContent(container)).not.toContain("normalized-page-rects")
    unmount()
  })

  it("keeps the current converted book readable when a new desktop import fails", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(open).mockResolvedValue("/tmp/new-broken.pdf")
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    const loadedPdf = { numPages: 10, cleanup: vi.fn() } as unknown as PDFDocumentProxy
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(loadedPdf),
    } as ReturnType<typeof getDocument>)
    vi.mocked(importPdfWithMineru).mockRejectedValue(new Error("MinerU token missing"))

    const oldPages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "旧书仍然应该可读。",
        markdown: "## Page 1\n\n旧书仍然应该可读。",
      },
    ]
    const oldChunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "旧书仍然应该可读。",
        markdown: "### [p1-c1] Page 1\n\n旧书仍然应该可读。",
        rects: [],
      },
    ]
    const onLibraryStatus = vi.fn()
    const onParsedDocument = vi.fn()
    const onBookLoaded = vi.fn()

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-old"
        libraryStatus="indexed"
        libraryMessage="旧书文本索引已就绪"
        bookTitle="旧书"
        currentPage={1}
        totalPages={1}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={oldPages}
        parsedChunks={oldChunks}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 9,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={onBookLoaded}
        onLibraryStatus={onLibraryStatus}
        onParsedDocument={onParsedDocument}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(container, "导入文件"))
    await vi.waitFor(() =>
      expect(importPdfWithMineru).toHaveBeenCalledWith(
        "/tmp/new-broken.pdf",
        {
          isOcr: false,
          language: "ch",
          modelVersion: "vlm",
          enableFormula: true,
          enableTable: true,
          pageRanges: null,
        },
        10,
      ),
    )

    expect(textContent(container)).toContain("旧书仍然应该可读。")
    expect(textContent(container)).toContain("MinerU 云端解析失败；已保留当前阅读内容")
    expect(onParsedDocument).not.toHaveBeenCalled()
    expect(onBookLoaded).not.toHaveBeenCalled()
    expect(onLibraryStatus).not.toHaveBeenCalledWith("error", "MinerU token missing")
    expect(loadedPdf.cleanup).toHaveBeenCalled()
    unmount()
  })

  it("searches Zotero by title and imports the selected PDF through the backend", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    let progressHandler: Parameters<typeof listenMineruProgress>[0] | null = null
    const unlistenProgress = vi.fn()
    vi.mocked(listenMineruProgress).mockImplementation(async (handler) => {
      progressHandler = handler
      return unlistenProgress
    })
    vi.mocked(searchZoteroItems).mockResolvedValue([
      {
        itemKey: "TCLLD6HC",
        title: "RiskNet: interaction-aware risk forecasting",
        creators: ["Liu"],
        year: "2026",
        itemType: "journalArticle",
        attachmentKey: "SICPQR3S",
        attachmentTitle: "PDF",
        hasPdf: true,
      },
    ])
    const importResult = {
      bookId: "book-zotero",
      pageCount: 2,
      chunkCount: 1,
      textCharCount: 12,
      markdownCharCount: 22,
      textPath: "/tmp/book-zotero/book.txt",
      markdownPath: "/tmp/book-zotero/book.md",
      originalPdfPath: "/tmp/book-zotero/original.pdf",
      sourcePdfPath: "/Users/anbc/Zotero/storage/SICPQR3S/risknet.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-zotero",
    }
    const zoteroImport = deferred<typeof importResult>()
    vi.mocked(importZoteroItem).mockReturnValue(zoteroImport.promise)
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    const loadedPdf = { numPages: 2, cleanup: vi.fn() } as unknown as PDFDocumentProxy
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(loadedPdf),
    } as ReturnType<typeof getDocument>)
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "Zotero 导入正文。",
        markdown: "## Page 1\n\nZotero 导入正文。",
      },
    ]
    const chunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "Zotero 导入正文。",
        markdown: "### [p1-c1] Page 1\n\nZotero 导入正文。",
        rects: [],
      },
    ]
    vi.mocked(getConvertedBook).mockResolvedValue({
      bookId: "book-zotero",
      title: "RiskNet",
      totalPages: 2,
      text: "Zotero 导入正文。",
      markdown: "## Page 1\n\nZotero 导入正文。",
      textPath: "/tmp/book-zotero/book.txt",
      markdownPath: "/tmp/book-zotero/book.md",
      originalPdfPath: "/tmp/book-zotero/original.pdf",
      sourcePdfPath: "/Users/anbc/Zotero/storage/SICPQR3S/risknet.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-zotero",
      parserEngine: "mineru-layout",
      coordinateMode: "normalized-page-rects",
      quality: {
        charCount: 12,
        replacementCharRatio: 0,
        controlCharRatio: 0,
        looksUsable: true,
      },
      pages,
      chunks,
    })
    const onLibraryStatus = vi.fn()
    const onParsedDocument = vi.fn()

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="empty"
        bookId=""
        libraryStatus="idle"
        libraryMessage=""
        bookTitle="未导入 PDF"
        currentPage={1}
        totalPages={0}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[]}
        parsedChunks={[]}
        parserEngine=""
        coordinateMode=""
        activeChunkId=""
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={onLibraryStatus}
        onParsedDocument={onParsedDocument}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    await clickAsync(buttonByText(container, "从 Zotero 导入"))
    const queryInput = inputByPlaceholder(container, "输入论文标题或关键词")
    changeInput(queryInput, "RiskNet")
    await clickAsync(buttonByText(container, "搜索"))
    await vi.waitFor(() => expect(searchZoteroItems).toHaveBeenCalledWith("RiskNet", 8))
    expect(textContent(container)).toContain("RiskNet: interaction-aware risk forecasting")

    const resultCards = elementsByText(container, "article", "RiskNet: interaction-aware risk forecasting")
    await clickAsync(buttonByText(resultCards[0], "导入"))
    await vi.waitFor(() => expect(importZoteroItem).toHaveBeenCalledWith("TCLLD6HC", null))
    expect(listenMineruProgress).toHaveBeenCalled()
    await act(async () => {
      progressHandler?.({
        stage: "polling",
        message: "MinerU 解析状态：running（第 3 次轮询）",
        batchId: "batch-risknet",
        pollCount: 3,
        state: "running",
        batchIndex: null,
        batchTotal: null,
        pageRange: null,
      })
      await Promise.resolve()
    })
    expect(textContent(container)).toContain("解析中")
    expect(textContent(container)).toContain("第 3 次轮询")
    await act(async () => {
      zoteroImport.resolve(importResult)
      await zoteroImport.promise
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(readPdfFile).toHaveBeenCalledWith("/tmp/book-zotero/original.pdf")
    expect(onParsedDocument).toHaveBeenCalledWith(
      pages,
      chunks,
      "Zotero 导入正文。",
      "## Page 1\n\nZotero 导入正文。",
      {
        parserEngine: "mineru-layout",
        coordinateMode: "normalized-page-rects",
        quality: {
          charCount: 12,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        },
        textPath: "/tmp/book-zotero/book.txt",
        markdownPath: "/tmp/book-zotero/book.md",
        originalPdfPath: "/tmp/book-zotero/original.pdf",
        sourcePdfPath: "/Users/anbc/Zotero/storage/SICPQR3S/risknet.pdf",
        sourcePdfFingerprint: "pdf-fnv1a64-zotero",
      },
    )
    expect(onLibraryStatus).toHaveBeenCalledWith(
      "indexed",
      "已从 Zotero 导入并云端解析 12 字正文",
      "book-zotero",
    )
    expect(unlistenProgress).toHaveBeenCalled()
    unmount()
  })
})

describe("ReaderShell approximate coordinates", () => {
  it("surfaces approximate coordinate mode without disabling reading actions", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "旋转页坐标来自 MinerU angle，仍可用于近似跳转。",
        markdown: "## Page 1\n\n旋转页坐标来自 MinerU angle，仍可用于近似跳转。",
      },
    ]
    const chunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: pages[0].text,
        markdown: "### [p1-c1] Page 1\n\n旋转页坐标来自 MinerU angle，仍可用于近似跳转。",
        rects: [{ pageIndex: 0, x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }],
      },
    ]

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-approx"
        libraryStatus="indexed"
        libraryMessage=""
        bookTitle="近似坐标测试"
        currentPage={1}
        totalPages={1}
        selectionText="旋转页坐标"
        selectionRects={[]}
        selectionAnchor={{ pageIndex: 0, positionStart: 0, positionEnd: 5 }}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={pages}
        parsedChunks={chunks}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects-approx-angle"
        activeChunkId=""
        textQuality={{
          charCount: 24,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={vi.fn()}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(textContent(container)).not.toContain("normalized-page-rects-approx-angle")
    expect(textContent(container)).not.toContain("坐标锚点")
    const toolbar = container.querySelector('[data-testid="selection-toolbar"]')
    expect(textContent(toolbar)).toContain("近似")
    expect(buttonByText(container, "深度解读").disabled).toBe(false)
    unmount()
  })
})

describe("ReaderShell highlight navigation", () => {
  it("opens saved highlights in the converted text workflow by default", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const highlight: SavedHighlight = {
      id: "highlight-geometry",
      bookId: "book-1",
      selectionText: "几何高亮",
      prefix: "",
      suffix: "",
      pageIndex: 0,
      positionStart: null,
      positionEnd: null,
      rects: [{ pageIndex: 0, x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.2 }],
      interpretation: null,
      createdAt: "2026-06-01T00:00:00Z",
    }
    const onOpenHighlight = vi.fn()

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-1"
        libraryStatus="indexed"
        libraryMessage=""
        bookTitle="高亮导航测试"
        currentPage={1}
        totalPages={1}
        selectionText=""
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[highlight]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "几何高亮应该默认回到转换稿。",
            markdown: "## Page 1\n\n几何高亮应该默认回到转换稿。",
          },
        ]}
        parsedChunks={[]}
        parserEngine="test"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={vi.fn()}
        onSaveHighlight={vi.fn(async () => false)}
        onOpenHighlight={onOpenHighlight}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(textContent(container)).toContain("Markdown")
    expect(textContent(container)).not.toContain("PDF 坐标")
    expect(onOpenHighlight).not.toHaveBeenCalled()
    expect(textContent(container)).toContain("几何高亮应该默认回到转换稿。")
    unmount()
  })
})

describe("ReaderShell product interaction chain", () => {
  it("keeps the selected passage usable through citation jump, follow-up and highlight save", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const chunkA = "b12345678-p1-c1-abcdef12"
    const chunkB = "b12345678-p2-c1-bbbbbbbb"
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "复利来自长期坚持，时间会放大微小差异。",
        markdown: "## Page 1\n\n复利来自长期坚持，时间会放大微小差异。",
      },
      {
        pageIndex: 1,
        text: "风险控制让长期计划不被短期波动打断。",
        markdown: "## Page 2\n\n风险控制让长期计划不被短期波动打断。",
      },
    ]
    const chunks: ParsedChunk[] = [
      {
        chunkId: chunkA,
        pageIndex: 0,
        text: pages[0].text,
        markdown: `### [${chunkA}] Page 1\n\n复利来自长期坚持，时间会放大微小差异。`,
        rects: [],
      },
      {
        chunkId: chunkB,
        pageIndex: 1,
        text: pages[1].text,
        markdown: `### [${chunkB}] Page 2\n\n风险控制让长期计划不被短期波动打断。`,
        rects: [],
      },
    ]
    const evidence: EvidencePreview[] = [{ chunkId: chunkA, title: `Chunk ${chunkA}`, pageIndex: 0 }]
    const trace: AgentTraceStep[] = [
      { phase: "retrieve", query: "复利 长期", chunkIds: [chunkA], note: "检索焦点 chunk" },
    ]
    const followUps: FollowUpTurn[] = [
      {
        id: "turn-1",
        question: "它和风险控制有什么关系？",
        answer: `风险控制保证长期计划不断裂。[${chunkB}]`,
      },
    ]
    const highlight: SavedHighlight = {
      id: "highlight-1",
      bookId: "book-1",
      selectionText: "复利来自长期坚持",
      prefix: "",
      suffix: "，时间会放大微小差异。",
      pageIndex: 0,
      positionStart: 0,
      positionEnd: 8,
      rects: [],
      interpretation: `复利需要时间作为条件。[${chunkA}]`,
      createdAt: "2026-06-01T00:00:00Z",
    }
    const onChunkFocus = vi.fn()
    const onCitationClick = vi.fn()
    const onQuestionSubmit = vi.fn()
    const onSaveHighlight = vi.fn(async () => true)
    const onOpenHighlight = vi.fn()

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-1"
        libraryStatus="indexed"
        libraryMessage="已索引 2 页文本"
        bookTitle="产品链路测试"
        currentPage={1}
        totalPages={2}
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        selectionAnchor={{ pageIndex: 0, positionStart: 0, positionEnd: 8 }}
        evidence={evidence}
        citationChunkIds={[chunkA, chunkB]}
        agentTrace={trace}
        interpretation={`复利需要时间作为条件。[${chunkA}]`}
        followUps={followUps}
        highlights={[highlight]}
        interpretationHistory={[]}
        parsedPages={pages}
        parsedChunks={chunks}
        parserEngine="test"
        coordinateMode="text-only"
        activeChunkId=""
        textQuality={{
          charCount: 38,
          replacementCharRatio: 0,
          controlCharRatio: 0,
          looksUsable: true,
        }}
        zoom={1}
        onBookLoaded={vi.fn()}
        onLibraryStatus={vi.fn()}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={onChunkFocus}
        onPhaseChange={vi.fn()}
        onDeepInterpret={vi.fn()}
        onPlainExplain={vi.fn()}
        onQuestionSubmit={onQuestionSubmit}
        onSaveHighlight={onSaveHighlight}
        onOpenHighlight={onOpenHighlight}
        onDeleteHighlight={vi.fn()}
        onOpenInterpretation={vi.fn()}
        onDeleteInterpretation={vi.fn()}
        onCitationClick={onCitationClick}
        onRegenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    const toolbars = container.querySelectorAll('[data-testid="selection-toolbar"]')
    expect(toolbars).toHaveLength(1)
    expect(textContent(toolbars[0])).toContain("深度解读")
    expect(textContent(container)).toContain("复利来自长期坚持")
    expect(textContent(container)).toContain("风险控制让长期计划不被短期波动打断。")

    click(buttonByText(container, "第 2 页 · 引用"))
    expect(onCitationClick).toHaveBeenCalledWith(chunkB)

    click(buttonByText(container, "提问"))
    const questionBox = inputByPlaceholder(
      container,
      "输入你的问题或解读要求；会围绕当前选区继续检索证据",
    )
    changeInput(questionBox, "那短期波动怎么处理？")
    click(buttonByText(container, "发送"))
    expect(onQuestionSubmit).toHaveBeenCalledWith("那短期波动怎么处理？")

    await clickAsync(buttonByText(container, "保存"))
    await vi.waitFor(() => expect(onSaveHighlight).toHaveBeenCalled())

    expect(buttonByText(container, "文本锚点")).toBeUndefined()
    expect(onOpenHighlight).not.toHaveBeenCalled()
    unmount()
  })
})
