import type { Meta, StoryObj } from "@storybook/react"
import { KnowledgePanel } from "./KnowledgePanel"
import type { KnowledgeCard, KnowledgeGraph } from "@/stores/reader-store"

const cards: KnowledgeCard[] = [
  {
    cardId: "kb-highlight-1",
    bookId: "book-story",
    cardType: "highlight",
    title: "复利来自时间、纪律和风险控制",
    summary: "复利来自时间、纪律和风险控制。",
    bodyMarkdown: "复利来自时间、纪律和风险控制。",
    payloadJson: "{}",
    status: "confirmed",
    source: "highlight",
    confidence: 1,
    sourceVersion: 1,
    userLocked: false,
    createdAt: "2026-06-07T10:00:00Z",
    updatedAt: "2026-06-07T10:00:00Z",
    evidence: [
      {
        cardId: "kb-highlight-1",
        bookId: "book-story",
        chunkId: "b12345678-p1-c1-abcdef12",
        pageIndex: 0,
        quote: "复利来自时间、纪律和风险控制。",
        role: "support",
        contentHash: "abcdef12",
        createdAt: "2026-06-07T10:00:00Z",
      },
    ],
  },
  {
    cardId: "kb-interpretation-1",
    bookId: "book-story",
    cardType: "interpretation",
    title: "复利来自时间",
    summary: "作者强调长期过程比单次收益更重要。",
    bodyMarkdown: "### 解读\n作者强调长期过程比单次收益更重要。",
    payloadJson: "{}",
    status: "confirmed",
    source: "interpretation",
    confidence: 0.9,
    sourceVersion: 1,
    userLocked: false,
    createdAt: "2026-06-07T10:02:00Z",
    updatedAt: "2026-06-07T10:02:00Z",
    evidence: [
      {
        cardId: "kb-interpretation-1",
        bookId: "book-story",
        chunkId: "b12345678-p1-c1-abcdef12",
        pageIndex: 0,
        quote: "复利来自时间、纪律和风险控制。",
        role: "support",
        contentHash: "abcdef12",
        createdAt: "2026-06-07T10:02:00Z",
      },
    ],
  },
]

const graph: KnowledgeGraph = {
  bookId: "book-story",
  builtAt: "2026-06-07T10:10:00Z",
  nodes: [
    ...cards.map((card) => ({
      cardId: card.cardId,
      bookId: card.bookId,
      cardType: card.cardType,
      title: card.title,
      summary: card.summary,
      status: card.status,
      source: card.source,
      confidence: card.confidence,
      evidenceCount: card.evidence.length,
      pageIndex: card.evidence[0]?.pageIndex ?? null,
      evidence: card.evidence,
    })),
    {
      cardId: "kb-auto-compound",
      bookId: "book-story",
      cardType: "concept",
      title: "复利",
      summary: "自动候选：复利。来自 2 张知识卡片、1 条原文证据。",
      status: "candidate",
      source: "auto",
      confidence: 0.74,
      evidenceCount: 1,
      pageIndex: 0,
      evidence: cards[0].evidence,
    },
    {
      cardId: "kb-auto-event",
      bookId: "book-story",
      cardType: "event",
      title: "风险控制支持复利",
      summary: "自动候选：风险控制支持复利。",
      status: "candidate",
      source: "auto",
      confidence: 0.64,
      evidenceCount: 1,
      pageIndex: 0,
      evidence: cards[1].evidence,
    },
  ],
  edges: [
    {
      edgeId: "edge-1",
      bookId: "book-story",
      sourceCardId: "kb-highlight-1",
      targetCardId: "kb-auto-compound",
      edgeType: "mentions",
      label: "提及候选",
      evidenceChunkIds: ["b12345678-p1-c1-abcdef12"],
      source: "auto",
      confidence: 0.7,
      status: "candidate",
      createdAt: "2026-06-07T10:10:00Z",
      updatedAt: "2026-06-07T10:10:00Z",
    },
    {
      edgeId: "edge-2",
      bookId: "book-story",
      sourceCardId: "kb-highlight-1",
      targetCardId: "kb-interpretation-1",
      edgeType: "same_evidence",
      label: "共享原文证据",
      evidenceChunkIds: ["b12345678-p1-c1-abcdef12"],
      source: "auto",
      confidence: 0.82,
      status: "candidate",
      createdAt: "2026-06-07T10:10:00Z",
      updatedAt: "2026-06-07T10:10:00Z",
    },
  ],
}

const meta = {
  title: "Knowledge/KnowledgePanel",
  component: KnowledgePanel,
  args: {
    cards,
    graph,
    loading: false,
    graphLoading: false,
    building: false,
    error: "",
    onRefresh: () => undefined,
    onBuildKnowledge: () => undefined,
    onExport: () => undefined,
    onEvidenceClick: () => undefined,
  },
} satisfies Meta<typeof KnowledgePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Empty: Story = {
  args: {
    cards: [],
    graph: null,
  },
}

export const Loading: Story = {
  args: {
    cards: [],
    graph: null,
    loading: true,
  },
}

export const Error: Story = {
  args: {
    cards: [],
    graph: null,
    error: "知识卡片加载失败。",
  },
}

export const BuildingGraph: Story = {
  args: {
    cards,
    graph,
    building: true,
  },
}

const denseGraph = buildDenseGraphStory()

export const DenseGraph: Story = {
  args: {
    cards: denseGraph.cards,
    graph: denseGraph.graph,
  },
  play: async ({ canvasElement }) => {
    const graphTab = Array.from(canvasElement.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("图谱"),
    )
    graphTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  },
}

function buildDenseGraphStory() {
  const pages = [0, 2, 4, 7, 11, 16, 23, 31, 43, 58, 76, 94]
  const denseCards: KnowledgeCard[] = pages.flatMap((pageIndex, pageOrder) => {
    const evidence = {
      cardId: "",
      bookId: "book-dense",
      chunkId: `bookdense-p${pageIndex + 1}-c1-${String(pageOrder).padStart(2, "0")}`,
      pageIndex,
      quote: `第 ${pageIndex + 1} 页围绕市场信号、监管沉默和异常收益展开论证。`,
      role: "support",
      contentHash: `dense-${pageOrder}`,
      createdAt: "2026-06-07T10:10:00Z",
    }
    const definitions = [
      ["highlight", "阅读标注", 0.96],
      ["summary", "章节小结", 0.78],
      ["claim", "监管沉默削弱市场约束", 0.74],
      ["concept", "异常收益", 0.72],
      ["entity", "Market Maker", 0.7],
      ["event", "公告前价格跳升", 0.68],
    ] as const
    return definitions.map(([cardType, title, confidence], typeOrder) => {
      const cardId = `kb-dense-${pageOrder}-${cardType}`
      return {
        cardId,
        bookId: "book-dense",
        cardType,
        title: `${title} · P${pageIndex + 1}`,
        summary: `自动候选：${title} 出现在第 ${pageIndex + 1} 页附近。`,
        bodyMarkdown: `${title} 与同页证据和相邻章节形成关系。`,
        payloadJson: "{}",
        status: cardType === "highlight" ? "confirmed" : "candidate",
        source: cardType === "highlight" ? "highlight" : "auto",
        confidence,
        sourceVersion: 1,
        userLocked: false,
        createdAt: `2026-06-07T10:${String(10 + pageOrder).padStart(2, "0")}:00Z`,
        updatedAt: `2026-06-07T10:${String(10 + pageOrder).padStart(2, "0")}:00Z`,
        evidence: [{ ...evidence, cardId, role: typeOrder === 0 ? "anchor" : "support" }],
      } satisfies KnowledgeCard
    })
  })
  const denseNodes = denseCards.map((card) => ({
    cardId: card.cardId,
    bookId: card.bookId,
    cardType: card.cardType,
    title: card.title,
    summary: card.summary,
    status: card.status,
    source: card.source,
    confidence: card.confidence,
    evidenceCount: card.evidence.length,
    pageIndex: card.evidence[0]?.pageIndex ?? null,
    evidence: card.evidence,
  }))
  const denseEdges: KnowledgeGraph["edges"] = []
  for (let pageOrder = 0; pageOrder < pages.length; pageOrder += 1) {
    const sourceCardId = `kb-dense-${pageOrder}-highlight`
    for (const cardType of ["summary", "claim", "concept", "entity", "event"]) {
      denseEdges.push({
        edgeId: `edge-dense-${pageOrder}-${cardType}`,
        bookId: "book-dense",
        sourceCardId,
        targetCardId: `kb-dense-${pageOrder}-${cardType}`,
        edgeType: cardType === "summary" ? "part_of" : cardType === "event" ? "causes" : "mentions",
        label: "同页证据",
        evidenceChunkIds: [`bookdense-p${pages[pageOrder] + 1}-c1-${String(pageOrder).padStart(2, "0")}`],
        source: "auto",
        confidence: cardType === "event" ? 0.72 : 0.82,
        status: "candidate",
        createdAt: "2026-06-07T10:10:00Z",
        updatedAt: "2026-06-07T10:10:00Z",
      })
    }
    if (pageOrder > 0) {
      denseEdges.push({
        edgeId: `edge-dense-sequel-${pageOrder}`,
        bookId: "book-dense",
        sourceCardId: `kb-dense-${pageOrder - 1}-summary`,
        targetCardId: `kb-dense-${pageOrder}-summary`,
        edgeType: "sequel",
        label: "阅读顺序",
        evidenceChunkIds: [
          `bookdense-p${pages[pageOrder - 1] + 1}-c1-${String(pageOrder - 1).padStart(2, "0")}`,
          `bookdense-p${pages[pageOrder] + 1}-c1-${String(pageOrder).padStart(2, "0")}`,
        ],
        source: "auto",
        confidence: 0.62,
        status: "candidate",
        createdAt: "2026-06-07T10:10:00Z",
        updatedAt: "2026-06-07T10:10:00Z",
      })
    }
  }

  return {
    cards: denseCards,
    graph: {
      bookId: "book-dense",
      builtAt: "2026-06-07T10:30:00Z",
      nodes: denseNodes,
      edges: denseEdges,
    } satisfies KnowledgeGraph,
  }
}
