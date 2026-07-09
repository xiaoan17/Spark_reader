import type { Meta, StoryObj } from "@storybook/react"
import { OnboardingFlow } from "./OnboardingFlow"

const meta = {
  title: "Reader/OnboardingFlow",
  component: OnboardingFlow,
  args: {
    open: true,
    hasSampleBook: true,
    desktopAvailable: true,
    onClose: () => undefined,
    onOpenSample: () => undefined,
    onImport: () => undefined,
    onLlmSettingsSaved: () => undefined,
  },
} satisfies Meta<typeof OnboardingFlow>

export default meta
type Story = StoryObj<typeof meta>

/** 第 1 步 · 先体验示例书。 */
export const StepExperience: Story = {}

/** 第 2 步 · 配置模型 key（桌面态，可保存并测试）。 */
export const StepConfigureKey: Story = {
  args: {
    initialStep: 1,
  },
}

/** 第 2 步 · 浏览器降级：连通测试不可用，不阻塞流程。 */
export const StepConfigureKeyBrowser: Story = {
  args: {
    initialStep: 1,
    desktopAvailable: false,
  },
}

/** 第 3 步 · 开始读自己的书。 */
export const StepStartReading: Story = {
  args: {
    initialStep: 2,
  },
}

/** 无示例书时「打开示例书」不可用。 */
export const WithoutSample: Story = {
  args: {
    hasSampleBook: false,
  },
}

export const Closed: Story = {
  args: {
    open: false,
  },
}
