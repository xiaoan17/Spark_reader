import type { Meta, StoryObj } from "@storybook/react"
import { LlmSettingsPanel, SecretRotationBanner } from "./LlmSettingsPanel"

const meta = {
  title: "Settings/LlmSettingsPanel",
  component: LlmSettingsPanel,
  args: {
    open: true,
    onClose: () => undefined,
  },
} satisfies Meta<typeof LlmSettingsPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Recommended: Story = {}

export const Advanced: Story = {
  args: {
    defaultAdvancedOpen: true,
  },
}

export const Closed: Story = {
  args: {
    open: false,
  },
}

/** 密钥曾以明文迁移过时，设置页顶部的一次性轮换提醒 banner。 */
export const RotationBanner: StoryObj<typeof SecretRotationBanner> = {
  render: () => (
    <div className="max-w-xl overflow-hidden rounded-lg border bg-card text-card-foreground">
      <SecretRotationBanner onDismiss={() => undefined} />
    </div>
  ),
}
