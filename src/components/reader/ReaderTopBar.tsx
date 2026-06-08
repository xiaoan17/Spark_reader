import {
  BookOpen,
  FileText,
  Languages,
  Library,
  Loader2,
  Network,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  SunMoon,
  Upload,
} from "lucide-react"
import type { RefObject } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { isTauriRuntime } from "@/core/library-api"
import type { ReaderView } from "./highlight-target-view"
import type { ReaderViewConfig } from "./reader-view-config"
import { readerViewHeaderLabel } from "./reader-view-config"

type ReaderTopBarProps = {
  bookTitle: string
  totalPages: number
  readerView: ReaderView
  runtimeLabel: string
  llmProviderText: string
  llmProviderTitle: string
  importButtonLabel: string
  isExtracting: boolean
  importMenuOpen: boolean
  libraryOpen: boolean
  pdfLoadStatus: "idle" | "loading" | "error"
  readerViewItems: ReaderViewConfig[]
  fileInputRef: RefObject<HTMLInputElement | null>
  onToggleSidebar: () => void
  onFileSelected: (file: File) => void
  onImportMenuOpen: () => void
  onToggleLibrary: () => void
  onSelectView: (item: ReaderViewConfig) => void
  onToggleSearch: () => void
  onOpenGuide: () => void
  onToggleTheme: () => void
  onToggleSettings: () => void
}

/**
 * Reader top bar: title/runtime status on the left, import / library / view-switch
 * / search / theme / settings on the right. Pure presentation — all state lives in
 * ReaderShell and flows in via props (UI-UX §7 端无关展示组件).
 */
export function ReaderTopBar({
  bookTitle,
  totalPages,
  readerView,
  runtimeLabel,
  llmProviderText,
  llmProviderTitle,
  importButtonLabel,
  isExtracting,
  importMenuOpen,
  libraryOpen,
  pdfLoadStatus,
  readerViewItems,
  fileInputRef,
  onToggleSidebar,
  onFileSelected,
  onImportMenuOpen,
  onToggleLibrary,
  onSelectView,
  onToggleSearch,
  onOpenGuide,
  onToggleTheme,
  onToggleSettings,
}: ReaderTopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card/80 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="ghost"
          aria-label="收起阅读侧栏"
          onClick={onToggleSidebar}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{bookTitle}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{totalPages > 0 ? readerViewHeaderLabel(readerView) : "等待导入"}</span>
            <Badge variant="secondary">{runtimeLabel}</Badge>
            <Badge
              variant="secondary"
              className="max-w-[240px] truncate"
              title={llmProviderTitle}
              data-testid="llm-provider-badge"
            >
              AI: {llmProviderText}
            </Badge>
          </div>
        </div>
      </div>
      <nav className="flex items-center gap-2" aria-label="阅读工具栏">
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="application/pdf,.pdf"
          disabled={isTauriRuntime()}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              onFileSelected(file)
            }
            event.currentTarget.value = ""
          }}
        />
        <Button
          size="sm"
          disabled={isExtracting}
          aria-expanded={importMenuOpen}
          onClick={onImportMenuOpen}
        >
          {isExtracting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          {importButtonLabel}
        </Button>
        <Button
          size="sm"
          variant={libraryOpen ? "secondary" : "ghost"}
          className="gap-1.5"
          aria-label="打开书架"
          title={libraryOpen ? "收起书架" : "打开书架"}
          onClick={onToggleLibrary}
        >
          <Library className="h-4 w-4" />
          <span className="hidden xl:inline">书架</span>
        </Button>
        <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          {readerViewItems.map((item) => (
            <Button
              key={item.view}
              size="sm"
              variant={readerView === item.view ? "secondary" : "ghost"}
              disabled={item.disabled}
              className="h-7 gap-1.5 px-2.5"
              title={readerViewButtonTitle(item.view, item.title, item.disabled, isTauriRuntime())}
              onClick={() => onSelectView(item)}
            >
              {readerViewButtonIcon(item.view, pdfLoadStatus === "loading" && readerView === "pdf")}
              {/* 窄屏(<xl)收起文字，仅留图标，避免顶栏拥挤；标题仍由 title=/选中态保证可辨 */}
              <span className="hidden xl:inline">{item.label}</span>
            </Button>
          ))}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="搜索"
          onClick={onToggleSearch}
        >
          <Search className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="查看引导"
          title="查看引导"
          onClick={onOpenGuide}
        >
          <BookOpen className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="主题" onClick={onToggleTheme}>
          <SunMoon className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="设置"
          data-testid="settings-button"
          onClick={onToggleSettings}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </nav>
    </header>
  )
}

function readerViewButtonTitle(
  view: ReaderView,
  defaultTitle: string,
  disabled: boolean,
  isDesktop: boolean,
) {
  if (!disabled) {
    return defaultTitle
  }
  switch (view) {
    case "translation":
      return isDesktop ? defaultTitle : "对照翻译需要桌面版和 LLM provider"
    case "knowledge":
      return "导入书籍后可查看知识体系"
    case "pdf":
      return "当前书籍没有可用原 PDF 副本"
    default:
      return "导入书籍并生成转换稿后可用"
  }
}

function readerViewButtonIcon(view: ReaderView, pdfLoading: boolean) {
  switch (view) {
    case "text":
      return <FileText className="h-4 w-4" />
    case "tldr":
      return <Sparkles className="h-4 w-4" />
    case "translation":
      return <Languages className="h-4 w-4" />
    case "knowledge":
      return <Network className="h-4 w-4" />
    case "pdf":
      return pdfLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <BookOpen className="h-4 w-4" />
      )
  }
}
