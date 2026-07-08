import { useEffect, useRef } from "react"
import { isTauriRuntime } from "@/core/library-api"
import { dispatchAppMenuAction, type AppMenuHandlers } from "./app-menu-actions"
import { READER_VIEW_ORDER } from "./reader-view-config"

type UseReaderShortcutsDeps = {
  selectionText: string
  runDeepInterpretation: () => void
  setQuestion: (question: string) => void
  onClearSelection: () => void
  /** 与原生菜单共用的同一套 handler；web 快捷键归一到 dispatchAppMenuAction。 */
  appMenuHandlers: AppMenuHandlers
}

/**
 * 阅读区快捷键。分两层，共用一个 keydown 订阅：
 *
 * 1. 选区快捷键（Cmd/Ctrl+E 深读、Escape 清选区）——桌面与浏览器都注册，焦点在
 *    可编辑元素时豁免。
 * 2. 顶栏/原生菜单镜像键（⌘F 搜索、⌘O 导入、⌘L 书库、⌘1-5 切视图、⌘\ 面板）——
 *    **仅浏览器版注册**。桌面版这些组合键已由 macOS 原生菜单加速键消费，走
 *    `listenAppMenuAction` 事件而非 DOM keydown，重复注册会 double-fire，故用
 *    `isTauriRuntime()` 屏蔽。两条路径最终都落到 `dispatchAppMenuAction`，行为一致。
 *
 * mac 用 metaKey、其他平台 ctrlKey（跟随原有 Cmd/Ctrl+E 判断）。⌘F/⌘O/⌘L 按浏览器
 * 惯例即使焦点在输入框也拦截（与原生菜单一致）；⌘1-5/⌘\ 在可编辑元素时不劫持。
 */
export function useReaderShortcuts(deps: UseReaderShortcutsDeps) {
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    const registerAppMenuKeys = !isTauriRuntime()
    const handleKeyDown = (event: KeyboardEvent) => {
      const {
        selectionText,
        runDeepInterpretation,
        setQuestion,
        onClearSelection,
        appMenuHandlers,
      } = depsRef.current
      const mod = event.metaKey || event.ctrlKey
      const editable = isEditableTarget(event.target)

      // 第一层：选区快捷键，焦点在可编辑元素时豁免（保持原行为）。
      if (!editable) {
        if (mod && event.key.toLowerCase() === "e") {
          if (selectionText.trim()) {
            event.preventDefault()
            runDeepInterpretation()
          }
          return
        }
        if (event.key === "Escape") {
          if (selectionText.trim()) {
            event.preventDefault()
            setQuestion("")
            onClearSelection()
          }
          return
        }
      }

      // 第二层：原生菜单镜像键，仅浏览器版注册。
      if (!registerAppMenuKeys || !mod || event.altKey) {
        return
      }
      const actionId = appMenuActionForKey(event, editable)
      if (actionId) {
        event.preventDefault()
        dispatchAppMenuAction(actionId, appMenuHandlers)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])
}

/**
 * 把一个带修饰键的 keydown 映射到原生菜单动作 id；无匹配返回 null。
 * ⌘F/⌘O/⌘L 即使在可编辑元素中也拦截；⌘1-5/⌘\ 在可编辑元素中让行（返回 null）。
 */
function appMenuActionForKey(event: KeyboardEvent, editable: boolean): string | null {
  const key = event.key.toLowerCase()
  switch (key) {
    case "f":
      return "menu:search"
    case "o":
      return "menu:import"
    case "l":
      return "menu:library"
  }
  if (editable) {
    return null
  }
  if (key >= "1" && key <= String(READER_VIEW_ORDER.length)) {
    const view = READER_VIEW_ORDER[Number(key) - 1]
    return `menu:view:${view}`
  }
  if (event.key === "\\") {
    return "menu:sidebar"
  }
  return null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  )
}
