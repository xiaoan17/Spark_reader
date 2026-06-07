import { GitBranch, LocateFixed } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { KnowledgeEmptyBuildAction } from "./KnowledgeEmptyBuildAction"
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeGraphNode } from "@/stores/reader-store"

type KnowledgeGraphViewProps = {
  graph: KnowledgeGraph | null
  loading?: boolean
  building?: boolean
  onBuildKnowledge?: () => void
  onEvidenceClick: (chunkId: string) => void
}

type PositionedNode = KnowledgeGraphNode & {
  x: number
  y: number
}

const GRAPH_WIDTH = 560
const GRAPH_HEIGHT = 300
const NODE_RADIUS = 18

export function KnowledgeGraphView({
  graph,
  loading = false,
  building = false,
  onBuildKnowledge,
  onEvidenceClick,
}: KnowledgeGraphViewProps) {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  if (loading && nodes.length === 0) {
    return <GraphSkeleton />
  }
  if (!graph || nodes.length === 0) {
    return (
      <KnowledgeEmptyBuildAction
        title="暂无图谱节点。先从整本书生成论点、事件和概念候选，再查看关系网络。"
        building={building}
        onBuildKnowledge={onBuildKnowledge}
      />
    )
  }

  const positioned = layoutGraphNodes(nodes)
  const nodeById = new Map(positioned.map((node) => [node.cardId, node]))

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border bg-card">
        <svg
          className="h-[300px] w-full"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="img"
          aria-label="知识图谱"
        >
          <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="hsl(var(--background))" />
          {edges.slice(0, 90).map((edge) => {
            const source = nodeById.get(edge.sourceCardId)
            const target = nodeById.get(edge.targetCardId)
            if (!source || !target) {
              return null
            }
            return (
              <line
                key={edge.edgeId}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={colorForEdge(edge.edgeType)}
                strokeOpacity={0.55}
                strokeWidth={edge.edgeType === "mentions" ? 1.5 : 1}
              />
            )
          })}
          {positioned.map((node) => (
            <g key={node.cardId} transform={`translate(${node.x} ${node.y})`}>
              <circle
                r={NODE_RADIUS}
                fill={colorForNode(node.cardType)}
                stroke="hsl(var(--background))"
                strokeWidth="2"
              />
              <text
                y={4}
                textAnchor="middle"
                className="fill-primary-foreground text-[10px] font-semibold"
              >
                {shortNodeLabel(node)}
              </text>
              <title>{node.title}</title>
            </g>
          ))}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
        <LegendItem color="bg-sky-500" label="阅读痕迹" />
        <LegendItem color="bg-emerald-500" label="实体/概念" />
        <LegendItem color="bg-amber-500" label="事件" />
        <LegendItem color="bg-slate-500" label="证据关系" />
      </div>

      <div className="space-y-1.5">
        {edges.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            暂无关系边
          </div>
        ) : (
          edges.slice(0, 24).map((edge) => (
            <GraphEdgeItem
              key={edge.edgeId}
              edge={edge}
              source={nodeById.get(edge.sourceCardId)}
              target={nodeById.get(edge.targetCardId)}
              onEvidenceClick={onEvidenceClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

function GraphEdgeItem({
  edge,
  source,
  target,
  onEvidenceClick,
}: {
  edge: KnowledgeEdge
  source?: KnowledgeGraphNode
  target?: KnowledgeGraphNode
  onEvidenceClick: (chunkId: string) => void
}) {
  return (
    <article className="rounded-md border bg-card px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <Badge variant="outline">{labelForEdgeType(edge.edgeType)}</Badge>
            <span className="text-[11px] text-muted-foreground">
              {Math.round(edge.confidence * 100)}%
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5">
            <span className="font-medium">{source?.title ?? edge.sourceCardId}</span>
            <span className="px-1 text-muted-foreground">→</span>
            <span className="font-medium">{target?.title ?? edge.targetCardId}</span>
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {edge.evidenceChunkIds.map((chunkId) => (
          <button
            key={`${edge.edgeId}-${chunkId}`}
            type="button"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] leading-none text-muted-foreground hover:border-primary hover:text-primary"
            onClick={() => onEvidenceClick(chunkId)}
            title={chunkId}
          >
            <LocateFixed className="h-3 w-3" />
            [{chunkId}]
          </button>
        ))}
      </div>
    </article>
  )
}

function GraphSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-[300px] animate-pulse rounded-md border bg-muted" />
      <div className="h-16 animate-pulse rounded-md border bg-muted" />
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  )
}

function layoutGraphNodes(nodes: KnowledgeGraphNode[]): PositionedNode[] {
  const groups = new Map<string, KnowledgeGraphNode[]>()
  for (const node of nodes.slice(0, 72)) {
    groups.set(groupForNode(node), [...(groups.get(groupForNode(node)) ?? []), node])
  }
  const groupEntries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  const centerX = GRAPH_WIDTH / 2
  const centerY = GRAPH_HEIGHT / 2
  if (groupEntries.length === 0) {
    return []
  }
  return groupEntries.flatMap(([group, groupNodes], groupIndex) => {
    const groupAngle = (Math.PI * 2 * groupIndex) / groupEntries.length - Math.PI / 2
    const groupRadius = groupEntries.length === 1 ? 0 : 86
    const groupCenterX = centerX + Math.cos(groupAngle) * groupRadius
    const groupCenterY = centerY + Math.sin(groupAngle) * groupRadius
    return groupNodes.map((node, nodeIndex) => {
      const angle = (Math.PI * 2 * nodeIndex) / Math.max(1, groupNodes.length) - Math.PI / 2
      const radius = groupNodes.length <= 1 ? 0 : Math.min(68, 26 + groupNodes.length * 4)
      return {
        ...node,
        x: clamp(groupCenterX + Math.cos(angle) * radius, NODE_RADIUS + 8, GRAPH_WIDTH - NODE_RADIUS - 8),
        y: clamp(groupCenterY + Math.sin(angle) * radius, NODE_RADIUS + 8, GRAPH_HEIGHT - NODE_RADIUS - 8),
      }
    })
  })
}

function groupForNode(node: KnowledgeGraphNode) {
  if (node.cardType === "summary") {
    return "0-section"
  }
  if (node.cardType === "event" || node.cardType === "claim") {
    return "3-event"
  }
  if (node.cardType === "entity" || node.cardType === "concept") {
    return "2-candidate"
  }
  return "1-source"
}

function shortNodeLabel(node: KnowledgeGraphNode) {
  const title = node.title.trim()
  if (!title) {
    return "?"
  }
  return [...title].slice(0, 2).join("")
}

function colorForNode(cardType: string) {
  switch (cardType) {
    case "entity":
      return "#10b981"
    case "concept":
      return "#14b8a6"
    case "event":
      return "#f59e0b"
    case "claim":
      return "#d97706"
    case "summary":
      return "#64748b"
    case "highlight":
      return "#0ea5e9"
    case "note":
      return "#8b5cf6"
    default:
      return "#64748b"
  }
}

function colorForEdge(edgeType: string) {
  switch (edgeType) {
    case "supports":
      return "#16a34a"
    case "contrasts":
      return "#dc2626"
    case "causes":
      return "#d97706"
    case "mentions":
      return "#2563eb"
    case "part_of":
      return "#64748b"
    case "alias_of":
      return "#0891b2"
    case "sequel":
      return "#7c3aed"
    default:
      return "#64748b"
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
