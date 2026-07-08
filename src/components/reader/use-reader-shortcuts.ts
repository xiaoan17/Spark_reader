import { useEffect } from "react"

type UseReaderShortcutsDeps = {
  selectionText: string
  runDeepInterpretation: () => void
  setQuestion: (question: string) => void
  onClearSelection: () => void
  onDeepInterpret: () => void
  onPlainExplain: () => void
  onWorkbenchTabChange: (tab: "spark" | "tasks") => void
  onCurrentThreadLightweightChange: (enabled: boolean) => void
}

/**
 * 阅读区快捷键：Cmd/Ctrl+E 触发深度解读、Escape 清除选区（都只在有选区且焦点不在
 * 可编辑元素时生效）。依赖数组与原 ReaderShell effect 保持一致，避免订阅时机变化。
 */
export function useReaderShortcuts({
  selectionText,
  runDeepInterpretation,
  setQuestion,
  onClearSelection,
  onDeepInterpret,
  onPlainExplain,
  onWorkbenchTabChange,
  onCurrentThreadLightweightChange,
}: UseReaderShortcutsDeps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
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
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectionText, onClearSelection, onDeepInterpret, onPlainExplain, onWorkbenchTabChange, onCurrentThreadLightweightChange])
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
