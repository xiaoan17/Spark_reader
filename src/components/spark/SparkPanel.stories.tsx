import type { Meta, StoryObj } from "@storybook/react"
import { SparkPanel } from "./SparkPanel"

const meta = {
  title: "Spark/SparkPanel",
  component: SparkPanel,
  args: {
    mode: "spark",
    selectionText: "复利来自时间、纪律和风险控制的共同作用。",
    answer: "",
    followUps: [],
    noteDraft: "",
    question: "",
    citationChunkIds: ["p1-c1"],
    onModeChange: () => undefined,
    onNoteDraftChange: () => undefined,
    onQuestionChange: () => undefined,
    onSaveNote: () => undefined,
    onAsk: () => undefined,
    onClose: () => undefined,
    onCopy: () => undefined,
    onCitationClick: () => undefined,
  },
} satisfies Meta<typeof SparkPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Streaming: Story = {
  args: {
    loading: true,
  },
}

export const MultiTurn: Story = {
  args: {
    answer: "这段话把复利从收益率问题转成行为系统问题：时间提供放大器，纪律保证过程不中断，风险控制避免本金被永久损伤。[p1-c1]",
    followUps: [
      {
        id: "turn-1",
        question: "和深度解读有什么不同？",
        answer: "Spark 更适合围绕同一选区持续追问，会复用首轮证据，不展示完整检索轨迹。[p1-c1]",
      },
    ],
  },
}

export const NoteEditing: Story = {
  args: {
    mode: "note",
    noteDraft: "这里可以和自己的投资记录关联：我常把风险控制理解成保守，但作者更强调它是让复利持续发生的前提。",
    noteItems: [
      {
        id: "spark-1",
        bookId: "book-story",
        selectionText: "复利来自时间、纪律和风险控制的共同作用。",
        sessionId: "spark-session-1",
        turnIndex: 0,
        pageIndexes: [0],
        evidenceChunkIds: ["p1-c1"],
        question: null,
        answer: "Spark 先把这段解释为一个持续系统：**时间** 放大结果，纪律减少中断，风险控制保护本金。[p1-c1]",
        answerSource: "llm",
        kind: "spark",
        createdAt: "2026-06-02T12:00:00Z",
      },
      {
        id: "note-1",
        bookId: "book-story",
        selectionText: "复利来自时间、纪律和风险控制的共同作用。",
        sessionId: "spark-session-1",
        turnIndex: 1,
        pageIndexes: [0],
        evidenceChunkIds: [],
        question: null,
        answer: "- 这里可以连到自己的投资记录\n- 风险控制不是保守，而是让复利不断档",
        answerSource: "local_fallback",
        kind: "note",
        createdAt: "2026-06-02T12:02:00Z",
      },
    ],
  },
}

export const Error: Story = {
  args: {
    error: "完整 LLM 追问暂时不可用，已保留当前 Spark 线程。",
  },
}
