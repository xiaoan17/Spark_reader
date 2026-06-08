import { Copy, Highlighter, MessageSquareText, MoreHorizontal, Zap } from "lucide-react"
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { shouldSubmitTextarea } from "@/components/reader/textarea-submit"

type SelectionToolbarProps = {
  approximate?: boolean
  askOpen?: boolean
  className?: string
  style?: CSSProperties
  visible?: boolean
  disabled?: boolean
  onExplain?: () => void
  onPlainExplain?: () => void
  onAskToggle?: () => void
  onHighlight?: () => void
  onCopy?: () => void
  question?: string
  onQuestionChange?: (question: string) => void
  onQuestionSubmit?: () => void
}

export const SelectionToolbar = forwardRef<HTMLDivElement, SelectionToolbarProps>(function SelectionToolbar({
  approximate = false,
  askOpen = false,
  className,
  style,
  visible = true,
  disabled = false,
  onExplain,
  onPlainExplain,
  onAskToggle,
  onHighlight,
  onCopy,
  question = "",
  onQuestionChange,
  onQuestionSubmit,
}: SelectionToolbarProps, ref) {
  return (
    <div
      ref={ref}
      data-testid="selection-toolbar"
      className={cn(
        "w-fit rounded-lg border bg-card p-2 text-card-foreground shadow-lg transition-[opacity,transform,box-shadow,left,top] duration-subtle ease-reader will-change-transform",
        visible
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none -translate-y-1 scale-95 opacity-0",
        className,
      )}
      style={style}
    >
      <div className="flex items-center gap-1">
        {/* 主操作：唯一 filled primary，眼睛第一落点 */}
        <Button
          size="sm"
          disabled={disabled}
          title="Spark 深度解读（Cmd/Ctrl+E）"
          onClick={onExplain}
        >
          <Zap className="mr-1.5 h-4 w-4" />
          Spark
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          title="轻量解读：跳过检索，快速解释当前选区"
          onClick={onPlainExplain}
        >
          轻量
        </Button>
        {/* 次级常用：标记 */}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onHighlight}>
          <Highlighter className="mr-1.5 h-4 w-4" />
          标记
        </Button>
        {/* 低频动作收进溢出菜单，避免稀释主路径 */}
        <OverflowMenu
          disabled={disabled}
          items={[
            { key: "ask", label: "追问", icon: <MessageSquareText className="h-4 w-4" />, onSelect: onAskToggle },
            { key: "copy", label: "复制", icon: <Copy className="h-4 w-4" />, onSelect: onCopy },
          ]}
        />
        {approximate ? (
          <Badge variant="secondary" className="ml-1">
            近似
          </Badge>
        ) : null}
      </div>
      {askOpen ? (
        <div className="mt-2 flex min-w-[360px] gap-2">
          <textarea
            className="min-h-16 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="输入你的问题或解读要求"
            value={question}
            onChange={(event) => onQuestionChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                onAskToggle?.()
                return
              }
              if (shouldSubmitTextarea(event)) {
                event.preventDefault()
                onQuestionSubmit?.()
              }
            }}
          />
          <Button size="sm" disabled={question.trim().length === 0} onClick={onQuestionSubmit}>
            发送
          </Button>
        </div>
      ) : null}
    </div>
  )
})

type OverflowItem = {
  key: string
  label: string
  icon: ReactNode
  onSelect?: () => void
}

function OverflowMenu({ items, disabled }: { items: OverflowItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="icon"
        variant="ghost"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 min-w-[9rem] animate-pop-in rounded-md border bg-card p-1 text-card-foreground shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={() => {
                setOpen(false)
                item.onSelect?.()
              }}
            >
              <span className="text-muted-foreground">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
