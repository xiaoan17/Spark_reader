import type { Meta, StoryObj } from "@storybook/react"
import { InterpretationCard } from "./InterpretationCard"

const evidence = [
  { chunkId: "b12345678-p8-c1-abcdef12", title: "第一章 · 复利", pageIndex: 7 },
  { chunkId: "b12345678-p85-c1-11111111", title: "风险与长期主义", pageIndex: 84 },
  { chunkId: "b12345678-p132-c1-22222222", title: "结语 · 时间", pageIndex: 131 },
]

const agentTrace = [
  {
    phase: "plan" as const,
    query: null,
    chunkIds: [],
    note: "Plan: 以框选文本为焦点，生成 3 条检索查询。",
  },
  {
    phase: "retrieve" as const,
    query: "复利 长期 时间",
    chunkIds: ["b12345678-p8-c1-abcdef12", "b12345678-p132-c1-22222222"],
    note: "混合检索全书正文，寻找定义、上下文和呼应证据。",
  },
  {
    phase: "iterate" as const,
    query: "b12345678-p8-c1-abcdef12",
    chunkIds: [
      "b12345678-p7-c1-77777777",
      "b12345678-p8-c1-abcdef12",
      "b12345678-p9-c1-99999999",
    ],
    note: "读取命中段落的前后文，避免孤立引用。",
  },
]

const meta = {
  title: "Interpretation/InterpretationCard",
  component: InterpretationCard,
  tags: ["autodocs"],
  args: {
    selectionText:
      "复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。",
    evidence,
    agentTrace,
    phase: "reading",
    interpretation:
      "这段文字的直接焦点是：“复利的力量并不来自某一次惊人的收益，而来自足够长的时间里持续保持正确方向。” [b12345678-p8-c1-abcdef12]\n\n当前版本先展示本地解读闭环。",
    followUps: [],
    selectionRects: [
      {
        pageIndex: 0,
        x0: 0.12,
        y0: 0.32,
        x1: 0.74,
        y1: 0.36,
      },
    ],
  },
} satisfies Meta<typeof InterpretationCard>

export default meta
type Story = StoryObj<typeof meta>

export const Complete: Story = {}

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

export const Streaming: Story = {
  args: {
    phase: "streaming",
  },
}

export const ApiError: Story = {
  args: {
    phase: "error",
  },
}

export const Empty: Story = {
  args: {
    phase: "empty",
    selectionText: "",
    evidence: [],
    interpretation: "",
    followUps: [],
  },
}

export const FollowUpOnly: Story = {
  args: {
    interpretation: "",
    selectionRects: [],
    followUps: [
      {
        id: "follow-up-1",
        question: "为什么这里强调长期？",
        answer: "因为作者把收益来源放在时间累积和风险控制上，而不是单次爆发。[b12345678-p8-c1-abcdef12]",
      },
    ],
  },
}

export const MarkdownAnswer: Story = {
  args: {
    interpretation:
      "### 一、核心判断\n\n这段话强调 **长期积累**，不是单次收益。[b12345678-p8-c1-abcdef12]\n\n1. 把收益来源放在时间尺度上。\n2. 把风险控制视为持续性的前提。\n\n| 维度 | 解释 |\n| --- | --- |\n| 时间 | 放大微小差异 |\n| 风险 | 避免中断复利 |",
    followUps: [
      {
        id: "markdown-follow-up",
        question: "它和风险有什么关系？",
        answer:
          "风险控制保证过程不中断，因此和长期积累是同一条逻辑链上的条件。[b12345678-p85-c1-11111111]",
      },
    ],
  },
}

export const LocalFallback: Story = {
  args: {
    answerSource: "local_fallback",
    interpretation:
      "LLM 暂不可用时，会显示本地兜底答案，并继续保留可回跳证据。[b12345678-p8-c1-abcdef12]",
  },
}
