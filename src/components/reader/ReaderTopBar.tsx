import {
  BookOpen,
  FileText,
  Languages,
  Library,
  Loader2,
  Network,
  Palette,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  Upload,
  Check,
} from "lucide-react"
import { useEffect, useRef, useState, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { isTauriRuntime } from "@/core/library-api"
import { cn } from "@/lib/utils"
import type { ReaderView } from "./highlight-target-view"
import type { ReaderViewConfig } from "./reader-view-config"
import { readerViewHeaderLabel } from "./reader-view-config"
import type { ReaderDisplayTheme, ReaderDisplayThemeId } from "./reader-display-theme"

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
  readerDisplayThemeId: ReaderDisplayThemeId
  readerDisplayThemeItems: ReaderDisplayTheme[]
  fileInputRef: RefObject<HTMLInputElement | null>
  onToggleSidebar: () => void
  onFileSelected: (file: File) => void
  onImportMenuOpen: () => void
  onToggleLibrary: () => void
  onSelectView: (item: ReaderViewConfig) => void
  onToggleSearch: () => void
  onOpenGuide: () => void
  onReaderDisplayThemeChange: (themeId: ReaderDisplayThemeId) => void
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
  runtimeLabel: _runtimeLabel,
  llmProviderText: _llmProviderText,
  llmProviderTitle,
  importButtonLabel,
  isExtracting,
  importMenuOpen,
  libraryOpen: _libraryOpen,
  pdfLoadStatus,
  readerViewItems,
  readerDisplayThemeId,
  readerDisplayThemeItems,
  fileInputRef,
  onToggleSidebar,
  onFileSelected,
  onImportMenuOpen,
  onToggleLibrary,
  onSelectView,
  onToggleSearch,
  onOpenGuide: _onOpenGuide,
  onReaderDisplayThemeChange,
  onToggleSettings,
}: ReaderTopBarProps) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement | null>(null)
  const llmReady = _llmProviderText && _llmProviderText !== "provider 未读取" && _llmProviderText !== "本地兜底"
  const readerDisplayTheme = readerDisplayThemeItems.find((item) => item.id === readerDisplayThemeId)

  useEffect(() => {
    if (!themeMenuOpen) {
      return
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && themeMenuRef.current?.contains(target)) {
        return
      }
      setThemeMenuOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [themeMenuOpen])

  return (
    <header className="reader-chrome-bar flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className="reader-chrome-icon-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="收起阅读侧栏"
          onClick={onToggleSidebar}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
        {/* AI 就绪状态点 */}
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            llmReady ? "reader-provider-dot-active" : "reader-provider-dot",
          )}
          title={llmReady ? `AI: ${_llmProviderText}` : llmReady === false ? "AI provider 未配置" : llmProviderTitle}
          data-testid="llm-provider-badge"
        />
        <span className="truncate text-sm font-semibold" title={bookTitle}>
          {bookTitle}
        </span>
        {totalPages > 0 && readerView !== "text" ? (
          <span className="sr-only">{readerViewHeaderLabel(readerView)}</span>
        ) : null}
      </div>

      <nav className="flex shrink-0 items-center gap-1" aria-label="阅读工具栏">
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

        {/* 视图切换：纯图标 pill，无外层 border 容器 */}
        <div className="flex items-center" role="group" aria-label="切换视图">
          {readerViewItems.map((item) => (
            <button
              key={item.view}
              disabled={item.disabled}
              className={cn(
                "reader-chrome-view-button flex h-7 w-7 items-center justify-center rounded-md border-none transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring",
                readerView === item.view && "reader-chrome-view-active",
                item.disabled && "cursor-not-allowed opacity-40",
              )}
              title={readerViewButtonTitle(item.view, item.title, item.disabled, isTauriRuntime())}
              onClick={() => !item.disabled && onSelectView(item)}
            >
              {readerViewButtonIcon(item.view, pdfLoadStatus === "loading" && readerView === "pdf")}
              <span className="sr-only">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="reader-chrome-divider mx-1 h-4 w-px shrink-0" />

        <Button
          size="sm"
          disabled={isExtracting}
          className="h-7 px-2.5 text-xs"
          aria-expanded={importMenuOpen}
          onClick={onImportMenuOpen}
        >
          {isExtracting ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1 h-3.5 w-3.5" />
          )}
          {importButtonLabel}
        </Button>

        <button
          type="button"
          className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="打开书架"
          title="打开书架"
          onClick={onToggleLibrary}
        >
          <Library className="h-4 w-4" />
          <span className="sr-only">书架</span>
        </button>

        <button
          type="button"
          className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="搜索"
          onClick={onToggleSearch}
        >
          <Search className="h-4 w-4" />
        </button>

        <div ref={themeMenuRef} className="relative">
          <button
            type="button"
            className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="阅读外观"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            title={readerDisplayTheme ? `阅读外观：${readerDisplayTheme.label}` : "阅读外观"}
            data-testid="reader-display-theme-button"
            onClick={() => setThemeMenuOpen((open) => !open)}
          >
            <Palette className="h-4 w-4" />
          </button>
          {themeMenuOpen ? (
            <div
              role="menu"
              aria-label="阅读外观"
              className="reader-floating-surface absolute right-0 top-8 z-50 w-64 overflow-hidden rounded-md border py-1 shadow-lg"
              data-testid="reader-display-theme-menu"
            >
              {readerDisplayThemeItems.map((item) => {
                const selected = item.id === readerDisplayThemeId
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={cn(
                      "reader-floating-item flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-100",
                      selected && "reader-floating-item-active",
                    )}
                    onClick={() => {
                      onReaderDisplayThemeChange(item.id)
                      setThemeMenuOpen(false)
                    }}
                  >
                    <span className="reader-panel-accent mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="reader-panel-text block text-xs font-medium">
                        {item.label}
                        {item.sourceName !== "current" ? (
                          <span className="reader-floating-muted ml-1 font-normal">
                            {item.sourceName}
                          </span>
                        ) : null}
                      </span>
                      <span className="reader-floating-muted mt-0.5 block text-[11px] leading-4">
                        {item.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="设置"
          data-testid="settings-button"
          onClick={onToggleSettings}
        >
          <Settings className="h-4 w-4" />
        </button>
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
