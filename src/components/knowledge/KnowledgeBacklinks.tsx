import { Link2, LocateFixed } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { KnowledgeEmptyBuildAction } from "./KnowledgeEmptyBuildAction"
import { chunkIdEvidenceLabel } from "@/core/citation-display"
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeGraphNode } from "@/stores/reader-store"

type KnowledgeBacklinksProps = {
  graph: KnowledgeGraph | null
  loading?: boolean
  building?: boolean
  onBuildKnowledge?: () => void
  onEvidenceClick: (chunkId: string) => void
}

export function KnowledgeBacklinks({
  graph,
  loading = false,
  building = false,
  onBuildKnowledge,
  onEvidenceClick,
}: KnowledgeBacklinksProps) {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const nodeById = new Map(nodes.map((node) => [node.cardId, node]))
  const groups = buildBacklinkGroups(nodes, edges)

  if (loading && groups.length === 0) {
    return <BacklinkSkeleton />
  }
  if (!graph || groups.length === 0) {
    return (
      <KnowledgeEmptyBuildAction
        title="暂无反链关系。生成知识体系后，这里会按卡片聚合所有可回跳原文的关系。"
        building={building}
        onBuildKnowledge={onBuildKnowledge}
      />
    )
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <article key={group.node.cardId} className="rounded-md border bg-card px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <Badge variant="outline">{labelForCardType(group.node.cardType)}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {group.edges.length} 条反链
                </span>
              </div>
              <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
                {group.node.title}
              </h3>
              {group.node.summary ? (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {group.node.summary}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-2 space-y-1.5">
            {group.edges.slice(0, 8).map((edge) => {
              const otherNode = nodeById.get(
                edge.sourceCardId === group.node.cardId ? edge.targetCardId : edge.sourceCardId,
              )
              return (
                <div key={edge.edgeId} className="rounded-md border bg-background px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="secondary">{labelForEdgeType(edge.edgeType)}</Badge>
                    <span className="line-clamp-1 min-w-0 flex-1">
                      {otherNode?.title ?? edge.sourceCardId}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {Math.round(edge.confidence * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {edge.evidenceChunkIds.map((chunkId) => (
                      <button
                        key={`${edge.edgeId}-${chunkId}`}
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] leading-none text-muted-foreground hover:border-primary hover:text-primary"
                        onClick={() => onEvidenceClick(chunkId)}
                        title={chunkId}
                      >
                        <LocateFixed className="h-3 w-3" />
                        {chunkIdEvidenceLabel(chunkId)}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </article>
      ))}
    </div>
  )
}

function buildBacklinkGroups(nodes: KnowledgeGraphNode[], edges: KnowledgeEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.cardId, node]))
  const edgesByNode = new Map<string, KnowledgeEdge[]>()
  for (const edge of edges) {
    if (!edge.evidenceChunkIds.length) {
      continue
    }
    edgesByNode.set(edge.sourceCardId, [...(edgesByNode.get(edge.sourceCardId) ?? []), edge])
    edgesByNode.set(edge.targetCardId, [...(edgesByNode.get(edge.targetCardId) ?? []), edge])
  }
  return [...edgesByNode.entries()]
    .map(([cardId, nodeEdges]) => ({
      node: nodeById.get(cardId),
      edges: nodeEdges.sort(
        (left, right) =>
          right.confidence - left.confidence || labelForEdgeType(left.edgeType).localeCompare(labelForEdgeType(right.edgeType)),
      ),
    }))
    .filter((group): group is { node: KnowledgeGraphNode; edges: KnowledgeEdge[] } =>
      Boolean(group.node),
    )
    .sort((left, right) => right.edges.length - left.edges.length || left.node.title.localeCompare(right.node.title))
    .slice(0, 32)
}

function BacklinkSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-28 animate-pulse rounded-md border bg-muted" />
      ))}
    </div>
  )
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

function labelForEdgeType(value: string) {
  switch (value) {
    case "mentions":
      return "提及"
    case "same_evidence":
      return "同证据"
    case "nearby":
      return "邻近"
    case "supports":
      return "支持"
    case "contrasts":
      return "对比"
    case "causes":
      return "因果"
    case "part_of":
      return "章节包含"
    case "alias_of":
      return "别名"
    case "sequel":
      return "顺序"
    default:
      return value || "关联"
  }
}
