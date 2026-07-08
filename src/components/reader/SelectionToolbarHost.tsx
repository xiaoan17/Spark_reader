import { useEffect, useRef, useState, type CSSProperties } from "react"
import { SelectionToolbar } from "@/components/selection/SelectionToolbar"

export type SelectionToolbarHostProps = {
  present: boolean
  approximate?: boolean
  className?: string
  disabled?: boolean
  suppressed?: boolean
  style?: CSSProperties
  onSizeChange?: (size: { width: number; height: number }) => void
  onExplain: () => void
  onHighlight: () => void
  onPlainExplain: () => void
  onComment?: () => void
  onSaveToObsidian?: () => void
}

export function SelectionToolbarHost({
  present,
  approximate,
  className,
  disabled,
  suppressed = false,
  style,
  onSizeChange,
  onExplain,
  onHighlight,
  onPlainExplain,
  onComment,
  onSaveToObsidian,
}: SelectionToolbarHostProps) {
  const shouldRender = useDelayedPresence(present, 80)
  const toolbarRef = useMeasuredToolbarSize(onSizeChange)
  if (!shouldRender) {
    return null
  }

  return (
    <SelectionToolbar
      ref={toolbarRef}
      approximate={approximate}
      className={className}
      disabled={disabled}
      visible={present && !suppressed}
      style={style}
      onExplain={onExplain}
      onHighlight={onHighlight}
      onPlainExplain={onPlainExplain}
      onComment={onComment}
      onSaveToObsidian={onSaveToObsidian}
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
