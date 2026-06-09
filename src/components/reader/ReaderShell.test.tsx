import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadPdfDocument, type PDFDocumentProxy } from "@/pdf/pdfjs-compat"
import { open } from "@tauri-apps/plugin-dialog"
import { extractPdfText } from "@/core/pdf-text-extractor"
import { buildReaderOutline } from "./reader-outline"
import {
  READER_SESSION_STORAGE_KEY,
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
  getConvertedBookManifest,
  getConvertedBookPages,
  importPdfWithMineru,
  importPlainBook,
  importZoteroItem,
  isTauriRuntime,
  listenMineruProgress,
  listenSearchIndexProgress,
  listBooks,
  openBookAsset,
  readPdfFile,
  rebuildSearchIndexAsync,
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
  loadPdfDocument: vi.fn(() => {
    throw new Error("unexpected pdfjs loadPdfDocument call in ReaderShell tests")
  }),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}))

vi.mock("@/core/pdf-text-extractor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/pdf-text-extractor")>()
  return {
    ...actual,
    extractPdfText: vi.fn(),
  }
})

vi.mock("@/core/library-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library-api")>()
  return {
    ...actual,
    findBookBySourcePdf: vi.fn(async () => null),
    getConvertedBook: vi.fn(),
    getConvertedBookManifest: vi.fn(),
    getConvertedBookPages: vi.fn(),
    importPdfWithMineru: vi.fn(),
    importPlainBook: vi.fn(),
    importZoteroItem: vi.fn(),
    isTauriRuntime: vi.fn(() => false),
    listenMineruProgress: vi.fn(async () => null),
    listenSearchIndexProgress: vi.fn(async () => null),
    listBooks: vi.fn(async () => []),
    openBookAsset: vi.fn(),
    readPdfFile: vi.fn(),
    rebuildSearchIndexAsync: vi.fn(async (bookId: string, taskId?: string) => ({
      taskId: taskId ?? `search-index-${bookId}`,
      bookId,
    })),
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
    rerender: (nextElement: React.ReactElement) => rerenderClient(root, nextElement),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

async function rerenderClient(root: ReturnType<typeof createRoot>, element: React.ReactElement) {
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function buttonByText(container: ParentNode, text: string, index = 0) {
  return elementsByText(container, "button", text)[index] as HTMLButtonElement
}

function buttonByLabel(container: ParentNode, label: string) {
  return container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
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

function readerViewButtonLabels(container: ParentNode) {
  const group = elementsByText(container, "button", "转换稿").at(0)?.parentElement
  return group
    ? [...group.querySelectorAll("button")].map((button) => textContent(button))
    : []
}

function readerViewButton(container: ParentNode, label: string) {
  const group = elementsByText(container, "button", "转换稿").at(0)?.parentElement
  const button = group
    ? [...group.querySelectorAll("button")].find((candidate) => textContent(candidate) === label)
    : null
  if (!button) {
    throw new Error(`missing reader view button: ${label}`)
  }
  return button
}

async function openImportMenu(container: ParentNode) {
  await clickAsync(buttonByText(container, "导入"))
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

async function dropFiles(element: Element, files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      items: files.map((file) => ({
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      })),
      dropEffect: "copy",
      effectAllowed: "all",
    },
  })
  await act(async () => {
    element.dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()
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
  window.localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn(function scrollToMock(this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object" && typeof options.top === "number") {
      this.scrollTop = options.top
    }
  })
  vi.mocked(open).mockReset()
  vi.mocked(open).mockResolvedValue(null)
  vi.mocked(loadPdfDocument).mockReset()
  vi.mocked(loadPdfDocument).mockImplementation(() => {
    throw new Error("unexpected pdfjs loadPdfDocument call in ReaderShell tests")
  })
  vi.mocked(extractPdfText).mockReset()
  vi.mocked(extractPdfText).mockImplementation(() => {
    throw new Error("unexpected extractPdfText call in ReaderShell tests")
  })
  vi.mocked(isTauriRuntime).mockReturnValue(false)
  vi.mocked(findBookBySourcePdf).mockResolvedValue(null)
  vi.mocked(getConvertedBook).mockReset()
  vi.mocked(getConvertedBookManifest).mockReset()
  vi.mocked(getConvertedBookPages).mockReset()
  vi.mocked(importPdfWithMineru).mockReset()
  vi.mocked(importPlainBook).mockReset()
  vi.mocked(importZoteroItem).mockReset()
  vi.mocked(listenMineruProgress).mockResolvedValue(null)
  vi.mocked(listenSearchIndexProgress).mockResolvedValue(null)
  vi.mocked(listBooks).mockResolvedValue([])
  vi.mocked(openBookAsset).mockResolvedValue({ path: "/tmp/original.pdf" })
  vi.mocked(readPdfFile).mockResolvedValue([])
  vi.mocked(rebuildSearchIndexAsync).mockImplementation(async (bookId: string, taskId?: string) => ({
    taskId: taskId ?? `search-index-${bookId}`,
    bookId,
  }))
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
        anchorText: "第一章 复利来自时间",
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
        anchorText: "1.1 风险控制",
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
        anchorText: "PDF 书签标题",
        firstChunkId: "p1-c1",
      },
    ])
  })

  it("targets the heading chunk when several outline entries share one page", () => {
    const outline = buildReaderOutline(
      [
        {
          pageIndex: 3,
          text: "4. Experiments\n\n4.1. Benchmarks and Setup\n\n4.2. Main Results",
          markdown: "# 4. Experiments\n\n# 4.1. Benchmarks and Setup\n\n# 4.2. Main Results",
        },
      ],
      [
        {
          chunkId: "p4-c3",
          pageIndex: 3,
          text: "4. Experiments",
          markdown: "### [p4-c3] Page 4\n\n4. Experiments",
          rects: [],
        },
        {
          chunkId: "p4-c4",
          pageIndex: 3,
          text: "4.1. Benchmarks and Setup",
          markdown: "### [p4-c4] Page 4\n\n4.1. Benchmarks and Setup",
          rects: [],
        },
        {
          chunkId: "p4-c10",
          pageIndex: 3,
          text: "4.2. Main Results",
          markdown: "### [p4-c10] Page 4\n\n4.2. Main Results",
          rects: [],
        },
      ],
      8,
      [
        {
          id: "pdf-outline-experiments",
          pageIndex: 3,
          title: "Experiments",
          level: 1,
          chunkCount: 0,
          preview: "",
        },
        {
          id: "pdf-outline-benchmarks",
          pageIndex: 3,
          title: "Benchmarks and Setup",
          level: 2,
          chunkCount: 0,
          preview: "",
        },
        {
          id: "pdf-outline-main-results",
          pageIndex: 3,
          title: "Main Results",
          level: 2,
          chunkCount: 0,
          preview: "",
        },
      ],
    )

    expect(outline.map((entry) => [entry.title, entry.anchorText, entry.firstChunkId])).toEqual([
      ["Experiments", "4. Experiments", "p4-c3"],
      ["Benchmarks and Setup", "4.1. Benchmarks and Setup", "p4-c4"],
      ["Main Results", "4.2. Main Results", "p4-c10"],
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
    expect(text).toContain("相关段落")
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

  it("runs Spark with Cmd+E and clears selection with Escape", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const pageText = "第一段正文。快捷键触发 Spark 解读。最后一句。"
    const selectionText = "快捷键触发 Spark"
    const selectionStart = pageText.indexOf(selectionText)
    const onDeepInterpret = vi.fn()
    const onPlainExplain = vi.fn()
    const onClearSelection = vi.fn()

    const { unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-shortcut"
        libraryStatus="indexed"
        libraryMessage=""
        bookTitle="快捷键测试"
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
        onDeepInterpret={onDeepInterpret}
        onPlainExplain={onPlainExplain}
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

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", metaKey: true, bubbles: true }))
      await Promise.resolve()
    })
    expect(onDeepInterpret).toHaveBeenCalledTimes(1)
    expect(onPlainExplain).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await Promise.resolve()
    })
    expect(onClearSelection).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("keeps the selection toolbar mounted briefly so it can fade out", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const pageText = "第一段正文。工具栏淡出测试。最后一句。"
    const selectionText = "工具栏淡出"
    const selectionStart = pageText.indexOf(selectionText)
    vi.useFakeTimers()

    function shell(selection: string) {
      return (
        <ReaderShell
          phase="reading"
          bookId="book-selection"
          libraryStatus="indexed"
          libraryMessage=""
          bookTitle="工具栏淡出测试"
          currentPage={1}
          totalPages={1}
          selectionText={selection}
          selectionRects={[]}
          selectionAnchor={
            selection
              ? {
                  pageIndex: 0,
                  positionStart: selectionStart,
                  positionEnd: selectionStart + selection.length,
                }
              : null
          }
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
        />
      )
    }

    const { container, rerender, unmount } = await renderClient(shell(selectionText))
    expect(container.querySelector('[data-testid="selection-toolbar"]')).not.toBeNull()

    await rerender(shell(""))
    const fadingToolbar = container.querySelector('[data-testid="selection-toolbar"]')
    expect(fadingToolbar).not.toBeNull()
    expect(fadingToolbar?.className).toContain("opacity-0")
    expect(fadingToolbar?.className).toContain("pointer-events-none")

    await act(async () => {
      vi.advanceTimersByTime(181)
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="selection-toolbar"]')).toBeNull()
    unmount()
  })
})

describe("ReaderShell view navigation", () => {
  it("orders reader view tabs as converted text, TLDR, translation, then PDF", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)

    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-tabs"
        libraryStatus="indexed"
        libraryMessage="已打开转换稿"
        bookTitle="标签顺序测试"
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
            text: "1. Introduction\n\n正文。",
            markdown: "## 1. Introduction\n\n正文。",
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 20,
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

    expect(readerViewButtonLabels(container)).toEqual(["转换稿", "TLDR", "对照翻译", "知识体系", "PDF"])
    unmount()
  })

  it("opens knowledge as a full-width top-level view without reader sidebars", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-knowledge-view"
        libraryStatus="indexed"
        libraryMessage="已索引"
        bookTitle="知识体系测试"
        currentPage={1}
        totalPages={1}
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[]}
        agentTrace={[]}
        interpretation=""
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        knowledgeCards={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "复利来自长期坚持。",
            markdown: "复利来自长期坚持。",
          },
        ]}
        parsedChunks={[]}
        parserEngine="mineru-layout"
        coordinateMode="normalized-page-rects"
        activeChunkId=""
        textQuality={{
          charCount: 20,
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

    await clickAsync(readerViewButton(container, "知识体系"))

    const main = container.querySelector("main") as HTMLElement
    expect(main.style.gridTemplateColumns).toBe("0px minmax(0,1fr) 0px")
    expect(textContent(container)).toContain("暂无知识卡片")
    expect(textContent(container)).not.toContain("这是与转换稿同级")
    expect(textContent(container)).not.toContain("可回跳引用")
    unmount()
  })

  it("keeps outline clicks inside the translation view", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    vi.mocked(loadPdfDocument).mockResolvedValue({
      numPages: 2,
      cleanup: vi.fn(),
      getOutline: vi.fn(async () => []),
    } as unknown as PDFDocumentProxy)
    const translation: TranslationStatus = {
      bookId: "book-view-outline",
      totalPages: 2,
      completedPages: 2,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          sourceMarkdown: "## 1. Introduction\n\nIntro source.",
          translatedMarkdown: "## 1. 引言\n\n引言译文。",
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
        {
          pageIndex: 1,
          sourceMarkdown: "## 2. Results\n\nResults source.",
          translatedMarkdown: "## 2. 结果\n\n结果译文。",
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)

    function Harness() {
      const [currentPage, setCurrentPage] = useState(1)
      return (
        <ReaderShell
          phase="reading"
          bookId="book-view-outline"
          libraryStatus="indexed"
          libraryMessage="已打开转换稿"
          bookTitle="视图导航测试"
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
          parsedPages={[
            {
              pageIndex: 0,
              text: "1. Introduction\n\nIntro source.",
              markdown: "## 1. Introduction\n\nIntro source.",
            },
            {
              pageIndex: 1,
              text: "2. Results\n\nResults source.",
              markdown: "## 2. Results\n\nResults source.",
            },
          ]}
          parsedChunks={[]}
          parserEngine="mineru-layout"
          coordinateMode="normalized-page-rects"
          activeChunkId=""
          textQuality={{
            charCount: 60,
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
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-view-outline"))
    expect(container.querySelector("[data-translation-scroller]")).not.toBeNull()
    await clickAsync(buttonByText(container, "Results"))
    expect(container.querySelector("[data-translation-scroller]")).not.toBeNull()
    expect(textContent(container)).toContain("对照翻译")
    expect(textContent(container)).not.toContain("转换稿主视图")
    unmount()
  })

  it("hides the converted outline in PDF view", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    window.localStorage.setItem("focused-reading.onboarding.seen.v1", "1")
    window.localStorage.setItem(
      READER_SESSION_STORAGE_KEY,
      JSON.stringify({
        bookId: "book-pdf-outline",
        currentPage: 1,
        readerView: "pdf",
      }),
    )
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    const loadedPdf = {
      numPages: 2,
      cleanup: vi.fn(),
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 600, height: 800 }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: vi.fn(async () => ({ items: [], styles: Object.create(null) })),
      })),
    } as unknown as PDFDocumentProxy
    vi.mocked(loadPdfDocument).mockResolvedValue(loadedPdf)
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    const manifest = storedBook({
      bookId: "book-pdf-outline",
      title: "PDF 目录测试",
      createdAt: "2026-06-03T03:00:00Z",
      totalPages: 2,
      originalPdfPath: "/tmp/pdf-outline/original.pdf",
      textCharCount: 50,
    })
    vi.mocked(listBooks).mockResolvedValue([manifest])
    vi.mocked(getConvertedBookManifest).mockResolvedValue(manifest)
    vi.mocked(getConvertedBookPages).mockResolvedValue({
      bookId: "book-pdf-outline",
      startPage: 0,
      endPage: 2,
      totalPages: 2,
      text: "1. Introduction\n\nIntro source.\n\n2. Results\n\nResults source.",
      markdown: "## 1. Introduction\n\nIntro source.\n\n## 2. Results\n\nResults source.",
      pages: [
        {
          pageIndex: 0,
          text: "1. Introduction\n\nIntro source.",
          markdown: "## 1. Introduction\n\nIntro source.",
        },
        {
          pageIndex: 1,
          text: "2. Results\n\nResults source.",
          markdown: "## 2. Results\n\nResults source.",
        },
      ],
      chunks: [],
    })

    function Harness() {
      const [phase, setPhase] = useState<ReaderPhase>("empty")
      const [bookTitle, setBookTitle] = useState("未导入 PDF")
      const [bookId, setBookId] = useState("")
      const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("idle")
      const [currentPage, setCurrentPage] = useState(1)
      const [totalPages, setTotalPages] = useState(0)
      const [pages, setPages] = useState<ParsedPage[]>([])
      const [chunks, setChunks] = useState<ParsedChunk[]>([])
      return (
        <ReaderShell
          phase={phase}
          bookId={bookId}
          libraryStatus={libraryStatus}
          libraryMessage=""
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
          parsedPages={pages}
          parsedChunks={chunks}
          parserEngine="mineru-layout"
          coordinateMode="normalized-page-rects"
          activeChunkId=""
          textQuality={{
            charCount: 50,
            replacementCharRatio: 0,
            controlCharRatio: 0,
            looksUsable: true,
          }}
          zoom={1}
          onBookLoaded={(title, pageCount) => {
            setBookTitle(title)
            setTotalPages(pageCount)
          }}
          onLibraryStatus={(status, _message, nextBookId) => {
            setLibraryStatus(status)
            if (nextBookId) {
              setBookId(nextBookId)
            }
          }}
          onParsedDocument={(nextPages, nextChunks) => {
            setPages(nextPages)
            setChunks(nextChunks)
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
    await vi.waitFor(() => expect(readPdfFile).toHaveBeenCalledWith("/tmp/pdf-outline/original.pdf"))
    expect(readPdfFile).toHaveBeenCalledWith("/tmp/pdf-outline/original.pdf")
    await vi.waitFor(() => expect(textContent(container)).toContain("原 PDF 校对"))

    expect(container.querySelector("[data-readable-page]")).toBeNull()
    expect(container.querySelector("[data-translation-scroller]")).toBeNull()
    expect(container.querySelector("[data-reader-outline-panel]")).toBeNull()
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
  it("offers a zero-key sample book path from the first empty state", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const onOpenSampleBook = vi.fn()
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
        onOpenSampleBook={onOpenSampleBook}
      />,
    )

    expect(textContent(container)).toContain("先体验框选精读")
    expect(textContent(container)).toContain("无需配置 key")
    expect(textContent(container)).toContain("将 PDF 拖到此处")
    expect(textContent(container)).toContain("先看一次框选精读链路")
    await clickAsync(buttonByText(container, "打开示例书"))
    expect(onOpenSampleBook).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("persists first-run onboarding dismissal and lets the empty state reopen it", async () => {
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
        onOpenSampleBook={vi.fn()}
      />,
    )

    expect(textContent(container)).toContain("先看一次框选精读链路")
    await clickAsync(buttonByText(container, "关闭"))
    expect(window.localStorage.getItem("focused-reading.onboarding.seen.v1")).toBe("1")
    expect(textContent(container)).not.toContain("先看一次框选精读链路")

    await clickAsync(buttonByText(container, "查看引导"))
    expect(textContent(container)).toContain("先看一次框选精读链路")
    unmount()
  })

  it("imports a dropped PDF in browser preview mode", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const loadedPdf = { numPages: 1, cleanup: vi.fn() } as unknown as PDFDocumentProxy
    vi.mocked(loadPdfDocument).mockResolvedValue(loadedPdf)
    vi.mocked(extractPdfText).mockResolvedValue({
      engine: "pdfjs-browser",
      coordinateMode: "normalized-page-rects",
      quality: {
        charCount: 8,
        replacementCharRatio: 0,
        controlCharRatio: 0,
        looksUsable: true,
      },
      text: "拖拽导入正文",
      markdown: "## Page 1\n\n拖拽导入正文",
      pages: [
        {
          pageIndex: 0,
          text: "拖拽导入正文",
          markdown: "## Page 1\n\n拖拽导入正文",
        },
      ],
      chunks: [
        {
          chunkId: "drop-p1-c1",
          pageIndex: 0,
          text: "拖拽导入正文",
          markdown: "### [drop-p1-c1] Page 1\n\n拖拽导入正文",
          rects: [],
        },
      ],
    })
    const onBookLoaded = vi.fn()
    const onParsedDocument = vi.fn()
    const onPhaseChange = vi.fn()
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
        onBookLoaded={onBookLoaded}
        onLibraryStatus={vi.fn()}
        onParsedDocument={onParsedDocument}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={onPhaseChange}
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

    const droppedPdf = {
      name: "drop-book.pdf",
      type: "application/pdf",
      size: 4,
      lastModified: 1,
      arrayBuffer: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer),
    } as unknown as File
    await dropFiles(container.querySelector('[data-testid="empty-import-dropzone"]')!, [droppedPdf])

    await vi.waitFor(() => {
      expect(loadPdfDocument).toHaveBeenCalled()
      expect(extractPdfText).toHaveBeenCalledWith(loadedPdf, {
        onProgress: expect.any(Function),
      })
      expect(onBookLoaded).toHaveBeenCalledWith("drop-book", 1)
      expect((droppedPdf as File & { arrayBuffer: ReturnType<typeof vi.fn> }).arrayBuffer).toHaveBeenCalled()
      expect(onParsedDocument).toHaveBeenCalledWith(
        [
          {
            pageIndex: 0,
            text: "拖拽导入正文",
            markdown: "## Page 1\n\n拖拽导入正文",
          },
        ],
        [
          {
            chunkId: "drop-p1-c1",
            pageIndex: 0,
            text: "拖拽导入正文",
            markdown: "### [drop-p1-c1] Page 1\n\n拖拽导入正文",
            rects: [],
          },
        ],
        "拖拽导入正文",
        "## Page 1\n\n拖拽导入正文",
        expect.objectContaining({
          originalPdfPath: "drop-book.pdf",
          sourcePdfPath: "drop-book.pdf",
          sourcePdfFingerprint: expect.stringMatching(/^browser-/),
        }),
      )
    })
    expect(onPhaseChange).toHaveBeenCalledWith("reading")
    unmount()
  })

  it("opens an import choice panel before choosing an import source", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    window.localStorage.setItem("focused-reading.onboarding.seen.v1", "1")
    const onOpenSampleBook = vi.fn()
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
        onOpenSampleBook={onOpenSampleBook}
      />,
    )

    await openImportMenu(container)

    expect(textContent(container)).toContain("本地 PDF")
    expect(textContent(container)).toContain("Zotero")
    expect(textContent(container)).toContain("MinerU 输出目录")
    expect(textContent(container)).toContain("打开示例书")
    expect(buttonByText(container, "MinerU 输出目录").disabled).toBe(true)

    await clickAsync(buttonByText(container, "打开示例书"))
    expect(onOpenSampleBook).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("rejects non-PDF files dropped onto the empty import area", async () => {
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

    await dropFiles(container.querySelector('[data-testid="empty-import-dropzone"]')!, [
      new File(["not pdf"], "notes.txt", { type: "text/plain" }),
    ])

    expect(textContent(container)).toContain("请拖入 PDF 文件")
    expect(loadPdfDocument).not.toHaveBeenCalled()
    expect(extractPdfText).not.toHaveBeenCalled()
    unmount()
  })

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
    expect(visibleText).toContain("目录")
    expect(visibleText).not.toContain("目录与索引")
    expect(container.querySelector('[aria-label^="阅读进度"]')).toBeNull()
    expect(container.querySelector('[aria-label="顶部跳转页码"]')).toBeNull()
    expect(container.querySelector('[aria-label="跳转页码"]')).toBeNull()
    expect(container.querySelector('[aria-label="上一页"]')).toBeNull()
    expect(container.querySelector('[aria-label="下一页"]')).toBeNull()
    expect(visibleText).toContain("1.1目录结构")
    expect(visibleText).toContain("1.2TTC 指标")
    expect(visibleText).toContain("第二页正文包含 TTC。")
    expect(visibleText).not.toContain("第 2 页 · 第二页正文包含 TTC。")
    expect(visibleText).not.toContain("这个指标可从公式理解。（引用）")
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

    expect(textContent(container)).toContain("浏览器版")
    expect(textContent(container)).toContain("浏览器版会使用已转换文本做本地兜底解读")
    await openImportMenu(container)
    expect(buttonByText(container, "Zotero").title).toContain("此功能需要桌面版")
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

  it("opens settings from the local fallback key guidance", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    const { container, unmount } = await renderClient(
      <ReaderShell
        phase="reading"
        bookId="book-local"
        libraryStatus="indexed"
        libraryMessage=""
        bookTitle="本地兜底书籍"
        currentPage={1}
        totalPages={1}
        selectionText="复利来自长期坚持"
        selectionRects={[]}
        selectionAnchor={null}
        evidence={[{ chunkId: "b12345678-p1-c1-abcdef12", title: "第 1 页", pageIndex: 0 }]}
        agentTrace={[]}
        interpretation="已使用本地证据生成回答。[b12345678-p1-c1-abcdef12]"
        answerSource="local_fallback"
        interpretationError="DeepSeek 还没有配置 API Key，当前已改用本地兜底。请在设置中填入 API Key 后重试完整 LLM 解读。"
        followUps={[]}
        highlights={[]}
        interpretationHistory={[]}
        parsedPages={[
          {
            pageIndex: 0,
            text: "复利来自长期坚持",
            markdown: "复利来自长期坚持",
          },
        ]}
        parsedChunks={[]}
        parserEngine="pdfjs"
        coordinateMode="text-only"
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

    expect(container.querySelector('[data-testid="settings-panel"]')).toBeNull()
    await clickAsync(buttonByText(container, "打开设置"))
    expect(container.querySelector('[data-testid="settings-panel"]')).not.toBeNull()
    expect(textContent(container)).toContain("保存全部")
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
    const { ReaderShell } = await import("./ReaderShell")
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

  it("opens stored desktop books through a manifest and page window instead of the full asset", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const manifest = storedBook({
      bookId: "book-windowed",
      title: "长书",
      createdAt: "2026-06-03T02:00:00Z",
      totalPages: 120,
      textCharCount: 800000,
      markdownCharCount: 860000,
      originalPdfPath: "",
    })
    vi.mocked(listBooks).mockResolvedValue([manifest])
    vi.mocked(getConvertedBookManifest).mockResolvedValue(manifest)
    vi.mocked(getConvertedBookPages).mockResolvedValue({
      bookId: "book-windowed",
      startPage: 0,
      endPage: 48,
      totalPages: 120,
      text: "第一页窗口正文",
      markdown: "## Page 1\n\n第一页窗口正文",
      pages: [
        {
          pageIndex: 0,
          text: "第一页窗口正文",
          markdown: "## Page 1\n\n第一页窗口正文",
        },
      ],
      chunks: [
        {
          chunkId: "p1-c1",
          pageIndex: 0,
          text: "第一页窗口正文",
          markdown: "### [p1-c1] Page 1\n\n第一页窗口正文",
          rects: [],
        },
      ],
    })
    const onParsedDocument = vi.fn()
    const onLibraryStatus = vi.fn()
    const onBookLoaded = vi.fn()

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

    await vi.waitFor(() => expect(listBooks).toHaveBeenCalled())
    await clickAsync(buttonByText(container, "书架"))
    await clickAsync(buttonByText(container, "长书"))

    await vi.waitFor(() => expect(getConvertedBookManifest).toHaveBeenCalledWith("book-windowed"))
    expect(getConvertedBookPages).toHaveBeenCalledWith("book-windowed", 0, 48)
    expect(getConvertedBook).not.toHaveBeenCalled()
    expect(onBookLoaded).toHaveBeenCalledWith("长书", 120)
    expect(onParsedDocument).toHaveBeenCalled()
    const [pages] = onParsedDocument.mock.calls[0] as [ParsedPage[]]
    expect(pages).toHaveLength(120)
    expect(pages[0]).toMatchObject({ pageIndex: 0, loaded: true })
    expect(pages[1]).toMatchObject({ pageIndex: 1, loaded: false })
    expect(onLibraryStatus).toHaveBeenCalledWith(
      "indexed",
      "已打开 Markdown 转换稿：800000 字正文",
      "book-windowed",
    )
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
    expect(textContent(toolbar)).toContain("译文进度 1/1")
    expect(textContent(toolbar)).toContain("重新翻译")
    expect(textContent(toolbar)).not.toContain("继续翻译")
    expect(textContent(toolbar)).not.toContain("重试失败")
    expect(textContent(scroller)).toContain("English source.")
    expect(textContent(scroller)).toContain("中文译文。")
    expect(textContent(scroller)).not.toContain("本地缓存")
    unmount()
  })

  it("virtualizes the translation view and requests missing page windows", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const pages: ParsedPage[] = Array.from({ length: 80 }, (_, index) => ({
      pageIndex: index,
      text: index === 0 ? "First loaded source." : "",
      markdown: index === 0 ? "## Page 1\n\nFirst loaded source." : "",
      loaded: index === 0,
    }))
    const chunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "First loaded source.",
        markdown: "### [p1-c1] Page 1\n\nFirst loaded source.",
        rects: [],
      },
    ]
    const translation: TranslationStatus = {
      bookId: "book-translation-virtual",
      totalPages: 80,
      completedPages: 1,
      failedPages: 0,
      running: false,
      provider: "deep_seek",
      model: "deepseek-v4-flash",
      pages: [
        {
          pageIndex: 0,
          sourceMarkdown: "## Page 1\n\nFirst loaded source.",
          translatedMarkdown: "第一页译文。",
          status: "done",
          error: "",
          provider: "deep_seek",
          model: "deepseek-v4-flash",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    }
    vi.mocked(translationStatus).mockResolvedValue(translation)
    vi.mocked(getConvertedBookPages).mockImplementation(async (bookId, startPage, pageCount) => {
      const endPage = Math.min(80, startPage + pageCount)
      const windowPages = Array.from({ length: endPage - startPage }, (_, offset) => {
        const pageIndex = startPage + offset
        return {
          pageIndex,
          text: pageIndex === 0 ? "First loaded source." : `Loaded source ${pageIndex + 1}.`,
          markdown:
            pageIndex === 0
              ? "## Page 1\n\nFirst loaded source."
              : `## Page ${pageIndex + 1}\n\nLoaded source ${pageIndex + 1}.`,
          loaded: true,
        }
      })
      return {
        bookId,
        startPage,
        endPage,
        totalPages: 80,
        text: windowPages.map((page) => page.text).join("\n\n"),
        markdown: windowPages.map((page) => page.markdown).join("\n\n"),
        pages: windowPages,
        chunks: startPage === 0 ? chunks : [],
      }
    })

    function Harness() {
      const [currentPage, setCurrentPage] = useState(1)
      return (
        <ReaderShell
          phase="reading"
          bookId="book-translation-virtual"
          libraryStatus="indexed"
          libraryMessage="已打开转换稿"
          bookTitle="长翻译书"
          currentPage={currentPage}
          totalPages={80}
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
          parsedChunks={chunks}
          parserEngine="mineru-layout"
          coordinateMode="normalized-page-rects"
          activeChunkId=""
          textQuality={{
            charCount: 4000,
            replacementCharRatio: 0,
            controlCharRatio: 0,
            looksUsable: true,
          }}
          zoom={1}
          onBookLoaded={vi.fn()}
          onLibraryStatus={vi.fn()}
          onParsedDocument={vi.fn()}
          onParsedDocumentWindow={vi.fn()}
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
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-translation-virtual"))
    const scroller = container.querySelector("[data-translation-scroller]") as HTMLElement
    expect(scroller.querySelectorAll("[data-translation-page]").length).toBeLessThan(80)
    expect(textContent(scroller)).toContain("First loaded source.")

    Object.defineProperty(scroller, "scrollTop", { value: 760 * 50, writable: true, configurable: true })
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(
        vi.mocked(getConvertedBookPages).mock.calls.some(
          ([bookId, startPage]) => bookId === "book-translation-virtual" && startPage > 0,
        ),
      ).toBe(true)
    })
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

    await vi.waitFor(() => expect(textContent(container)).toContain("Second page source."))
    expect(textContent(container)).not.toContain("第 2 / 2 页")
    expect(scroller.scrollTo).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    unmount()
  })

  it("does not snap translation scroll after page measurements refresh", async () => {
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
      bookId: "book-measure-scroll",
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
      const [bookPages, setBookPages] = useState(pages)
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setBookPages((items) =>
                items.map((page) =>
                  page.pageIndex === 1
                    ? { ...page, markdown: `${page.markdown}\n\nExtra measured paragraph.` }
                    : page,
                ),
              )
            }
          >
            mutate measured height
          </button>
          <ReaderShell
            phase="reading"
            bookId="book-measure-scroll"
            libraryStatus="indexed"
            libraryMessage="已打开转换稿"
            bookTitle="测量滚动测试"
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
            parsedPages={bookPages}
            parsedChunks={[]}
            parserEngine="mineru-layout"
            coordinateMode="normalized-page-rects"
            activeChunkId=""
            textQuality={{
              charCount: 80,
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
        </>
      )
    }

    const { container, unmount } = await renderClient(<Harness />)
    await clickAsync(buttonByText(container, "对照翻译"))
    await vi.waitFor(() => expect(translationStatus).toHaveBeenCalledWith("book-measure-scroll"))
    const scroller = container.querySelector("[data-translation-scroller]") as HTMLElement
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
    const articles = scroller.querySelectorAll("article")
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

    act(() => {
      scroller.dispatchEvent(new Event("scroll"))
    })
    await vi.waitFor(() => expect(textContent(container)).toContain("Second page source."))
    vi.mocked(scroller.scrollTo).mockClear()

    await clickAsync(buttonByText(container, "mutate measured height"))
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      await Promise.resolve()
    })

    expect(scroller.scrollTo).not.toHaveBeenCalled()
    unmount()
  })

  it("does not expose footer pagination in the translation workflow", async () => {
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
    expect(container.querySelector("[data-translation-scroller]")).not.toBeNull()
    expect(container.querySelector('[aria-label="上一页"]')).toBeNull()
    expect(container.querySelector('[aria-label="下一页"]')).toBeNull()
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
          translatedMarkdown: "[[B001]]\n中文译文包含 ALFWorld。",
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
    expect(onSelection.mock.calls.at(-1)?.[0]).toContain("English source.")
    expect(onSelection.mock.calls.at(-1)?.[2]).toMatchObject({
      pageIndex: 0,
      positionStart: 0,
      positionEnd: 15,
    })

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
        selectionText="English source."
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
    click(buttonByText(selectedContainer, "Spark"))
    expect(onDeepInterpret).toHaveBeenCalledTimes(1)
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
    vi.mocked(loadPdfDocument).mockResolvedValue(loadedPdf)
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
    vi.mocked(getConvertedBookManifest).mockResolvedValue(storedBook({
      bookId: "book-desktop",
      title: "后端转换书",
      totalPages: 1,
      textCharCount: 10,
      markdownCharCount: 22,
      textPath: "/tmp/book-desktop/book.txt",
      markdownPath: "/tmp/book-desktop/book.md",
      originalPdfPath: "/tmp/book-desktop/original.pdf",
      sourcePdfPath: "/tmp/desk-book.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-test",
      parserEngine: "mineru-layout",
      coordinateMode: "normalized-page-rects",
      quality,
      createdAt: "2026-06-03T02:00:00Z",
    }))
    vi.mocked(getConvertedBookPages).mockResolvedValue({
      bookId: "book-desktop",
      startPage: 0,
      endPage: 1,
      totalPages: 1,
      text: "后端生成 TXT 内容",
      markdown: "## Page 1\n\n后端生成 TXT 内容",
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
    await openImportMenu(container)
    await clickAsync(buttonByLabel(container, "导入本地 PDF"))

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
      expect(getConvertedBookManifest).toHaveBeenCalledWith("book-desktop")
      expect(getConvertedBookPages).toHaveBeenCalledWith("book-desktop", 0, 48)
      expect(getConvertedBook).not.toHaveBeenCalled()
    })
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    })
    expect(readPdfFile).toHaveBeenCalledWith("/tmp/desk-book.pdf")
    expect(findBookBySourcePdf).toHaveBeenCalledWith("/tmp/desk-book.pdf")
    expect(onParsedDocument).toHaveBeenCalledWith(
      [{ ...pages[0], loaded: true }],
      chunks,
      "后端生成 TXT 内容",
      "## Page 1\n\n后端生成 TXT 内容",
      expect.objectContaining({
        parserEngine: "mineru-layout",
        coordinateMode: "normalized-page-rects",
        quality,
        textPath: "/tmp/book-desktop/book.txt",
        markdownPath: "/tmp/book-desktop/book.md",
        originalPdfPath: "/tmp/book-desktop/original.pdf",
        sourcePdfPath: "/tmp/desk-book.pdf",
        sourcePdfFingerprint: "pdf-fnv1a64-test",
        tldrText: null,
      }),
    )
    expect(onLibraryStatus).toHaveBeenCalledWith(
      "indexed",
      "MinerU 已解析 10 字，并生成 Markdown 转换稿",
      "book-desktop",
    )
    expect(textContent(container)).toContain("后端生成 TXT 内容")
    expect(textContent(container)).toContain("未识别到章节标题目录")
    expect(textContent(container)).not.toContain("目录与索引")
    expect(textContent(container)).not.toContain("normalized-page-rects")
    unmount()
  })

  it("keeps the current converted book readable when a new desktop import fails", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(open).mockResolvedValue("/tmp/new-broken.pdf")
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    const loadedPdf = { numPages: 10, cleanup: vi.fn() } as unknown as PDFDocumentProxy
    vi.mocked(loadPdfDocument).mockResolvedValue(loadedPdf)
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

    await openImportMenu(container)
    await clickAsync(buttonByLabel(container, "导入本地 PDF"))
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
    expect(textContent(container)).toContain("MinerU 云端解析失败")
    expect(textContent(container)).toContain("已保留当前阅读内容")
    expect(textContent(container)).toContain("MinerU API Token 未配置或无效")
    expect(onParsedDocument).not.toHaveBeenCalled()
    expect(onBookLoaded).not.toHaveBeenCalled()
    expect(onLibraryStatus).not.toHaveBeenCalledWith(
      "error",
      "MinerU API Token 未配置或无效。请在设置里填入 MinerU token 后重试。",
    )
    expect(loadedPdf.cleanup).toHaveBeenCalled()
    unmount()
  })

  it("imports a TXT or EPUB book through the Rust backend without MinerU", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(open).mockResolvedValue("/tmp/novel.epub")
    vi.mocked(importPlainBook).mockResolvedValue({
      bookId: "book-epub",
      pageCount: 2,
      chunkCount: 2,
      textCharCount: 18,
      markdownCharCount: 32,
      textPath: "/tmp/book-epub/novel.txt",
      markdownPath: "/tmp/book-epub/novel.md",
      originalPdfPath: "/tmp/book-epub/novel.epub",
      sourcePdfPath: "/tmp/novel.epub",
      sourcePdfFingerprint: "pdf-fnv1a64-epub",
    })
    const pages: ParsedPage[] = [
      {
        pageIndex: 0,
        text: "第一章\n电子书正文",
        markdown: "# 第一章\n\n电子书正文",
      },
      {
        pageIndex: 1,
        text: "第二章\n继续阅读",
        markdown: "# 第二章\n\n继续阅读",
      },
    ]
    const chunks: ParsedChunk[] = [
      {
        chunkId: "p1-c1",
        pageIndex: 0,
        text: "第一章\n电子书正文",
        markdown: "### [p1-c1] Page 1\n\n# 第一章\n\n电子书正文",
        rects: [],
      },
      {
        chunkId: "p2-c1",
        pageIndex: 1,
        text: "第二章\n继续阅读",
        markdown: "### [p2-c1] Page 2\n\n# 第二章\n\n继续阅读",
        rects: [],
      },
    ]
    const quality: TextQuality = {
      charCount: 18,
      replacementCharRatio: 0,
      controlCharRatio: 0,
      looksUsable: true,
    }
    vi.mocked(getConvertedBookManifest).mockResolvedValue(storedBook({
      bookId: "book-epub",
      title: "novel",
      totalPages: 2,
      textCharCount: 18,
      markdownCharCount: 32,
      textPath: "/tmp/book-epub/novel.txt",
      markdownPath: "/tmp/book-epub/novel.md",
      originalPdfPath: "/tmp/book-epub/novel.epub",
      sourcePdfPath: "/tmp/novel.epub",
      sourcePdfFingerprint: "pdf-fnv1a64-epub",
      parserEngine: "text-import-epub",
      coordinateMode: "text-only",
      quality,
      createdAt: "2026-06-03T02:00:00Z",
    }))
    vi.mocked(getConvertedBookPages).mockResolvedValue({
      bookId: "book-epub",
      startPage: 0,
      endPage: 2,
      totalPages: 2,
      text: "第一章\n电子书正文\n\n第二章\n继续阅读",
      markdown: "# 第一章\n\n电子书正文\n\n# 第二章\n\n继续阅读",
      pages,
      chunks,
    })
    const onParsedDocument = vi.fn()
    const onLibraryStatus = vi.fn()

    function Harness() {
      const [phase, setPhase] = useState<ReaderPhase>("empty")
      const [bookId, setBookId] = useState("")
      const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("idle")
      const [bookTitle, setBookTitle] = useState("未导入书籍")
      const [totalPages, setTotalPages] = useState(0)
      const [loadedPages, setLoadedPages] = useState<ParsedPage[]>([])
      const [loadedChunks, setLoadedChunks] = useState<ParsedChunk[]>([])
      const [parserEngine, setParserEngine] = useState("")
      const [coordinateMode, setCoordinateMode] = useState("")

      return (
        <ReaderShell
          phase={phase}
          bookId={bookId}
          libraryStatus={libraryStatus}
          libraryMessage=""
          bookTitle={bookTitle}
          currentPage={1}
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
          zoom={1}
          onBookLoaded={(title, pageCount) => {
            setBookTitle(title)
            setTotalPages(pageCount)
          }}
          onLibraryStatus={(status, message = "", nextBookId) => {
            onLibraryStatus(status, message, nextBookId)
            setLibraryStatus(status)
            if (nextBookId) setBookId(nextBookId)
          }}
          onParsedDocument={(nextPages, nextChunks, text, markdown, metadata) => {
            onParsedDocument(nextPages, nextChunks, text, markdown, metadata)
            setLoadedPages(nextPages)
            setLoadedChunks(nextChunks)
            setParserEngine(metadata?.parserEngine ?? "")
            setCoordinateMode(metadata?.coordinateMode ?? "")
          }}
          onPageChange={vi.fn()}
          onVisiblePageChange={vi.fn()}
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
    const readPdfFileCallsBeforeImport = vi.mocked(readPdfFile).mock.calls.length
    await openImportMenu(container)
    await clickAsync(buttonByLabel(container, "导入 TXT 或 EPUB 电子书"))

    await vi.waitFor(() => {
      expect(importPlainBook).toHaveBeenCalledWith("/tmp/novel.epub", "novel")
      expect(getConvertedBookManifest).toHaveBeenCalledWith("book-epub")
      expect(getConvertedBookPages).toHaveBeenCalledWith("book-epub", 0, 48)
    })
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "Text / EPUB", extensions: ["txt", "text", "epub"] }],
    })
    expect(importPdfWithMineru).not.toHaveBeenCalled()
    expect(vi.mocked(readPdfFile).mock.calls.length).toBe(readPdfFileCallsBeforeImport)
    expect(onParsedDocument).toHaveBeenCalledWith(
      pages.map((page) => ({ ...page, loaded: true })),
      chunks,
      "第一章\n电子书正文\n\n第二章\n继续阅读",
      "# 第一章\n\n电子书正文\n\n# 第二章\n\n继续阅读",
      expect.objectContaining({
        parserEngine: "text-import-epub",
        coordinateMode: "text-only",
        originalPdfPath: "/tmp/book-epub/novel.epub",
        sourcePdfPath: "/tmp/novel.epub",
      }),
    )
    expect(onLibraryStatus).toHaveBeenCalledWith(
      "indexed",
      "已导入电子书：18 字、2 个 chunk",
      "book-epub",
    )
    expect(textContent(container)).toContain("电子书正文")
    expect(buttonByText(container, "PDF").hasAttribute("disabled")).toBe(true)
    unmount()
  })

  it("renders structured import error suggestions in user-facing language", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(open).mockResolvedValue("/tmp/network-fail.pdf")
    vi.mocked(readPdfFile).mockResolvedValue([37, 80, 68, 70])
    const loadedPdf = { numPages: 3, cleanup: vi.fn() } as unknown as PDFDocumentProxy
    vi.mocked(loadPdfDocument).mockResolvedValue(loadedPdf)
    vi.mocked(importPdfWithMineru).mockRejectedValue({
      code: "network",
      message: "ECONNRESET while uploading to MinerU",
      suggestion: "请检查网络、代理或云端服务状态后重试。",
    })
    const onLibraryStatus = vi.fn()
    const onPhaseChange = vi.fn()

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
        onLibraryStatus={onLibraryStatus}
        onParsedDocument={vi.fn()}
        onPageChange={vi.fn()}
        onVisiblePageChange={vi.fn()}
        onZoomChange={vi.fn()}
        onSelection={vi.fn()}
        onActiveChunk={vi.fn()}
        onChunkFocus={vi.fn()}
        onPhaseChange={onPhaseChange}
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

    await openImportMenu(container)
    await clickAsync(buttonByLabel(container, "导入本地 PDF"))

    await vi.waitFor(() => {
      expect(importPdfWithMineru).toHaveBeenCalled()
      expect(onLibraryStatus).toHaveBeenCalledWith(
        "error",
        "无法连接云端解析服务。建议：请检查网络、代理或云端服务状态后重试。",
      )
      expect(onPhaseChange).toHaveBeenCalledWith("error")
    })
    expect(textContent(container)).toContain("无法连接云端解析服务")
    expect(textContent(container)).toContain("建议：请检查网络、代理或云端服务状态后重试")
    expect(textContent(container)).not.toContain("ECONNRESET")
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
    vi.mocked(loadPdfDocument).mockResolvedValue(loadedPdf)
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
    const quality: TextQuality = {
      charCount: 12,
      replacementCharRatio: 0,
      controlCharRatio: 0,
      looksUsable: true,
    }
    vi.mocked(getConvertedBookManifest).mockResolvedValue(storedBook({
      bookId: "book-zotero",
      title: "RiskNet",
      totalPages: 2,
      textCharCount: 12,
      markdownCharCount: 22,
      textPath: "/tmp/book-zotero/book.txt",
      markdownPath: "/tmp/book-zotero/book.md",
      originalPdfPath: "/tmp/book-zotero/original.pdf",
      sourcePdfPath: "/Users/anbc/Zotero/storage/SICPQR3S/risknet.pdf",
      sourcePdfFingerprint: "pdf-fnv1a64-zotero",
      parserEngine: "mineru-layout",
      coordinateMode: "normalized-page-rects",
      quality,
      createdAt: "2026-06-03T02:00:00Z",
    }))
    vi.mocked(getConvertedBookPages).mockResolvedValue({
      bookId: "book-zotero",
      startPage: 0,
      endPage: 2,
      totalPages: 2,
      text: "Zotero 导入正文。",
      markdown: "## Page 1\n\nZotero 导入正文。",
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

    await openImportMenu(container)
    await clickAsync(buttonByLabel(container, "从 Zotero 导入"))
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
    expect(getConvertedBookManifest).toHaveBeenCalledWith("book-zotero")
    expect(getConvertedBookPages).toHaveBeenCalledWith("book-zotero", 0, 48)
    expect(getConvertedBook).not.toHaveBeenCalled()
    expect(readPdfFile).toHaveBeenCalledWith("/tmp/book-zotero/original.pdf")
    expect(onParsedDocument).toHaveBeenCalledWith(
      [{ ...pages[0], loaded: true }, { pageIndex: 1, text: "", markdown: "", loaded: false }],
      chunks,
      "Zotero 导入正文。",
      "## Page 1\n\nZotero 导入正文。",
      expect.objectContaining({
        parserEngine: "mineru-layout",
        coordinateMode: "normalized-page-rects",
        quality,
        textPath: "/tmp/book-zotero/book.txt",
        markdownPath: "/tmp/book-zotero/book.md",
        originalPdfPath: "/tmp/book-zotero/original.pdf",
        sourcePdfPath: "/Users/anbc/Zotero/storage/SICPQR3S/risknet.pdf",
        sourcePdfFingerprint: "pdf-fnv1a64-zotero",
        tldrText: null,
      }),
    )
    expect(onLibraryStatus).toHaveBeenCalledWith(
      "indexed",
      "已从 Zotero 导入并云端解析 12 字正文",
      "book-zotero",
    )
    expect(unlistenProgress).toHaveBeenCalled()
    unmount()
  })

  it("explains how to recover when Zotero search finds no local PDF items", async () => {
    const { ReaderShell } = await import("./ReaderShell")
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    vi.mocked(searchZoteroItems).mockResolvedValue([])
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

    await openImportMenu(container)
    await clickAsync(buttonByLabel(container, "从 Zotero 导入"))
    changeInput(inputByPlaceholder(container, "输入论文标题或关键词"), "missing paper")
    await clickAsync(buttonByText(container, "搜索"))

    await vi.waitFor(() => expect(searchZoteroItems).toHaveBeenCalledWith("missing paper", 8))
    expect(textContent(container)).toContain("Zotero 已打开")
    expect(textContent(container)).toContain("PDF 附件仍在本机")
    expect(textContent(container)).toContain("本地 PDF 导入")
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
    expect(buttonByText(container, "Spark").disabled).toBe(false)
    expect(buttonByText(container, "轻量").disabled).toBe(false)
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

    expect(textContent(container)).not.toContain("Markdown")
    expect(textContent(container)).not.toContain("Page 1")
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
      { phase: "retrieve", query: "llm_tool_round_1", chunkIds: [chunkA], note: `检索焦点 [${chunkA}]` },
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
    expect(textContent(toolbars[0])).toContain("Spark")
    expect(textContent(toolbars[0])).toContain("轻量")
    expect(textContent(toolbars[0])).not.toContain("迁移")
    expect(textContent(container)).toContain("复利来自长期坚持")
    expect(textContent(container)).toContain("风险控制让长期计划不被短期波动打断。")
    expect(textContent(container)).toContain("检索轨迹 · 1 步")
    expect(textContent(container)).toContain("模型检索第 1 轮")
    expect(textContent(container)).not.toContain(chunkA)

    click(buttonByText(container, "引用"))
    expect(onCitationClick).toHaveBeenCalledWith(chunkB)

    const questionBox = inputByPlaceholder(
      container,
      "围绕这段继续追问；会检索证据后回答",
    )
    changeInput(questionBox, "那短期波动怎么处理？")
    click(buttonByText(container, "发送"))
    expect(onQuestionSubmit).toHaveBeenCalledWith("那短期波动怎么处理？")

    await clickAsync(buttonByText(toolbars[0], "标记"))
    await vi.waitFor(() => expect(onSaveHighlight).toHaveBeenCalled())

    expect(buttonByText(container, "文本锚点")).toBeUndefined()
    expect(onOpenHighlight).not.toHaveBeenCalled()
    unmount()
  })
})
