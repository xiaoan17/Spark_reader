import { CalendarDays, LocateFixed } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { KnowledgeEmptyBuildAction } from "./KnowledgeEmptyBuildAction"
import type { KnowledgeGraph, KnowledgeGraphNode } from "@/stores/reader-store"

type KnowledgeTimelineProps = {
  graph: KnowledgeGraph | null
  loading?: boolean
  building?: boolean
  onBuildKnowledge?: () => void
  onEvidenceClick: (chunkId: string) => void
}

export function KnowledgeTimeline({
  graph,
  loading = false,
  building = false,
  onBuildKnowledge,
  onEvidenceClick,
}: KnowledgeTimelineProps) {
  const events = (graph?.nodes ?? [])
    .filter((node) => node.cardType === "event")
    .sort((left, right) => {
      const leftPage = left.pageIndex ?? Number.MAX_SAFE_INTEGER
      const rightPage = right.pageIndex ?? Number.MAX_SAFE_INTEGER
      return leftPage - rightPage || left.title.localeCompare(right.title)
    })

  if (loading && events.length === 0) {
    return <TimelineSkeleton />
  }
  if (!graph || events.length === 0) {
    return (
      <KnowledgeEmptyBuildAction
        title="暂无事件时间线。生成知识体系后，有时间顺序或行动描述的段落会进入这里。"
        building={building}
        onBuildKnowledge={onBuildKnowledge}
      />
    )
  }

  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <TimelineItem
          key={event.cardId}
          event={event}
          index={index}
          onEvidenceClick={onEvidenceClick}
        />
      ))}
    </div>
  )
}

function TimelineItem({
  event,
  index,
  onEvidenceClick,
}: {
  event: KnowledgeGraphNode
  index: number
  onEvidenceClick: (chunkId: string) => void
}) {
  return (
    <article className="relative rounded-md border bg-card px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <Badge variant="outline">事件</Badge>
            <span className="text-[11px] text-muted-foreground">
              {event.pageIndex === null || event.pageIndex === undefined
                ? "页码未知"
                : `第 ${event.pageIndex + 1} 页`}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {Math.round(event.confidence * 100)}%
            </span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">{event.title}</h3>
          {event.summary ? (
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
              {event.summary}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {event.evidence.map((item) => (
              <button
                key={`${event.cardId}-${item.chunkId}-${item.role}`}
                type="button"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] leading-none text-muted-foreground hover:border-primary hover:text-primary"
                onClick={() => onEvidenceClick(item.chunkId)}
                title={item.quote || item.chunkId}
              >
                <LocateFixed className="h-3 w-3" />
                [{item.chunkId}]
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}

function TimelineSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-24 animate-pulse rounded-md border bg-muted" />
      ))}
    </div>
  )
}
