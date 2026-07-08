import type { Meta, StoryObj } from "@storybook/react"
import { AiWorkbench } from "./AiWorkbench"
import type { AgentTask } from "@/core/agent-task"
import type { KnowledgeCard, SavedHighlight } from "@/stores/reader-store"

const chunkId = "b12345678-p8-c1-abcdef12"

const highlightSamples: SavedHighlight[] = [
  {
    id: "hl-1",
    bookId: "book-1",
    selectionText: "复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。",
    prefix: "",
    suffix: "",
    pageIndex: 7,
    positionStart: 0,
    positionEnd: 40,
    rects: [],
    createdAt: "2026-06-08T08:00:00.000Z",
  },
  {
    id: "hl-2",
    bookId: "book-1",
    selectionText: "风险控制保证长期计划不中断。",
    prefix: "",
    suffix: "",
    pageIndex: 8,
    positionStart: 0,
    positionEnd: 14,
    rects: [],
    createdAt: "2026-06-08T07:20:00.000Z",
  },
]

const highlightCards: KnowledgeCard[] = highlightSamples.map((highlight, index) => ({
  cardId: `kb-highlight-${index + 1}`,
  bookId: highlight.bookId,
  cardType: "highlight",
  title: highlight.selectionText.slice(0, 12),
  summary: highlight.selectionText,
  bodyMarkdown: highlight.selectionText,
  payloadJson: JSON.stringify({ sourceTable: "highlights", sourceId: highlight.id }),
  status: "confirmed",
  source: "highlight",
  confidence: 1,
  sourceVersion: 1,
  userLocked: false,
  createdAt: highlight.createdAt,
  updatedAt: highlight.createdAt,
  evidence: [],
}))

const tasks: AgentTask[] = [
  {
    id: "task-running",
    kind: "summarize-chapter",
    title: "整理本章论证结构",
    status: "running",
    startedAt: "2026-06-07T12:00:00Z",
    steps: [
      { id: "step-1", label: "抽取本章论点", status: "done" },
      { id: "step-2", label: "寻找支撑证据", status: "running" },
      { id: "step-3", label: "整理层级大纲", status: "planning" },
    ],
  },
  {
    id: "task-done",
    kind: "highlights-to-deck",
    title: "全书高亮生成知识册",
    status: "done",
    startedAt: "2026-06-07T11:56:00Z",
    steps: [
      { id: "step-a", label: "读取高亮", status: "done" },
      { id: "step-b", label: "归并主题", status: "done" },
      { id: "step-c", label: "生成知识册产物", status: "done" },
    ],
    artifacts: [{ kind: "deck", cardIds: ["kb-1", "kb-2", "kb-3"] }],
  },
]

const meta = {
  title: "Reader/AiWorkbench",
  component: AiWorkbench,
  args: {
    tab: "spark",
    runningTaskCount: 1,
    selectionText:
      "复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。",
    selectionRects: [],
    interpretation:
      `这段文字强调长期积累，而不是单次爆发。作者把收益来源放在时间尺度上。[${chunkId}]`,
    answerSource: "llm",
    followUps: [
      {
        id: "follow-up-1",
        question: "它和风险控制有什么关系？",
        answer: `风险控制保证长期计划不中断，因此是复利能够持续发生的条件。[${chunkId}]`,
      },
    ],
    noteDraft: "",
    noteSaving: false,
    noteError: "",
    lightweight: false,
    citationChunkIds: [chunkId],
    phase: "reading",
    evidence: [{ chunkId, title: "第一章 · 复利", pageIndex: 7 }],
    agentTrace: [
      {
        phase: "retrieve",
        query: "复利 长期 时间",
        chunkIds: [chunkId],
        note: "混合检索全书正文，寻找定义、上下文和呼应证据。",
      },
    ],
    interpretationError: "",
    question: "",
    interpretationRuntimeHint: "桌面版会使用完整多轮证据检索。",
    tasks,
    tasksDisabled: false,
    interpretationHistory: [],
    onTabChange: () => undefined,
    onNoteChange: () => undefined,
    onSaveNote: () => undefined,
    onCopyInterpretation: () => undefined,
    onCitationClick: () => undefined,
    onQuestionChange: () => undefined,
    onQuestionSubmit: () => undefined,
    onRegenerate: () => undefined,
    onStop: () => undefined,
    onOpenSettings: () => undefined,
    onRunTask: () => undefined,
    onStopTask: () => undefined,
    onOpenSparkItem: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="h-screen w-[300px] bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AiWorkbench>

export default meta
type Story = StoryObj<typeof meta>

export const Spark: Story = {}

export const SparkEmpty: Story = {
  args: {
    selectionText: "",
    interpretation: "",
    followUps: [],
    evidence: [],
    agentTrace: [],
    runningTaskCount: 0,
  },
}

export const SparkHistory: Story = {
  args: {
    selectionText: "",
    interpretation: "",
    followUps: [],
    evidence: [],
    agentTrace: [],
    runningTaskCount: 0,
    interpretationHistory: [
      {
        id: "history-1",
        bookId: "book-1",
        selectionText: "复利的力量并不来自某一次惊人的收益，而来自足够长的时间。",
        sessionId: "session-1",
        turnIndex: 0,
        pageIndex: 7,
        pageIndexes: [7],
        evidenceChunkIds: [chunkId],
        question: null,
        answer: "这段在强调长期复合。",
        answerSource: "llm",
        kind: "interpretation",
        mode: "deep",
        createdAt: "2026-06-08T08:00:00.000Z",
      },
      {
        id: "history-2",
        bookId: "book-1",
        selectionText: "风险控制保证长期计划不中断。",
        sessionId: "session-2",
        turnIndex: 0,
        pageIndex: 8,
        pageIndexes: [8],
        evidenceChunkIds: [],
        question: null,
        answer: "这是风险控制与复利的关系。",
        answerSource: "llm",
        kind: "spark",
        mode: "plain",
        createdAt: "2026-06-08T07:20:00.000Z",
      },
    ],
  },
}

export const SparkPlanning: Story = {
  args: {
    phase: "planning",
    interpretation: "",
    followUps: [],
  },
}

export const Tasks: Story = {
  args: {
    tab: "tasks",
  },
}

export const TasksAnimatedCounts: Story = {
  args: {
    tab: "tasks",
    runningTaskCount: 2,
    tasks: [
      ...tasks,
      {
        id: "task-evidence",
        kind: "contradiction-check",
        title: "核验观点的前文限制",
        status: "running",
        startedAt: "2026-06-07T12:08:00Z",
        steps: [
          {
            id: "step-evidence-1",
            label: "回查前文限定条件",
            status: "running",
            evidence: [
              { chunkId: "b12345678-p2-c1-abcdef12", title: "第二页 · 风险", pageIndex: 1 },
              { chunkId: "b12345678-p3-c1-abcdef12", title: "第三页 · 波动", pageIndex: 2 },
            ],
          },
          { id: "step-evidence-2", label: "整理反例", status: "planning" },
        ],
      },
    ],
  },
}

export const TasksEmpty: Story = {
  args: {
    tab: "tasks",
    tasks: [],
    runningTaskCount: 0,
  },
}

export const Highlights: Story = {
  args: {
    tab: "highlights",
    highlights: highlightSamples,
    knowledgeCards: highlightCards,
    desktopAvailable: true,
    onGenerateHighlightNote: async (cardId: string): Promise<KnowledgeCard | null> => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const card = highlightCards.find((item) => item.cardId === cardId)
      return card ? { ...card, bodyMarkdown: "这条高亮强调长期复利依赖持续的方向与纪律。" } : null
    },
  },
}

export const HighlightsEmpty: Story = {
  args: {
    tab: "highlights",
    highlights: [],
    knowledgeCards: [],
  },
}
