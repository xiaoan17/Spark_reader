import { BookMarked, Highlighter, MessageSquare, Zap } from "lucide-react"
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
  onSaveToObsidian?: () => void
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
  onSaveToObsidian,
}: SelectionToolbarProps, ref) {
  return (
    <div
      ref={ref}
      data-testid="selection-toolbar"
      className={cn(
        "w-fit rounded-md border border-neutral-700 bg-neutral-950 p-1 text-neutral-100 shadow-lg transition-[opacity,transform,box-shadow] duration-subtle ease-reader will-change-transform",
        visible
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none -translate-y-1 scale-95 opacity-0",
        className,
      )}
      style={style}
    >
      <div className="flex items-center gap-0.5">
        {/* 主操作：Spark 深度解读 */}
        <Button
          size="sm"
          disabled={disabled}
          className="h-7 bg-primary px-2.5 text-xs text-primary-foreground hover:bg-primary/90"
          title="Spark 深度解读：检索全书证据（Cmd/Ctrl+E）"
          onClick={onExplain}
        >
          <Zap className="mr-1.5 h-3.5 w-3.5" />
          Spark
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-7 px-2.5 text-xs text-neutral-200 hover:bg-white/10 hover:text-white"
          title="轻量解读：快速解释当前选区"
          onClick={onPlainExplain}
        >
          轻量
        </Button>
        {/* 分隔线 */}
        <div className="mx-0.5 h-4 w-px bg-white/20" />
        {onComment ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="批注：把你的 comment 保存为一个 Spark"
            className="h-7 px-2.5 text-xs text-neutral-200 hover:bg-white/10 hover:text-white"
            onClick={onComment}
          >
            <MessageSquare className="mr-1 h-3.5 w-3.5" />
            批注
          </Button>
        ) : null}
        {/* 高亮标记 */}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-7 px-2.5 text-xs text-neutral-200 hover:bg-white/10 hover:text-white"
          onClick={onHighlight}
        >
          <Highlighter className="mr-1 h-3.5 w-3.5" />
          标记
        </Button>
        {onSaveToObsidian ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="存到 Obsidian：把这段高亮追加到你的 vault"
            aria-label="存到 Obsidian"
            className="h-7 px-2 text-xs text-neutral-200 hover:bg-white/10 hover:text-white"
            onClick={onSaveToObsidian}
          >
            <BookMarked className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {approximate ? (
          <Badge variant="secondary" className="ml-1 bg-white/10 text-neutral-200">
            近似
          </Badge>
        ) : null}
      </div>
    </div>
  )
})
