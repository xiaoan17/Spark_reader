import type { Meta, StoryObj } from "@storybook/react"
import { SelectionToolbar } from "./SelectionToolbar"

const meta = {
  title: "Selection/SelectionToolbar",
  component: SelectionToolbar,
  tags: ["autodocs"],
  args: {
    approximate: false,
    visible: true,
  },
} satisfies Meta<typeof SelectionToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const SparkPrimary: Story = {}

export const OcrApproximate: Story = {
  args: {
    approximate: true,
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const Hidden: Story = {
  args: {
    visible: false,
  },
}
