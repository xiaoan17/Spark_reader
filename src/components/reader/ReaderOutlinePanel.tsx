import { BookOpen } from "lucide-react"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { ReaderOutlineEntry } from "./reader-outline"

type ReaderOutlinePanelProps = {
  entries: ReaderOutlineEntry[]
  currentPage: number
  activeEntryId?: string
  className?: string
  onSelect: (entry: ReaderOutlineEntry) => void
}

export function ReaderOutlinePanel({
  entries,
  currentPage,
  activeEntryId,
  className,
  onSelect,
}: ReaderOutlinePanelProps) {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    const activeEntry =
      entries.find((entry) => entry.id === activeEntryId) ??
      activeOutlineEntryForPage(entries, currentPage)
    if (!activeEntry) {
      return
    }
    itemRefs.current.get(activeEntry.id)?.scrollIntoView({ block: "nearest" })
  }, [activeEntryId, currentPage, entries])

  if (entries.length === 0) {
    return null
  }

  const activeEntry =
    (activeEntryId ? entries.find((candidate) => candidate.id === activeEntryId) : undefined) ??
    activeOutlineEntryForPage(entries, currentPage)

  return (
    <div
      className={cn("flex min-h-0 flex-col rounded-md border bg-background p-2 text-xs", className)}
      data-reader-outline-panel
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          目录
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto pr-1">
        {entries.map((entry) => {
          const isActivePage = entry.id === activeEntry?.id
          return (
            <button
              key={entry.id}
              ref={(element) => {
                if (element) {
                  itemRefs.current.set(entry.id, element)
                } else {
                  itemRefs.current.delete(entry.id)
                }
              }}
              className={cn(
                "block w-full rounded py-1.5 pr-2 text-left",
                isActivePage ? "bg-primary/10" : "hover:bg-muted",
              )}
              style={{ paddingLeft: `${8 + (Math.min(entry.level, 5) - 1) * 12}px` }}
              onClick={() => onSelect(entry)}
            >
              <span className="block min-w-0 truncate font-medium">
                {entry.sectionNumber ? (
                  <span className="mr-1.5 text-muted-foreground">{entry.sectionNumber}</span>
                ) : null}
                {entry.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function activeOutlineEntryForPage(entries: ReaderOutlineEntry[], currentPage: number) {
  let active: ReaderOutlineEntry | undefined
  for (const entry of entries) {
    if (entry.pageIndex + 1 > currentPage) {
      break
    }
    active = entry
  }
  return active ?? entries.find((entry) => entry.pageIndex + 1 === currentPage)
}
