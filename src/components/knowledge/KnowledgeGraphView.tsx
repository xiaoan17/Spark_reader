import { GitBranch, LocateFixed } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { KnowledgeEmptyBuildAction } from "./KnowledgeEmptyBuildAction"
import { chunkIdEvidenceLabel } from "@/core/citation-display"
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeGraphNode } from "@/stores/reader-store"

type KnowledgeGraphViewProps = {
  graph: KnowledgeGraph | null
  loading?: boolean
  building?: boolean
  onBuildKnowledge?: () => void
  onEvidenceClick: (chunkId: string) => void
}

type GraphLane = {
  key: string
  label: string
  y: number
}

type PageBucket = {
  key: string
  label: string
  shortLabel: string
  centerPage: number | null
}

type GraphBucket = {
  key: string
  lane: GraphLane
  page: PageBucket
  x: number
  y: number
  r: number
  nodes: KnowledgeGraphNode[]
  relationCount: number
  dominantCardType: string
}

type GraphBucketEdge = {
  key: string
  source: GraphBucket
  target: GraphBucket
  edgeType: string
  count: number
  confidence: number
  evidenceChunkIds: string[]
}

type GraphModel = {
  buckets: GraphBucket[]
  bucketEdges: GraphBucketEdge[]
  pageTicks: PageBucket[]
  pageScale: PageScale
  selectedNodeCount: number
  totalNodeCount: number
  selectedEdgeCount: number
  totalEdgeCount: number
  pageRangeLabel: string
}

type PageScale = {
  min: number
  max: number
} | null

const GRAPH_WIDTH = 920
const GRAPH_HEIGHT = 360
const PLOT_LEFT = 92
const PLOT_RIGHT = GRAPH_WIDTH - 42
const PLOT_TOP = 36
const PLOT_BOTTOM = GRAPH_HEIGHT - 36
const MAX_GRAPH_NODES = 180
const MAX_PAGE_BUCKETS = 22
const MAX_BUCKET_EDGES = 120

const GRAPH_LANES: GraphLane[] = [
  { key: "source", label: "阅读痕迹", y: 76 },
  { key: "argument", label: "章节/论点", y: 146 },
  { key: "knowledge", label: "实体/概念", y: 216 },
  { key: "event", label: "事件", y: 286 },
]

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

  const nodeById = new Map(nodes.map((node) => [node.cardId, node]))
  const model = buildGraphModel(nodes, edges)
  const rankedEdges = rankGraphEdges(edges, nodeById).slice(0, 24)

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border bg-card">
        <svg
          className="h-[360px] w-full"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="img"
          aria-label="知识图谱"
        >
          <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="hsl(var(--background))" />
          <rect
            x={PLOT_LEFT}
            y={PLOT_TOP}
            width={PLOT_RIGHT - PLOT_LEFT}
            height={PLOT_BOTTOM - PLOT_TOP}
            fill="hsl(var(--muted) / 0.22)"
          />

          {model.pageTicks.map((tick) => (
            <g key={tick.key}>
              <line
                x1={xForPageBucket(tick, model.pageScale)}
                y1={PLOT_TOP}
                x2={xForPageBucket(tick, model.pageScale)}
                y2={PLOT_BOTTOM}
                stroke="hsl(var(--border))"
                strokeDasharray="4 6"
                strokeWidth="1"
              />
              <text
                x={xForPageBucket(tick, model.pageScale)}
                y={GRAPH_HEIGHT - 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {tick.shortLabel}
              </text>
            </g>
          ))}

          {GRAPH_LANES.map((lane) => (
            <g key={lane.key}>
              <line
                x1={PLOT_LEFT}
                y1={lane.y}
                x2={PLOT_RIGHT}
                y2={lane.y}
                stroke="hsl(var(--border))"
                strokeWidth="1"
              />
              <text
                x={18}
                y={lane.y + 4}
                className="fill-muted-foreground text-[11px] font-medium"
              >
                {lane.label}
              </text>
            </g>
          ))}

          {model.bucketEdges.map((edge) => (
            <path
              key={edge.key}
              d={pathForBucketEdge(edge)}
              fill="none"
              stroke={colorForEdge(edge.edgeType)}
              strokeOpacity={0.24}
              strokeWidth={clamp(1 + Math.sqrt(edge.count) * 0.65, 1.25, 4)}
            >
              <title>
                {labelForEdgeType(edge.edgeType)} {edge.count} 条
              </title>
            </path>
          ))}

          {model.buckets.map((bucket) => {
            const chunkId = firstBucketEvidenceChunkId(bucket)
            return (
              <g
                key={bucket.key}
                className={chunkId ? "cursor-pointer" : undefined}
                transform={`translate(${bucket.x} ${bucket.y})`}
                role={chunkId ? "button" : undefined}
                tabIndex={chunkId ? 0 : undefined}
                onClick={() => {
                  if (chunkId) {
                    onEvidenceClick(chunkId)
                  }
                }}
                onKeyDown={(event) => {
                  if (chunkId && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault()
                    onEvidenceClick(chunkId)
                  }
                }}
              >
                <circle
                  r={bucket.r}
                  fill={colorForNode(bucket.dominantCardType)}
                  fillOpacity={bucket.nodes.length > 1 ? 0.9 : 0.82}
                  stroke="hsl(var(--background))"
                  strokeWidth="2"
                />
                <circle
                  r={bucket.r + 2}
                  fill="none"
                  stroke={colorForNode(bucket.dominantCardType)}
                  strokeOpacity={bucket.relationCount > 0 ? 0.32 : 0.12}
                  strokeWidth={clamp(Math.sqrt(bucket.relationCount + 1) * 0.45, 1, 4)}
                />
                <text
                  y={4}
                  textAnchor="middle"
                  className="pointer-events-none fill-primary-foreground text-[10px] font-semibold"
                >
                  {bucket.nodes.length > 1 ? bucket.nodes.length : shortNodeLabel(bucket.nodes[0])}
                </text>
                <title>{bucketTitle(bucket)}</title>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[11px] md:grid-cols-4">
        <GraphMetric label="可见节点" value={`${model.selectedNodeCount}/${model.totalNodeCount}`} />
        <GraphMetric label="可见关系" value={`${model.selectedEdgeCount}/${model.totalEdgeCount}`} />
        <GraphMetric label="页码范围" value={model.pageRangeLabel} />
        <GraphMetric label="分组" value={`${model.buckets.length}`} />
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground md:grid-cols-4">
        <LegendItem color="bg-sky-500" label="阅读痕迹" />
        <LegendItem color="bg-slate-500" label="章节/论点" />
        <LegendItem color="bg-emerald-500" label="实体/概念" />
        <LegendItem color="bg-amber-500" label="事件" />
      </div>

      <div className="space-y-1.5">
        {rankedEdges.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            暂无关系边
          </div>
        ) : (
          rankedEdges.map((edge) => (
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
            <span className="font-medium">{source?.title ?? compactCardId(edge.sourceCardId)}</span>
            <span className="px-1 text-muted-foreground">→</span>
            <span className="font-medium">{target?.title ?? compactCardId(edge.targetCardId)}</span>
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
            {chunkIdEvidenceLabel(chunkId)}
          </button>
        ))}
      </div>
    </article>
  )
}

function GraphSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-[360px] animate-pulse rounded-md border bg-muted" />
      <div className="h-16 animate-pulse rounded-md border bg-muted" />
    </div>
  )
}

function GraphMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-semibold">{value}</div>
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

function buildGraphModel(nodes: KnowledgeGraphNode[], edges: KnowledgeEdge[]): GraphModel {
  const nodeById = new Map(nodes.map((node) => [node.cardId, node]))
  const relationCount = buildRelationCount(edges, nodeById)
  const selectedNodes = [...nodes]
    .sort(
      (left, right) =>
        (relationCount.get(right.cardId) ?? 0) - (relationCount.get(left.cardId) ?? 0) ||
        cardTypeRank(left.cardType) - cardTypeRank(right.cardType) ||
        right.confidence - left.confidence ||
        right.evidenceCount - left.evidenceCount ||
        left.title.localeCompare(right.title),
    )
    .slice(0, MAX_GRAPH_NODES)
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.cardId))
  const selectedPages = selectedNodes
    .map(pageIndexForNode)
    .filter((pageIndex): pageIndex is number => pageIndex !== null)
  const minPage = selectedPages.length > 0 ? Math.min(...selectedPages) : null
  const maxPage = selectedPages.length > 0 ? Math.max(...selectedPages) : null
  const pageScale = minPage === null || maxPage === null ? null : { min: minPage, max: maxPage }
  const uniquePages = [...new Set(selectedPages)].sort((left, right) => left - right)
  const pageTicks = buildPageTicks(minPage, maxPage)
  const bucketMap = new Map<string, GraphBucket>()

  for (const node of selectedNodes) {
    const lane = laneForNode(node)
    const page = pageBucketForNode(node, minPage, maxPage, uniquePages.length)
    const key = `${lane.key}:${page.key}`
    const existing = bucketMap.get(key)
    if (existing) {
      existing.nodes.push(node)
      existing.relationCount += relationCount.get(node.cardId) ?? 0
      existing.dominantCardType = dominantCardType(existing.nodes, relationCount)
      continue
    }
    bucketMap.set(key, {
      key,
      lane,
      page,
      x: xForPageBucket(page, pageScale),
      y: lane.y,
      r: 8,
      nodes: [node],
      relationCount: relationCount.get(node.cardId) ?? 0,
      dominantCardType: node.cardType,
    })
  }

  const buckets = [...bucketMap.values()]
    .map((bucket) => ({
      ...bucket,
      nodes: bucket.nodes.sort(
        (left, right) =>
          (relationCount.get(right.cardId) ?? 0) - (relationCount.get(left.cardId) ?? 0) ||
          cardTypeRank(left.cardType) - cardTypeRank(right.cardType) ||
          right.confidence - left.confidence ||
          left.title.localeCompare(right.title),
      ),
      r: clamp(7 + Math.sqrt(bucket.nodes.length) * 4.2, 10, 27),
      dominantCardType: dominantCardType(bucket.nodes, relationCount),
    }))
    .sort(
      (left, right) =>
        laneRank(left.lane.key) - laneRank(right.lane.key) ||
        (left.page.centerPage ?? Number.MAX_SAFE_INTEGER) -
          (right.page.centerPage ?? Number.MAX_SAFE_INTEGER),
    )
  const bucketByNodeId = new Map<string, GraphBucket>()
  for (const bucket of buckets) {
    for (const node of bucket.nodes) {
      bucketByNodeId.set(node.cardId, bucket)
    }
  }

  const selectedEdges = rankGraphEdges(edges, nodeById).filter(
    (edge) => selectedNodeIds.has(edge.sourceCardId) && selectedNodeIds.has(edge.targetCardId),
  )
  const bucketEdges = buildBucketEdges(selectedEdges, bucketByNodeId)

  return {
    buckets,
    bucketEdges,
    pageTicks,
    pageScale,
    selectedNodeCount: selectedNodes.length,
    totalNodeCount: nodes.length,
    selectedEdgeCount: selectedEdges.length,
    totalEdgeCount: edges.length,
    pageRangeLabel: pageRangeLabel(minPage, maxPage),
  }
}

function buildRelationCount(
  edges: KnowledgeEdge[],
  nodeById: Map<string, KnowledgeGraphNode>,
) {
  const relationCount = new Map<string, number>()
  for (const edge of edges) {
    if (!nodeById.has(edge.sourceCardId) || !nodeById.has(edge.targetCardId)) {
      continue
    }
    const weight = edge.edgeType === "same_evidence" ? 0.45 : 1
    relationCount.set(edge.sourceCardId, (relationCount.get(edge.sourceCardId) ?? 0) + weight)
    relationCount.set(edge.targetCardId, (relationCount.get(edge.targetCardId) ?? 0) + weight)
  }
  return relationCount
}

function rankGraphEdges(
  edges: KnowledgeEdge[],
  nodeById: Map<string, KnowledgeGraphNode>,
) {
  return [...edges]
    .filter(
      (edge) =>
        edge.sourceCardId !== edge.targetCardId &&
        nodeById.has(edge.sourceCardId) &&
        nodeById.has(edge.targetCardId) &&
        edge.evidenceChunkIds.length > 0,
    )
    .sort((left, right) => {
      const leftPageDistance = edgePageDistance(left, nodeById)
      const rightPageDistance = edgePageDistance(right, nodeById)
      return (
        edgeTypeRank(left.edgeType) - edgeTypeRank(right.edgeType) ||
        right.confidence - left.confidence ||
        right.evidenceChunkIds.length - left.evidenceChunkIds.length ||
        leftPageDistance - rightPageDistance ||
        left.edgeId.localeCompare(right.edgeId)
      )
    })
}

function buildBucketEdges(
  edges: KnowledgeEdge[],
  bucketByNodeId: Map<string, GraphBucket>,
) {
  const bucketEdgeMap = new Map<string, GraphBucketEdge>()
  for (const edge of edges) {
    const source = bucketByNodeId.get(edge.sourceCardId)
    const target = bucketByNodeId.get(edge.targetCardId)
    if (!source || !target || source.key === target.key) {
      continue
    }
    const key = `${source.key}->${target.key}:${edge.edgeType}`
    const existing = bucketEdgeMap.get(key)
    if (existing) {
      existing.count += 1
      existing.confidence = Math.max(existing.confidence, edge.confidence)
      for (const chunkId of edge.evidenceChunkIds) {
        if (!existing.evidenceChunkIds.includes(chunkId) && existing.evidenceChunkIds.length < 6) {
          existing.evidenceChunkIds.push(chunkId)
        }
      }
      continue
    }
    bucketEdgeMap.set(key, {
      key,
      source,
      target,
      edgeType: edge.edgeType,
      count: 1,
      confidence: edge.confidence,
      evidenceChunkIds: edge.evidenceChunkIds.slice(0, 6),
    })
  }
  return [...bucketEdgeMap.values()]
    .sort(
      (left, right) =>
        edgeTypeRank(left.edgeType) - edgeTypeRank(right.edgeType) ||
        right.count - left.count ||
        right.confidence - left.confidence ||
        left.key.localeCompare(right.key),
    )
    .slice(0, MAX_BUCKET_EDGES)
}

function buildPageTicks(minPage: number | null, maxPage: number | null): PageBucket[] {
  if (minPage === null || maxPage === null) {
    return [unknownPageBucket()]
  }
  if (minPage === maxPage) {
    return [pageBucket(minPage, minPage)]
  }
  const tickCount = Math.min(5, maxPage - minPage + 1)
  const ticks: PageBucket[] = []
  for (let index = 0; index < tickCount; index += 1) {
    const page = Math.round(minPage + ((maxPage - minPage) * index) / (tickCount - 1))
    const bucket = pageBucket(page, page)
    if (!ticks.some((tick) => tick.key === bucket.key)) {
      ticks.push(bucket)
    }
  }
  return ticks
}

function pageBucketForNode(
  node: KnowledgeGraphNode,
  minPage: number | null,
  maxPage: number | null,
  uniquePageCount: number,
): PageBucket {
  const pageIndex = pageIndexForNode(node)
  if (pageIndex === null || minPage === null || maxPage === null) {
    return unknownPageBucket()
  }
  const span = maxPage - minPage + 1
  if (uniquePageCount <= MAX_PAGE_BUCKETS || span <= MAX_PAGE_BUCKETS) {
    return pageBucket(pageIndex, pageIndex)
  }
  const bucketIndex = clamp(
    Math.floor(((pageIndex - minPage) / span) * MAX_PAGE_BUCKETS),
    0,
    MAX_PAGE_BUCKETS - 1,
  )
  const start = minPage + Math.floor((span * bucketIndex) / MAX_PAGE_BUCKETS)
  const end = minPage + Math.floor((span * (bucketIndex + 1)) / MAX_PAGE_BUCKETS) - 1
  return pageBucket(start, Math.max(start, end))
}

function pageBucket(startPage: number, endPage: number): PageBucket {
  const centerPage = (startPage + endPage) / 2
  const key = startPage === endPage ? `page-${startPage}` : `pages-${startPage}-${endPage}`
  const label =
    startPage === endPage
      ? `第 ${startPage + 1} 页`
      : `第 ${startPage + 1}-${endPage + 1} 页`
  return {
    key,
    label,
    shortLabel: startPage === endPage ? `P${startPage + 1}` : `P${startPage + 1}-${endPage + 1}`,
    centerPage,
  }
}

function unknownPageBucket(): PageBucket {
  return {
    key: "unknown-page",
    label: "未知页",
    shortLabel: "未知",
    centerPage: null,
  }
}

function xForPageBucket(page: PageBucket, pageScale: PageScale) {
  if (page.centerPage === null) {
    return PLOT_RIGHT
  }
  const pageNumber = page.centerPage
  if (!pageScale || pageScale.min === pageScale.max) {
    return (PLOT_LEFT + PLOT_RIGHT) / 2
  }
  return PLOT_LEFT + ((pageNumber - pageScale.min) / (pageScale.max - pageScale.min)) * (PLOT_RIGHT - PLOT_LEFT)
}

function pathForBucketEdge(edge: GraphBucketEdge) {
  const source = edge.source
  const target = edge.target
  const dx = Math.abs(target.x - source.x)
  const curve = clamp(dx * 0.38, 34, 180)
  const sourceControlX = source.x + (target.x >= source.x ? curve : -curve)
  const targetControlX = target.x - (target.x >= source.x ? curve : -curve)
  return `M ${source.x} ${source.y} C ${sourceControlX} ${source.y}, ${targetControlX} ${target.y}, ${target.x} ${target.y}`
}

function laneForNode(node: KnowledgeGraphNode) {
  if (node.cardType === "event") {
    return GRAPH_LANES[3]
  }
  if (node.cardType === "entity" || node.cardType === "concept") {
    return GRAPH_LANES[2]
  }
  if (node.cardType === "summary" || node.cardType === "claim") {
    return GRAPH_LANES[1]
  }
  return GRAPH_LANES[0]
}

function laneRank(laneKey: string) {
  return GRAPH_LANES.findIndex((lane) => lane.key === laneKey)
}

function cardTypeRank(cardType: string) {
  switch (cardType) {
    case "highlight":
    case "interpretation":
    case "note":
    case "question":
      return 0
    case "summary":
      return 1
    case "claim":
      return 2
    case "event":
      return 3
    case "entity":
      return 4
    case "concept":
      return 5
    default:
      return 6
  }
}

function edgeTypeRank(edgeType: string) {
  switch (edgeType) {
    case "causes":
    case "supports":
    case "contrasts":
      return 0
    case "mentions":
    case "alias_of":
      return 1
    case "part_of":
    case "sequel":
      return 2
    case "nearby":
      return 3
    case "same_evidence":
      return 4
    default:
      return 5
  }
}

function edgePageDistance(edge: KnowledgeEdge, nodeById: Map<string, KnowledgeGraphNode>) {
  const sourcePage = pageIndexForNode(nodeById.get(edge.sourceCardId))
  const targetPage = pageIndexForNode(nodeById.get(edge.targetCardId))
  if (sourcePage === null || targetPage === null) {
    return Number.MAX_SAFE_INTEGER
  }
  return Math.abs(sourcePage - targetPage)
}

function pageIndexForNode(node?: KnowledgeGraphNode): number | null {
  if (!node) {
    return null
  }
  if (node.pageIndex !== null && node.pageIndex !== undefined) {
    return node.pageIndex
  }
  const evidencePages = node.evidence
    .map((item) => item.pageIndex)
    .filter((pageIndex): pageIndex is number => pageIndex !== null && pageIndex !== undefined)
  return evidencePages.length > 0 ? Math.min(...evidencePages) : null
}

function dominantCardType(
  nodes: KnowledgeGraphNode[],
  relationCount: Map<string, number>,
) {
  return [...nodes].sort(
    (left, right) =>
      (relationCount.get(right.cardId) ?? 0) - (relationCount.get(left.cardId) ?? 0) ||
      cardTypeRank(left.cardType) - cardTypeRank(right.cardType) ||
      right.confidence - left.confidence,
  )[0]?.cardType ?? "concept"
}

function firstBucketEvidenceChunkId(bucket: GraphBucket) {
  for (const node of bucket.nodes) {
    const chunkId = node.evidence[0]?.chunkId
    if (chunkId) {
      return chunkId
    }
  }
  return ""
}

function bucketTitle(bucket: GraphBucket) {
  const titles = bucket.nodes
    .slice(0, 5)
    .map((node) => `${labelForCardType(node.cardType)}：${node.title}`)
    .join("\n")
  return `${bucket.page.label} · ${bucket.lane.label} · ${bucket.nodes.length} 节点\n${titles}`
}

function pageRangeLabel(minPage: number | null, maxPage: number | null) {
  if (minPage === null || maxPage === null) {
    return "未知"
  }
  if (minPage === maxPage) {
    return `第 ${minPage + 1} 页`
  }
  return `第 ${minPage + 1}-${maxPage + 1} 页`
}

function shortNodeLabel(node?: KnowledgeGraphNode) {
  const title = node?.title.trim() ?? ""
  if (!title) {
    return "?"
  }
  return [...title].slice(0, 2).join("")
}

function compactCardId(cardId: string) {
  if (cardId.length <= 18) {
    return cardId
  }
  return `${cardId.slice(0, 10)}…${cardId.slice(-6)}`
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
    case "interpretation":
    case "question":
      return "#2563eb"
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
