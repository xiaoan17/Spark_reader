import type { Meta, StoryObj } from "@storybook/react"
import { LlmSettingsPanel } from "./LlmSettingsPanel"

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
