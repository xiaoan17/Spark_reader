import type { Meta, StoryObj } from "@storybook/react"
import { OnboardingKeyForm } from "./OnboardingKeyForm"

const meta = {
  title: "Settings/OnboardingKeyForm",
  component: OnboardingKeyForm,
  decorators: [
    (Story) => (
      <div className="max-w-lg rounded-lg border bg-card p-4 text-card-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    desktopAvailable: true,
    onLlmSettingsSaved: () => undefined,
  },
} satisfies Meta<typeof OnboardingKeyForm>

export default meta
type Story = StoryObj<typeof meta>

/** 桌面态：可填 key 并就地保存 + 连通测试。 */
export const Desktop: Story = {}

/** 浏览器降级：保存密钥/连通测试不可用，按钮禁用并给降级文案。 */
export const Browser: Story = {
  args: {
    desktopAvailable: false,
  },
}
