import { LocateFixed, Map as MapIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { KnowledgeEmptyBuildAction } from "./KnowledgeEmptyBuildAction"
import type { KnowledgeGraph, KnowledgeGraphNode } from "@/stores/reader-store"

type KnowledgeChapterMapProps = {
  graph: KnowledgeGraph | null
  loading?: boolean
  building?: boolean
  onBuildKnowledge?: () => void
  onEvidenceClick: (chunkId: string) => void
}

export function KnowledgeChapterMap({
  graph,
  loading = false,
  building = false,
  onBuildKnowledge,
  onEvidenceClick,
}: KnowledgeChapterMapProps) {
  const groups = buildPageGroups(graph?.nodes ?? [])

  if (loading && groups.length === 0) {
    return <ChapterMapSkeleton />
  }
  if (!graph || groups.length === 0) {
    return (
      <KnowledgeEmptyBuildAction
        title="暂无章节地图。生成知识体系后，这里会按原文页码整理候选卡片。"
        building={building}
        onBuildKnowledge={onBuildKnowledge}
      />
    )
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <section key={group.key} className="rounded-md border bg-card px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <MapIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="truncate text-sm font-semibold">{group.label}</h3>
            </div>
            <Badge variant="secondary">{group.nodes.length}</Badge>
          </div>
          <div className="mt-2 space-y-1.5">
            {group.nodes.map((node) => (
              <ChapterMapNode key={node.cardId} node={node} onEvidenceClick={onEvidenceClick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ChapterMapNode({
  node,
  onEvidenceClick,
}: {
  node: KnowledgeGraphNode
  onEvidenceClick: (chunkId: string) => void
}) {
  const firstEvidence = node.evidence[0]
  return (
    <article className="rounded-md border bg-background px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${colorClassForNode(node.cardType)}`} />
            <Badge variant="outline">{labelForCardType(node.cardType)}</Badge>
            <span className="text-[11px] text-muted-foreground">
              {Math.round(node.confidence * 100)}%
            </span>
          </div>
          <h4 className="mt-1 line-clamp-2 text-xs font-semibold leading-5">{node.title}</h4>
          {node.summary ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
              {node.summary}
            </p>
          ) : null}
        </div>
        {firstEvidence ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] leading-none text-muted-foreground hover:border-primary hover:text-primary"
            onClick={() => onEvidenceClick(firstEvidence.chunkId)}
            title={firstEvidence.quote || firstEvidence.chunkId}
          >
            <LocateFixed className="h-3 w-3" />
            原文
          </button>
        ) : null}
      </div>
    </article>
  )
}

function buildPageGroups(nodes: KnowledgeGraphNode[]) {
  const groups = new Map<number, KnowledgeGraphNode[]>()
  for (const node of nodes) {
    if (node.pageIndex === null || node.pageIndex === undefined || node.evidence.length === 0) {
      continue
    }
    groups.set(node.pageIndex, [...(groups.get(node.pageIndex) ?? []), node])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageIndex, pageNodes]) => ({
      key: `page-${pageIndex}`,
      label: `第 ${pageIndex + 1} 页`,
      nodes: pageNodes.sort((left, right) => {
        const leftRank = rankForNodeType(left.cardType)
        const rightRank = rankForNodeType(right.cardType)
        return leftRank - rightRank || right.confidence - left.confidence || left.title.localeCompare(right.title)
      }),
    }))
    .slice(0, 80)
}

function ChapterMapSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-32 animate-pulse rounded-md border bg-muted" />
      ))}
    </div>
  )
}

function rankForNodeType(cardType: string) {
  switch (cardType) {
    case "summary":
      return 0
    case "event":
      return 1
    case "claim":
      return 2
    case "entity":
      return 3
    case "concept":
      return 4
    case "highlight":
      return 5
    default:
      return 6
  }
}

function labelForCardType(value: string) {
  switch (value) {
    case "highlight":
      return "高亮"
    case "interpretation":
      return "解读"
    case "question":
      return "追问"
    case "note":
      return "笔记"
    case "concept":
      return "概念"
    case "entity":
      return "实体"
    case "event":
      return "事件"
    case "claim":
      return "论点"
    case "summary":
      return "章节"
    default:
      return value || "卡片"
  }
}

function colorClassForNode(cardType: string) {
  switch (cardType) {
    case "event":
      return "bg-amber-500"
    case "claim":
      return "bg-orange-500"
    case "summary":
      return "bg-slate-500"
    case "entity":
      return "bg-emerald-500"
    case "concept":
      return "bg-teal-500"
    case "highlight":
      return "bg-sky-500"
    case "note":
      return "bg-violet-500"
    default:
      return "bg-slate-500"
  }
}
