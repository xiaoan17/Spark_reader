import { Copy, Highlighter, MessageSquareText, SearchCheck, Sparkles } from "lucide-react"
import type { CSSProperties } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type SelectionToolbarProps = {
  approximate?: boolean
  askOpen?: boolean
  className?: string
  style?: CSSProperties
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

export function SelectionToolbar({
  approximate = false,
  askOpen = false,
  className,
  style,
  disabled = false,
  onExplain,
  onPlainExplain,
  onAskToggle,
  onHighlight,
  onCopy,
  question = "",
  onQuestionChange,
  onQuestionSubmit,
}: SelectionToolbarProps) {
  return (
    <div
      data-testid="selection-toolbar"
      className={cn(
        "w-fit rounded-lg border bg-card p-2 text-card-foreground shadow-lg transition-[opacity,transform,box-shadow] duration-150 ease-out will-change-transform",
        className,
      )}
      style={style}
    >
      <div className="flex items-center gap-1">
        <Button size="sm" disabled={disabled} onClick={onExplain}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          深度解读
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onPlainExplain}>
          <SearchCheck className="mr-1.5 h-4 w-4" />
          它在说什么
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onAskToggle}>
          <MessageSquareText className="mr-1.5 h-4 w-4" />
          提问
        </Button>
        <Button size="icon" variant="ghost" aria-label="高亮" disabled={disabled} onClick={onHighlight}>
          <Highlighter className="h-4 w-4" />
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
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
}
