import type { Meta, StoryObj } from "@storybook/react"
import { ImportChoicePanel } from "./ImportChoicePanel"

const meta = {
  title: "Reader/ImportChoicePanel",
  component: ImportChoicePanel,
  args: {
    open: true,
    isDesktop: true,
    isBusy: false,
    hasSampleBook: true,
    onClose: () => undefined,
    onImportPdf: () => undefined,
    onImportZotero: () => undefined,
    onImportMineruOutput: () => undefined,
    onOpenSample: () => undefined,
  },
} satisfies Meta<typeof ImportChoicePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {}

export const BrowserPreview: Story = {
  args: {
    isDesktop: false,
  },
}

export const Busy: Story = {
  args: {
    isBusy: true,
  },
}

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
