import { Highlighter, MessageSquare, Zap } from "lucide-react"
import { forwardRef, type CSSProperties } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type SelectionToolbarProps = {
  approximate?: boolean
  className?: string
  style?: CSSProperties
  visible?: boolean
  disabled?: boolean
  onExplain?: () => void
  onPlainExplain?: () => void
  onComment?: () => void
  onHighlight?: () => void
}

export const SelectionToolbar = forwardRef<HTMLDivElement, SelectionToolbarProps>(function SelectionToolbar({
  approximate = false,
  className,
  style,
  visible = true,
  disabled = false,
  onExplain,
  onPlainExplain,
  onComment,
  onHighlight,
}: SelectionToolbarProps, ref) {
  return (
    <div
      ref={ref}
      data-testid="selection-toolbar"
      className={cn(
        "w-fit rounded-lg border bg-card p-2 text-card-foreground shadow-lg transition-[opacity,transform,box-shadow] duration-subtle ease-reader will-change-transform",
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
          title="Spark 深度解读：检索全书证据（Cmd/Ctrl+E）"
          onClick={onExplain}
        >
          <Zap className="mr-1.5 h-4 w-4" />
          Spark
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          title="轻量解读：快速解释当前选区"
          onClick={onPlainExplain}
        >
          轻量
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          title="批注：把你的 comment 保存为一个 Spark"
          onClick={onComment}
        >
          <MessageSquare className="mr-1.5 h-4 w-4" />
          批注
        </Button>
        {/* 次级常用：标记 */}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onHighlight}>
          <Highlighter className="mr-1.5 h-4 w-4" />
          标记
        </Button>
        {approximate ? (
          <Badge variant="secondary" className="ml-1">
            近似
          </Badge>
        ) : null}
      </div>
    </div>
  )
})
