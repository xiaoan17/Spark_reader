import type { Meta, StoryObj } from "@storybook/react"
import { ReaderShell } from "./ReaderShell"
import type { SavedInterpretation } from "@/stores/reader-store"

const selectionRects = [
  {
    pageIndex: 0,
    x0: 0.17,
    y0: 0.32,
    x1: 0.76,
    y1: 0.36,
  },
  {
    pageIndex: 0,
    x0: 0.17,
    y0: 0.37,
    x1: 0.68,
    y1: 0.41,
  },
]

const storyChunkId = "b12345678-p1-c1-abcdef12"

const evidence = [
  { chunkId: storyChunkId, title: "第一章 · 复利", pageIndex: 7 },
  { chunkId: "b12345678-p85-c1-11111111", title: "风险与长期主义", pageIndex: 84 },
  { chunkId: "b12345678-p132-c1-22222222", title: "结语 · 时间", pageIndex: 131 },
]

const parsedPages = [
  {
    pageIndex: 0,
    text: "1.1 复利的时间尺度\n\n复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。",
    markdown:
      "## 1.1 复利的时间尺度\n\n复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。",
  },
]

const parsedChunks = [
  {
    chunkId: storyChunkId,
    pageIndex: 0,
    text: parsedPages[0].text,
    markdown: `### [${storyChunkId}] Page 1\n\n复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。`,
    rects: [],
  },
]

const highlights = [
  {
    id: "highlight-1",
    bookId: "book-story",
    selectionText: "复利的力量并不来自某一次惊人的收益",
    prefix: "",
    suffix: "",
    pageIndex: 0,
    positionStart: 0,
    positionEnd: 18,
    rects: selectionRects,
    interpretation: "这是一条已保存解读。",
    createdAt: "2026-05-31T00:00:00Z",
  },
]

const interpretationHistory: SavedInterpretation[] = [
  {
    id: "interpretation-1",
    bookId: "book-story",
    selectionText: "复利的力量并不来自某一次惊人的收益",
    sessionId: "interpretation-1",
    turnIndex: 0,
    pageIndexes: [0],
    evidenceChunkIds: [storyChunkId],
    question: null,
    answer: `这条历史解读会被保存到本地库，并可重新打开。[${storyChunkId}]`,
    answerSource: "llm",
    createdAt: "2026-05-31T00:01:00Z",
  },
]

const meta = {
  title: "Reader/ReaderShell",
  component: ReaderShell,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    phase: "reading",
    bookId: "book-story",
    libraryStatus: "indexed",
    libraryMessage: "已索引 1 页文本",
    bookTitle: "财富公式",
    currentPage: 12,
    totalPages: 163,
    selectionText:
      "复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。",
    selectionRects,
    selectionAnchor: null,
    evidence,
    answerSource: "llm",
    agentTrace: [
      {
        phase: "plan",
        query: null,
        chunkIds: [],
        note: "Plan: 以框选文本为焦点生成检索查询。",
      },
      {
        phase: "retrieve",
        query: "复利 长期 时间",
        chunkIds: [storyChunkId],
        note: "混合检索全书正文。",
      },
    ],
    interpretation:
      `这段文字的直接焦点是：“复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。” [${storyChunkId}]\n\n当前版本先展示本地解读闭环。`,
    followUps: [],
    highlights,
    interpretationHistory,
    parsedPages,
    parsedChunks,
    parserEngine: "pdfjs",
    coordinateMode: "text-only",
    activeChunkId: storyChunkId,
    textQuality: {
      charCount: 34,
      replacementCharRatio: 0,
      controlCharRatio: 0,
      looksUsable: true,
    },
    zoom: 1,
    onBookLoaded: () => undefined,
    onLibraryStatus: () => undefined,
    onParsedDocument: () => undefined,
    onPageChange: () => undefined,
    onVisiblePageChange: () => undefined,
    onZoomChange: () => undefined,
    onSelection: () => undefined,
    onActiveChunk: () => undefined,
    onChunkFocus: () => undefined,
    onPhaseChange: () => undefined,
    onDeepInterpret: () => undefined,
    onPlainExplain: () => undefined,
    onQuestionSubmit: () => undefined,
    onSaveHighlight: async () => true,
    onOpenHighlight: () => undefined,
    onDeleteHighlight: () => undefined,
    onOpenInterpretation: () => undefined,
    onDeleteInterpretation: () => undefined,
    onCitationClick: () => undefined,
    onRegenerate: () => undefined,
    onStop: () => undefined,
  },
} satisfies Meta<typeof ReaderShell>

export default meta
type Story = StoryObj<typeof meta>

export const Reading: Story = {}

export const Planning: Story = {
  args: {
    phase: "planning",
  },
}

export const Retrieving: Story = {
  args: {
    phase: "retrieving",
  },
}

export const Error: Story = {
  args: {
    phase: "error",
  },
}

export const EmptySelection: Story = {
  args: {
    phase: "empty",
    selectionText: "",
    selectionRects: [],
    evidence: [],
  },
}

export const IndexedTextOnly: Story = {
  args: {
    libraryMessage: "已索引文本；未建立 provider 向量索引",
  },
}

export const ZoteroImportEmpty: Story = {
  args: {
    phase: "empty",
    bookId: "",
    libraryStatus: "idle",
    libraryMessage: "",
    bookTitle: "未导入 PDF",
    currentPage: 1,
    totalPages: 0,
    selectionText: "",
    selectionRects: [],
    evidence: [],
    parsedPages: [],
    parsedChunks: [],
    interpretation: "",
  },
  parameters: {
    docs: {
      description: {
        story: "顶部提供从 Zotero 导入入口；实际搜索和导入需要桌面版读取本机 Zotero 库。",
      },
    },
  },
}
