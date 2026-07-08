import type { Meta, StoryObj } from "@storybook/react"
import { createRef } from "react"
import { ReaderTopBar } from "./ReaderTopBar"
import { readerViewConfigs } from "./reader-view-config"
import { readerDisplayThemeOptions } from "./reader-display-theme"

const readerViewItems = readerViewConfigs({
  canShowConvertedText: true,
  canOpenPdfView: true,
  hasBook: true,
  isDesktop: true,
})

const meta = {
  title: "Reader/ReaderTopBar",
  component: ReaderTopBar,
  tags: ["autodocs"],
  args: {
    bookTitle: "认知觉醒：开启自我改变的原动力",
    totalPages: 120,
    readerView: "text",
    runtimeLabel: "桌面版",
    llmProviderText: "DeepSeek / deepseek-v4-flash",
    llmProviderTitle: "当前 LLM provider: DeepSeek",
    importButtonLabel: "导入 PDF",
    hasBook: true,
    isExtracting: false,
    importMenuOpen: false,
    libraryOpen: false,
    pdfLoadStatus: "idle",
    readerViewItems,
    appearanceControl: {
      open: false,
      onOpenChange: () => undefined,
      displayThemeId: readerDisplayThemeOptions[0].id,
      displayThemeItems: readerDisplayThemeOptions,
      colorMode: "system",
      typography: { fontScale: null, lineHeight: null, pageWidth: null },
      hasTypographyOverride: false,
      onDisplayThemeChange: () => undefined,
      onColorModeChange: () => undefined,
      onTypographyChange: () => undefined,
      onResetTypography: () => undefined,
    },
    fileInputRef: createRef<HTMLInputElement | null>(),
    onToggleSidebar: () => undefined,
    onFileSelected: () => undefined,
    onImportMenuOpen: () => undefined,
    onToggleLibrary: () => undefined,
    onSelectView: () => undefined,
    onToggleSearch: () => undefined,
    onOpenGuide: () => undefined,
    onToggleSettings: () => undefined,
  },
} satisfies Meta<typeof ReaderTopBar>

export default meta
type Story = StoryObj<typeof meta>

/** 有书打开:导入降为安静图标,四组分区(视图 | 搜索 | 书库 | 偏好) */
export const WithBook: Story = {}

/** 空书架 / 首次使用:导入是唯一的实心主按钮 */
export const EmptyLibrary: Story = {
  args: {
    bookTitle: "框选精读",
    totalPages: 0,
    hasBook: false,
    readerViewItems: readerViewConfigs({
      canShowConvertedText: false,
      canOpenPdfView: false,
      hasBook: false,
      isDesktop: true,
    }),
  },
}

/** 导入解析中:导入图标转圈且禁用 */
export const Extracting: Story = {
  args: {
    isExtracting: true,
  },
}

/** 外观菜单展开(受控,原生菜单"阅读外观…"也走同一状态) */
export const AppearanceMenuOpen: Story = {
  args: {
    appearanceControl: {
      ...meta.args.appearanceControl,
      open: true,
    },
  },
}

/** AI provider 未配置:标题左侧状态点变灰 */
export const LlmNotConfigured: Story = {
  args: {
    llmProviderText: "provider 未读取",
    llmProviderTitle: "AI provider 未配置",
  },
}
