import { useEffect, useRef, useState, type CSSProperties } from "react"
import { SelectionToolbar } from "@/components/selection/SelectionToolbar"

export type SelectionToolbarHostProps = {
  present: boolean
  approximate?: boolean
  askOpen: boolean
  className?: string
  disabled?: boolean
  question: string
  suppressed?: boolean
  style?: CSSProperties
  onSizeChange?: (size: { width: number; height: number }) => void
  onAskToggle: () => void
  onCopy: () => void
  onExplain: () => void
  onHighlight: () => void
  onPlainExplain: () => void
  onSpark?: () => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: () => void
}

export function SelectionToolbarHost({
  present,
  approximate,
  askOpen,
  className,
  disabled,
  question,
  suppressed = false,
  style,
  onSizeChange,
  onAskToggle,
  onCopy,
  onExplain,
  onHighlight,
  onPlainExplain,
  onSpark = () => undefined,
  onQuestionChange,
  onQuestionSubmit,
}: SelectionToolbarHostProps) {
  const shouldRender = useDelayedPresence(present, 180)
  const toolbarRef = useMeasuredToolbarSize(onSizeChange)
  if (!shouldRender) {
    return null
  }

  return (
    <SelectionToolbar
      ref={toolbarRef}
      approximate={approximate}
      askOpen={askOpen}
      className={className}
      disabled={disabled}
      question={question}
      visible={present && !suppressed}
      style={style}
      onAskToggle={onAskToggle}
      onCopy={onCopy}
      onExplain={onExplain}
      onHighlight={onHighlight}
      onPlainExplain={onPlainExplain}
      onSpark={onSpark}
      onQuestionChange={onQuestionChange}
      onQuestionSubmit={onQuestionSubmit}
    />
  )
}

function useMeasuredToolbarSize(onSizeChange?: (size: { width: number; height: number }) => void) {
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const element = toolbarRef.current
    if (!element || !onSizeChange) {
      return
    }
    const publishSize = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.ceil(rect.width)
      const height = Math.ceil(rect.height)
      if (width <= 0 || height <= 0) {
        return
      }
      const last = lastSizeRef.current
      if (last?.width === width && last.height === height) {
        return
      }
      lastSizeRef.current = { width, height }
      onSizeChange({ width, height })
    }
    publishSize()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publishSize)
      return () => window.removeEventListener("resize", publishSize)
    }
    const observer = new ResizeObserver(publishSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [onSizeChange])

  return toolbarRef
}

function useDelayedPresence(present: boolean, delayMs: number) {
  const [shouldRender, setShouldRender] = useState(present)

  useEffect(() => {
    if (present) {
      setShouldRender(true)
      return
    }
    const timer = window.setTimeout(() => setShouldRender(false), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, present])

  return shouldRender
}
