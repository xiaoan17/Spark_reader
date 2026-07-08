import type { Decorator, Meta, StoryObj } from "@storybook/react"
import { ReaderAppearanceControl } from "./ReaderAppearanceControl"
import {
  readerDisplayThemeOptions,
  readerDisplayThemeStyle,
  type ReaderDisplayThemeId,
} from "./reader-display-theme"
import type { ReaderResolvedColorMode } from "./reader-color-mode"

/**
 * 「Aa」阅读外观浮层。展示组件,状态经 props 流入;这里用装饰器把阅读器
 * CSS 变量注入容器,让浮层在明/暗与各主题下都呈现真实配色。
 */
function withReaderSurface(
  mode: ReaderResolvedColorMode,
  themeId: ReaderDisplayThemeId = readerDisplayThemeOptions[0].id,
): Decorator {
  return function Decorated(Story) {
    return (
      <div
        className="reader-display-theme reader-workspace-theme flex min-h-[420px] justify-end p-4"
        style={readerDisplayThemeStyle(themeId, mode)}
      >
        <Story />
      </div>
    )
  }
}

const meta = {
  title: "Reader/ReaderAppearanceControl",
  component: ReaderAppearanceControl,
  args: {
    open: true,
    onOpenChange: () => undefined,
    displayThemeId: "spark-paper",
    displayThemeItems: readerDisplayThemeOptions,
    colorMode: "system",
    typography: { fontScale: null, lineHeight: null, pageWidth: null },
    hasTypographyOverride: false,
    onDisplayThemeChange: () => undefined,
    onColorModeChange: () => undefined,
    onTypographyChange: () => undefined,
    onResetTypography: () => undefined,
  },
  decorators: [withReaderSurface("light")],
} satisfies Meta<typeof ReaderAppearanceControl>

export default meta
type Story = StoryObj<typeof meta>

/** 默认:浅色 + 跟随系统,排版全部跟随主题(无覆盖,不显示恢复默认) */
export const Default: Story = {}

/** 折叠态:仅「Aa」触发按钮 */
export const Collapsed: Story = {
  args: { open: false },
}

/** 深色模式:明暗选中"深色",浮层走暗色变体配色 */
export const DarkMode: Story = {
  args: { colorMode: "dark" },
  decorators: [withReaderSurface("dark")],
}

/** 已覆盖排版:大字号 + 宽松行距 + 宽页宽,显示"恢复默认" */
export const TypographyOverridden: Story = {
  args: {
    colorMode: "light",
    typography: { fontScale: "xl", lineHeight: "relaxed", pageWidth: "wide" },
    hasTypographyOverride: true,
  },
}

/** 最小字号 + 紧凑行距 + 窄页宽 */
export const CompactTypography: Story = {
  args: {
    typography: { fontScale: "xs", lineHeight: "tight", pageWidth: "narrow" },
    hasTypographyOverride: true,
  },
}

/** 选中 Night 阅读主题(深色气质),浮层沿用其暗色配色 */
export const NightThemeSelected: Story = {
  args: {
    displayThemeId: "typora-night",
    colorMode: "dark",
  },
  decorators: [withReaderSurface("dark", "typora-night")],
}
