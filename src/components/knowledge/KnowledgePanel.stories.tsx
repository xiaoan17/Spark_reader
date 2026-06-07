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
