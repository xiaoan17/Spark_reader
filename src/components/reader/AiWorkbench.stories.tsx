import type { Meta, StoryObj } from "@storybook/react"
import { AiWorkbench } from "./AiWorkbench"
import type { AgentTask } from "@/core/agent-task"

const chunkId = "b12345678-p8-c1-abcdef12"

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
    tab: "current",
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
    askOpen: false,
    question: "",
    interpretationRuntimeHint: "桌面版会使用完整多轮证据检索。",
    tasks,
    tasksDisabled: false,
    onTabChange: () => undefined,
    onLightweightChange: () => undefined,
    onNoteChange: () => undefined,
    onSaveNote: () => undefined,
    onCopyInterpretation: () => undefined,
    onCitationClick: () => undefined,
    onAskToggle: () => undefined,
    onQuestionChange: () => undefined,
    onQuestionSubmit: () => undefined,
    onRegenerate: () => undefined,
    onStop: () => undefined,
    onOpenSettings: () => undefined,
    onRunTask: () => undefined,
    onStopTask: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="h-screen w-[360px] bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AiWorkbench>

export default meta
type Story = StoryObj<typeof meta>

export const Current: Story = {}

export const CurrentEmpty: Story = {
  args: {
    selectionText: "",
    interpretation: "",
    followUps: [],
    evidence: [],
    agentTrace: [],
    runningTaskCount: 0,
  },
}

export const CurrentPlanning: Story = {
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

export const TasksEmpty: Story = {
  args: {
    tab: "tasks",
    tasks: [],
    runningTaskCount: 0,
  },
}
