import type { Meta, StoryObj } from "@storybook/react"
import { TldrReader } from "./TldrReader"

const meta = {
  title: "Reader/TldrReader",
  component: TldrReader,
  args: {
    desktopAvailable: true,
    llmReady: true,
    onGenerate: () => undefined,
    onRegenerate: () => undefined,
    onCancel: () => undefined,
  },
} satisfies Meta<typeof TldrReader>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: {},
}

export const LoadingStructureAnalysis: Story = {
  args: {
    loading: true,
    progress: {
      stage: "structureAnalysis",
      message: "Codex 正在分析文档结构",
      engine: "codex",
    },
  },
}

export const LoadingSampling: Story = {
  args: {
    loading: true,
    progress: {
      stage: "sampling",
      message: "Codex 正在抽样阅读第 3 处章节",
      sampled: 3,
      engine: "codex",
    },
  },
}

export const LoadingSynthesizing: Story = {
  args: {
    loading: true,
    progress: {
      stage: "synthesizing",
      message: "Codex 正在综合生成整书速览",
      sampled: 4,
      engine: "codex",
    },
  },
}

export const LoadingRustFallback: Story = {
  args: {
    loading: true,
    progress: {
      stage: "synthesizing",
      message: "正在综合生成整书速览",
      engine: "rust",
    },
  },
}

export const Complete: Story = {
  args: {
    text: "**核心结论**：这本书围绕长期复利和风险控制展开，主张把收益理解为时间、纪律和现金流共同作用的结果。\n\n它先用前几章建立复利的时间前提，再逐步引入现金流与风险控制作为让长期计划得以坚持的条件，最后落到一套可执行的阅读与决策框架。\n\n- 时间是复利成立的前提\n- 纪律与现金流决定能否坚持\n- 风险控制守住长期计划不被打断",
    generatedAt: "2026-07-08T08:30:00Z",
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

export const DesktopUnavailable: Story = {
  args: {
    desktopAvailable: false,
  },
}
