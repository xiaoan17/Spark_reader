import type { Meta, StoryObj } from "@storybook/react"
import { OnboardingFlow } from "./OnboardingFlow"

const meta = {
  title: "Reader/OnboardingFlow",
  component: OnboardingFlow,
  args: {
    open: true,
    hasSampleBook: true,
    onClose: () => undefined,
    onOpenSample: () => undefined,
    onImport: () => undefined,
  },
} satisfies Meta<typeof OnboardingFlow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

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
