import type { Meta, StoryObj } from "@storybook/react"
import { SelectionToolbar } from "./SelectionToolbar"

const meta = {
  title: "Selection/SelectionToolbar",
  component: SelectionToolbar,
  tags: ["autodocs"],
  args: {
    approximate: false,
    askOpen: false,
    visible: true,
    question: "",
  },
} satisfies Meta<typeof SelectionToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const Selected: Story = {}

export const AskExpanded: Story = {
  args: {
    askOpen: true,
    question: "这段话和前文有什么关系？",
  },
}

export const OcrApproximate: Story = {
  args: {
    approximate: true,
  },
}

export const Hidden: Story = {
  args: {
    visible: false,
  },
}
