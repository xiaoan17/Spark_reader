import type { Meta, StoryObj } from "@storybook/react"
import { ObsidianSettingsPanel } from "./ObsidianSettingsPanel"

const meta = {
  title: "Settings/ObsidianSettingsPanel",
  component: ObsidianSettingsPanel,
  args: {
    open: true,
    vaultPath: "/Users/reader/Obsidian/研究库",
    subdir: "框选精读",
    configured: true,
    status: "idle",
    message: "",
    onVaultPathChange: () => undefined,
    onSubdirChange: () => undefined,
    onSave: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof ObsidianSettingsPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {}

export const Empty: Story = {
  args: {
    vaultPath: "",
    subdir: "",
    configured: false,
  },
}

export const Loading: Story = {
  args: {
    vaultPath: "",
    subdir: "",
    configured: false,
    status: "loading",
  },
}

export const Saved: Story = {
  args: {
    status: "ok",
    message: "Obsidian 设置已保存",
  },
}

export const Error: Story = {
  args: {
    vaultPath: "/不存在/vault",
    configured: false,
    status: "error",
    message: "Obsidian vault 不存在，请检查路径后重试。",
  },
}

export const Closed: Story = {
  args: {
    open: false,
  },
}
