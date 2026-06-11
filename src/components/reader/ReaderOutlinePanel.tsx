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
      className={cn("flex min-h-0 flex-col text-xs", className)}
      data-reader-outline-panel
    >
      <div className="reader-panel reader-panel-border reader-panel-muted sticky top-0 z-10 border-b px-3.5 py-3 text-[11px] font-semibold">
        目录
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
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
                "reader-panel-row flex w-full items-start gap-2 py-[7px] pr-3.5 text-left text-[13px] leading-snug transition-colors duration-100",
                isActivePage
                  ? "reader-panel-row-active font-medium"
                  : "reader-panel-muted",
              )}
              style={{ paddingLeft: `${14 + (Math.min(entry.level, 5) - 1) * 12}px` }}
              onClick={() => onSelect(entry)}
            >
              <span className="min-w-0 flex-1 truncate">
                {entry.sectionNumber ? (
                  <span className={cn("mr-1.5", isActivePage ? "opacity-75" : "reader-panel-muted")}>
                    {entry.sectionNumber}
                  </span>
                ) : null}
                {entry.title}
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  isActivePage ? "opacity-75" : "reader-panel-muted opacity-75",
                )}
              >
                {entry.pageIndex + 1}
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
