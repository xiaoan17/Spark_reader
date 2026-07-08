import type { ReaderView } from "./highlight-target-view"

/**
 * macOS 原生菜单动作分发:Rust 侧每个菜单项 emit `app-menu://action` + 自己的
 * id,这里把 id 映射回顶栏同一套 handler,保证菜单和顶栏永不分叉。
 */
export type AppMenuHandlers = {
  onImport: () => void
  onToggleLibrary: () => void
  onToggleSearch: () => void
  onToggleSettings: () => void
  onOpenObsidianSettings: () => void
  onToggleSidebar: () => void
  onToggleAppearance: () => void
  onSelectView: (view: ReaderView) => void
}

const VIEW_PREFIX = "menu:view:"

const READER_VIEWS: readonly ReaderView[] = [
  "text",
  "tldr",
  "translation",
  "knowledge",
  "pdf",
]

/** 分发一个菜单动作 id;返回 false 表示未知 id(静默忽略,向前兼容)。 */
export function dispatchAppMenuAction(
  actionId: string,
  handlers: AppMenuHandlers,
): boolean {
  if (actionId.startsWith(VIEW_PREFIX)) {
    const view = actionId.slice(VIEW_PREFIX.length)
    if ((READER_VIEWS as readonly string[]).includes(view)) {
      handlers.onSelectView(view as ReaderView)
      return true
    }
    return false
  }
  switch (actionId) {
    case "menu:import":
      handlers.onImport()
      return true
    case "menu:library":
      handlers.onToggleLibrary()
      return true
    case "menu:search":
      handlers.onToggleSearch()
      return true
    case "menu:settings":
      handlers.onToggleSettings()
      return true
    case "menu:obsidian":
      handlers.onOpenObsidianSettings()
      return true
    case "menu:sidebar":
      handlers.onToggleSidebar()
      return true
    case "menu:appearance":
      handlers.onToggleAppearance()
      return true
    default:
      return false
  }
}
