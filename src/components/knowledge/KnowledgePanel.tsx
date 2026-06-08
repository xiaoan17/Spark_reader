import {
  Check,
  Download,
  FileJson,
  FileText,
  Loader2,
  Network,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { KnowledgeBacklinks } from "./KnowledgeBacklinks"
import { KnowledgeChapterMap } from "./KnowledgeChapterMap"
import { KnowledgeEmptyBuildAction } from "./KnowledgeEmptyBuildAction"
import { KnowledgeGraphView } from "./KnowledgeGraphView"
import { KnowledgeTimeline } from "./KnowledgeTimeline"
import type {
  KnowledgeCard,
  KnowledgeDrift,
  KnowledgeGraph,
  KnowledgeHealth,
  KnowledgeMap,
} from "@/stores/reader-store"
import type { UpsertKnowledgeCardRequest } from "@/core/library-api"
import {
  KNOWLEDGE_CARD_TYPES,
  formatConfidencePercent,
  labelForCardType,
  labelForSource,
  labelForStatus,
} from "@/core/knowledge-display"
import { knowledgeEvidenceLabel } from "@/core/citation-display"

type KnowledgePanelProps = {
  cards: KnowledgeCard[]
  graph?: KnowledgeGraph | null
  health?: KnowledgeHealth | null
  drift?: KnowledgeDrift[]
  map?: KnowledgeMap | null
  loading?: boolean
  graphLoading?: boolean
  building?: boolean
  error?: string
  onRefresh?: () => void
  onBuildKnowledge?: () => void
  onExport?: () => void
  onExportJson?: () => void
  onConfirmCard?: (cardId: string) => void
  onRejectCard?: (cardId: string) => void
  onDeleteCard?: (cardId: string) => void
  onSaveCard?: (request: Omit<UpsertKnowledgeCardRequest, "bookId">) => void
  onEvidenceClick?: (chunkId: string) => void
  fullHeight?: boolean
}

type KnowledgeView = "cards" | "graph" | "backlinks" | "map" | "timeline"

export function KnowledgePanel({
  cards,
  graph = null,
  health = null,
  drift = [],
  map = null,
  loading = false,
  graphLoading = false,
  building = false,
  error = "",
  onRefresh = () => undefined,
  onBuildKnowledge = () => undefined,
  onExport = () => undefined,
  onExportJson = () => undefined,
  onConfirmCard = () => undefined,
  onRejectCard = () => undefined,
  onDeleteCard = () => undefined,
  onSaveCard = () => undefined,
  onEvidenceClick = () => undefined,
  fullHeight = false,
}: KnowledgePanelProps) {
  const [view, setView] = useState<KnowledgeView>("cards")
  const [selectedCardId, setSelectedCardId] = useState<string>("")
  const [editing, setEditing] = useState(false)
  const eventCount = useMemo(
    () => (graph?.nodes ?? []).filter((node) => node.cardType === "event").length,
    [graph],
  )
  const backlinkCount = graph?.edges.length ?? 0
  const mapPageCount = useMemo(
    () =>
      new Set(
        (graph?.nodes ?? [])
          .map((node) => node.pageIndex)
          .filter((pageIndex): pageIndex is number => pageIndex !== null && pageIndex !== undefined),
      ).size,
    [graph],
  )
  const busy = loading || graphLoading || building
  const selectedCard = cards.find((card) => card.cardId === selectedCardId) ?? cards[0] ?? null
  const selectedCardDrift = selectedCard
    ? drift.filter((item) => item.cardId === selectedCard.cardId)
    : []

  useEffect(() => {
    if (!cards.length) {
      setSelectedCardId("")
      setEditing(false)
      return
    }
    if (!selectedCardId || !cards.some((card) => card.cardId === selectedCardId)) {
      setSelectedCardId(cards[0].cardId)
      setEditing(false)
    }
  }, [cards, selectedCardId])

  return (
    <section className={["flex min-h-0 flex-col rounded-md border bg-background", fullHeight ? "h-full" : ""].join(" ")}>
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">知识体系</h2>
            <Badge variant="secondary">{cards.length}</Badge>
          </div>
          {graph?.builtAt ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              知识体系 {graph.nodes.length} 节点 / {graph.edges.length} 关系
            </p>
          ) : health ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              已确认 {health.confirmedCount} / 候选 {health.candidateCount} / 漂移 {health.driftCount}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="构建知识体系"
            title="构建知识体系"
            onClick={onBuildKnowledge}
            disabled={busy}
          >
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="刷新知识"
            title="刷新知识"
            onClick={onRefresh}
            disabled={busy}
          >
            {loading || graphLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="导出 Markdown 知识册"
            title="导出 Markdown 知识册"
            onClick={onExport}
            disabled={busy || cards.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="导出 JSON 备份"
            title="导出 JSON 备份"
            onClick={onExportJson}
            disabled={busy || cards.length === 0}
          >
            <FileJson className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <KnowledgeHealthStrip health={health} drift={drift} map={map} />

      <div className="grid grid-cols-5 gap-1 border-b p-2">
        <SegmentButton active={view === "cards"} onClick={() => setView("cards")}>
          卡片 {cards.length}
        </SegmentButton>
        <SegmentButton active={view === "graph"} onClick={() => setView("graph")}>
          图谱 {graph?.edges.length ?? 0}
        </SegmentButton>
        <SegmentButton active={view === "backlinks"} onClick={() => setView("backlinks")}>
          反链 {backlinkCount}
        </SegmentButton>
        <SegmentButton active={view === "map"} onClick={() => setView("map")}>
          地图 {mapPageCount}
        </SegmentButton>
        <SegmentButton active={view === "timeline"} onClick={() => setView("timeline")}>
          时间线 {eventCount}
        </SegmentButton>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-5 text-danger-foreground">
            {error}
          </div>
        ) : null}
        {view === "cards" ? (
          <>
            {loading && cards.length === 0 ? <KnowledgeSkeleton /> : null}
            {!loading && cards.length === 0 ? (
              <KnowledgeEmptyBuildAction
                title="暂无知识卡片。可以先从整本书生成章节、论点、事件和概念候选。"
                building={building}
                onBuildKnowledge={onBuildKnowledge}
              />
            ) : null}
            {cards.length > 0 ? (
              <div className="grid gap-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-2">
                  {cards.map((card) => (
                    <KnowledgeCardItem
                      key={card.cardId}
                      card={card}
                      active={card.cardId === selectedCard?.cardId}
                      onSelect={() => {
                        setSelectedCardId(card.cardId)
                        setEditing(false)
                      }}
                      onEvidenceClick={onEvidenceClick}
                    />
                  ))}
                </div>
                <KnowledgeCardDetail
                  card={selectedCard}
                  drift={selectedCardDrift}
                  editing={editing}
                  onEdit={() => setEditing(true)}
                  onCancelEdit={() => setEditing(false)}
                  onSave={(request) => {
                    onSaveCard(request)
                    setEditing(false)
                  }}
                  onConfirm={onConfirmCard}
                  onReject={onRejectCard}
                  onDelete={onDeleteCard}
                  onEvidenceClick={onEvidenceClick}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {view === "graph" ? (
          <KnowledgeGraphView
            graph={graph}
            loading={graphLoading || building}
            building={building}
            onBuildKnowledge={onBuildKnowledge}
            onEvidenceClick={onEvidenceClick}
          />
        ) : null}
        {view === "backlinks" ? (
          <KnowledgeBacklinks
            graph={graph}
            loading={graphLoading || building}
            building={building}
            onBuildKnowledge={onBuildKnowledge}
            onEvidenceClick={onEvidenceClick}
          />
        ) : null}
        {view === "map" ? (
          <KnowledgeChapterMap
            graph={graph}
            loading={graphLoading || building}
            building={building}
            onBuildKnowledge={onBuildKnowledge}
            onEvidenceClick={onEvidenceClick}
          />
        ) : null}
        {view === "timeline" ? (
          <KnowledgeTimeline
            graph={graph}
            loading={graphLoading || building}
            building={building}
            onBuildKnowledge={onBuildKnowledge}
            onEvidenceClick={onEvidenceClick}
          />
        ) : null}
      </div>
    </section>
  )
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        "h-7 rounded-md px-2 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function KnowledgeHealthStrip({
  health,
  drift,
  map,
}: {
  health: KnowledgeHealth | null
  drift: KnowledgeDrift[]
  map: KnowledgeMap | null
}) {
  if (!health) {
    return null
  }
  return (
    <div className="grid grid-cols-4 gap-1.5 border-b p-2 text-[11px]">
      <HealthCell label="卡片" value={health.cardCount} />
      <HealthCell label="候选" value={health.candidateCount} />
      <HealthCell label="漂移" value={drift.length || health.driftCount} warning={(drift.length || health.driftCount) > 0} />
      <HealthCell label="站点" value={map?.stations.length ?? 0} />
    </div>
  )
}

function HealthCell({
  label,
  value,
  warning = false,
}: {
  label: string
  value: number
  warning?: boolean
}) {
  return (
    <div className={["rounded-md border px-2 py-1", warning ? "border-warning/40 bg-warning/10 text-warning-foreground" : "bg-card"].join(" ")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

function KnowledgeCardItem({
  card,
  active,
  onSelect,
  onEvidenceClick,
}: {
  card: KnowledgeCard
  active: boolean
  onSelect: () => void
  onEvidenceClick: (chunkId: string) => void
}) {
  return (
    <article
      className={[
        "rounded-md border bg-card px-3 py-2 transition-colors",
        active ? "border-primary ring-1 ring-primary/20" : "hover:border-muted-foreground/40",
      ].join(" ")}
    >
      <button type="button" className="block w-full text-left" onClick={onSelect}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{labelForCardType(card.cardType)}</Badge>
            <Badge variant={card.status === "confirmed" ? "secondary" : "outline"}>
              {labelForStatus(card.status)}
            </Badge>
            {(card.driftCount ?? 0) > 0 ? (
              <Badge variant="outline" className="border-warning/40 text-warning-foreground">
                <ShieldAlert className="mr-1 h-3 w-3" />
                漂移
              </Badge>
            ) : null}
            {card.userLocked ? (
              <Badge variant="secondary">
                <ShieldCheck className="mr-1 h-3 w-3" />
                已锁定
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-5">{card.title}</h3>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatConfidencePercent(card.confidence)}
        </span>
      </div>

      {card.summary ? (
        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{card.summary}</p>
      ) : null}
      </button>

      {card.evidence.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.evidence.map((item) => (
            <button
              key={`${card.cardId}-${item.chunkId}-${item.role}`}
              type="button"
              className="max-w-full truncate rounded-md border px-2 py-1 text-[11px] leading-none text-muted-foreground hover:border-primary hover:text-primary"
              onClick={() => onEvidenceClick(item.chunkId)}
              title={item.quote ? `${item.quote}（${item.chunkId}）` : item.chunkId}
            >
              {knowledgeEvidenceLabel(item)}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">暂无绑定证据</p>
      )}
    </article>
  )
}

function KnowledgeCardDetail({
  card,
  drift,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onConfirm,
  onReject,
  onDelete,
  onEvidenceClick,
}: {
  card: KnowledgeCard | null
  drift: KnowledgeDrift[]
  editing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (request: Omit<UpsertKnowledgeCardRequest, "bookId">) => void
  onConfirm: (cardId: string) => void
  onReject: (cardId: string) => void
  onDelete: (cardId: string) => void
  onEvidenceClick: (chunkId: string) => void
}) {
  if (!card) {
    return (
      <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
        选择一张卡片查看详情
      </div>
    )
  }
  if (editing) {
    return <KnowledgeCardEditForm card={card} onCancel={onCancelEdit} onSave={onSave} />
  }
  return (
    <article className="sticky top-0 rounded-md border bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{labelForCardType(card.cardType)}</Badge>
            <Badge variant={card.status === "confirmed" ? "secondary" : "outline"}>
              {labelForStatus(card.status)}
            </Badge>
            <Badge variant="outline">{labelForSource(card.source)}</Badge>
            {card.userLocked ? <Badge variant="secondary">用户锁定</Badge> : null}
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-5">{card.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="编辑卡片" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          {card.status !== "confirmed" ? (
            <Button type="button" size="icon" variant="ghost" aria-label="确认卡片" onClick={() => onConfirm(card.cardId)}>
              <Check className="h-4 w-4" />
            </Button>
          ) : null}
          {card.status !== "rejected" ? (
            <Button type="button" size="icon" variant="ghost" aria-label="拒绝卡片" onClick={() => onReject(card.cardId)}>
              <X className="h-4 w-4" />
            </Button>
          ) : null}
          <Button type="button" size="icon" variant="ghost" aria-label="删除卡片" onClick={() => onDelete(card.cardId)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {drift.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning-foreground">
          原文已重解析，{drift.length} 条引用需要复核。
        </div>
      ) : null}

      {card.summary ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{card.summary}</p>
      ) : null}
      {card.bodyMarkdown ? (
        <div className="mt-3 whitespace-pre-wrap rounded-md border bg-background px-3 py-2 text-xs leading-6">
          {card.bodyMarkdown}
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">原文证据</div>
        {card.evidence.length > 0 ? (
          card.evidence.map((item) => (
            <button
              key={`${card.cardId}-detail-${item.chunkId}-${item.role}`}
              type="button"
              className="block w-full rounded-md border bg-background px-2 py-1.5 text-left text-[11px] leading-5 hover:border-primary"
              onClick={() => onEvidenceClick(item.chunkId)}
              title={item.chunkId}
            >
              <span className="font-medium">
                {item.pageIndex === null || item.pageIndex === undefined ? "未知页" : `第 ${item.pageIndex + 1} 页`}
              </span>
              <span className="ml-2 text-muted-foreground">原文证据</span>
              {item.quote ? <span className="mt-1 block text-muted-foreground">{item.quote}</span> : null}
            </button>
          ))
        ) : (
          <div className="rounded-md border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
            暂无证据
          </div>
        )}
      </div>
    </article>
  )
}

function KnowledgeCardEditForm({
  card,
  onCancel,
  onSave,
}: {
  card: KnowledgeCard
  onCancel: () => void
  onSave: (request: Omit<UpsertKnowledgeCardRequest, "bookId">) => void
}) {
  const [title, setTitle] = useState(card.title)
  const [summary, setSummary] = useState(card.summary)
  const [bodyMarkdown, setBodyMarkdown] = useState(card.bodyMarkdown)
  const [cardType, setCardType] = useState(card.cardType)
  const [status, setStatus] = useState(card.status)
  const evidenceChunkIds = card.evidence.map((item) => item.chunkId)

  useEffect(() => {
    setTitle(card.title)
    setSummary(card.summary)
    setBodyMarkdown(card.bodyMarkdown)
    setCardType(card.cardType)
    setStatus(card.status)
  }, [card])

  return (
    <form
      className="sticky top-0 space-y-2 rounded-md border bg-card px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({
          cardId: card.cardId,
          cardType,
          title,
          summary,
          bodyMarkdown,
          payloadJson: card.payloadJson || "{}",
          status,
          evidenceChunkIds,
        })
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">类型</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            value={cardType}
            onChange={(event) => setCardType(event.target.value)}
          >
            {KNOWLEDGE_CARD_TYPES.map((value) => (
              <option key={value} value={value}>
                {labelForCardType(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">状态</span>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="candidate">候选</option>
            <option value="confirmed">已确认</option>
            <option value="rejected">已拒绝</option>
          </select>
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">标题</span>
        <input
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">摘要</span>
        <textarea
          className="min-h-16 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs leading-5"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">正文</span>
        <textarea
          className="min-h-32 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs leading-5"
          value={bodyMarkdown}
          onChange={(event) => setBodyMarkdown(event.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2 border-t pt-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim()}>
          保存
        </Button>
      </div>
    </form>
  )
}

function KnowledgeSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-md border bg-card px-3 py-2">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-4 w-4/5 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
