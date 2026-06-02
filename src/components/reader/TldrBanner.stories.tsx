import type { Meta, StoryObj } from "@storybook/react"
import { TldrBanner } from "./TldrBanner"

const meta = {
  title: "Reader/TldrBanner",
  component: TldrBanner,
  args: {
    desktopAvailable: true,
    llmReady: true,
    onGenerate: () => undefined,
    onRegenerate: () => undefined,
    onDismiss: () => undefined,
  },
} satisfies Meta<typeof TldrBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {
  args: {
    loading: true,
  },
}

export const Complete: Story = {
  args: {
    text: "这本书围绕长期复利和风险控制展开，核心主张是把收益理解为时间、纪律和现金流共同作用的结果，而不是一次性预测。值得读的地方在于它把抽象投资原则落到可执行的阅读和决策框架。",
    generatedAt: "2026-06-02T08:30:00Z",
    model: "DeepSeek/deepseek-v4-flash",
  },
}

export const Error: Story = {
  args: {
    error: "完整 LLM 解读暂时不可用，请检查 API Key 和网络连接后重试。",
  },
}

export const MissingKey: Story = {
  args: {
    llmReady: false,
  },
}

export const Dismissed: Story = {
  args: {
    dismissed: true,
    text: "这条内容不会渲染。",
  },
}
