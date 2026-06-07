import { Copy, Highlighter, MessageSquareText, SearchCheck, Sparkles, WandSparkles } from "lucide-react"
import { forwardRef, type CSSProperties } from "react"
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
  onApplyInterpret?: () => void
  onAskToggle?: () => void
  onSpark?: () => void
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
  onApplyInterpret,
  onAskToggle,
  onSpark,
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
        <Button size="sm" disabled={disabled} onClick={onPlainExplain ?? onExplain}>
          <SearchCheck className="mr-1.5 h-4 w-4" />
          解读
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onAskToggle}>
          <MessageSquareText className="mr-1.5 h-4 w-4" />
          追问
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onApplyInterpret}>
          <WandSparkles className="mr-1.5 h-4 w-4" />
          迁移
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onSpark}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          Spark
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onHighlight}>
          <Highlighter className="mr-1.5 h-4 w-4" />
          标记
        </Button>
        <Button size="icon" variant="ghost" aria-label="复制" disabled={disabled} onClick={onCopy}>
          <Copy className="h-4 w-4" />
        </Button>
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
