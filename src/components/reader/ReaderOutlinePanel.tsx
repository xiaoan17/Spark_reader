import { BookOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ReaderOutlineEntry } from "./reader-outline"

type ReaderOutlinePanelProps = {
  entries: ReaderOutlineEntry[]
  currentPage: number
  className?: string
  onSelect: (entry: ReaderOutlineEntry) => void
}

export function ReaderOutlinePanel({
  entries,
  currentPage,
  className,
  onSelect,
}: ReaderOutlinePanelProps) {
  if (entries.length === 0) {
    return null
  }

  return (
    <div className={cn("flex min-h-0 flex-col rounded-md border bg-background p-2 text-xs", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          目录
        </div>
        <Badge variant="secondary">{entries.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto pr-1">
        {entries.map((entry) => {
          const isActivePage = entry.pageIndex + 1 === currentPage
          return (
            <button
              key={entry.id}
              className={cn(
                "block w-full rounded py-1.5 pr-2 text-left",
                isActivePage ? "bg-primary/10" : "hover:bg-muted",
              )}
              style={{ paddingLeft: `${8 + (Math.min(entry.level, 5) - 1) * 12}px` }}
              onClick={() => onSelect(entry)}
            >
              <span className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {entry.sectionNumber ? (
                      <span className="mr-1.5 text-muted-foreground">{entry.sectionNumber}</span>
                    ) : null}
                    {entry.title}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {entry.pageIndex + 1}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
