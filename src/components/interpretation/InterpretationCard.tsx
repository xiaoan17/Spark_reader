import {
  AlertCircle,
  ChevronDown,
  Copy,
  FileSearch,
  KeyRound,
  Loader2,
  NotebookPen,
  RefreshCcw,
  Sparkles,
  Square,
} from "lucide-react"
import { useEffect, useState, type CSSProperties } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import { renderMarkdownTextWithCitations } from "@/components/markdown/markdown-citations"
import { shouldSubmitTextarea } from "@/components/reader/textarea-submit"
import type {
  AgentTraceStep,
  AnswerSource,
  EvidencePreview,
  FollowUpTurn,
  ReaderPhase,
} from "@/stores/reader-store"
import { cn } from "@/lib/utils"
import type { NormalizedPageRect } from "@/core/coordinates"
import {
  citationLabelMap,
  chunkIdsInCitation,
  evidenceLabel,
  internalCitationPattern,
  retrievalEvidenceLabel,
  sanitizeInternalReferenceText,
} from "@/core/citation-display"

type InterpretationCardProps = {
  phase: ReaderPhase
  selectionText: string
  selectionRects?: NormalizedPageRect[]
  evidence: EvidencePreview[]
  citationChunkIds?: string[]
  agentTrace?: AgentTraceStep[]
  interpretation: string
  answerSource?: AnswerSource
  errorMessage?: string
  followUps: FollowUpTurn[]
  lightweight?: boolean
  question?: string
  noteDraft?: string
  noteSaving?: boolean
  noteError?: string
  onQuestionChange?: (question: string) => void
  onQuestionSubmit?: () => void
  onNoteChange?: (note: string) => void
  onCopy?: () => void
  onSave?: () => void
  onCitationClick?: (chunkId: string) => void
  onRegenerate?: () => void
  onStop?: () => void
  onOpenSettings?: () => void
  runtimeHint?: string
  className?: string
}

export function InterpretationCard({
  phase,
  selectionText,
  selectionRects = [],
  evidence,
  citationChunkIds,
  agentTrace = [],
  interpretation,
  answerSource = "llm",
  errorMessage = "",
  followUps,
  lightweight = false,
  question = "",
  noteDraft = "",
  noteSaving = false,
  noteError = "",
  onQuestionChange,
  onQuestionSubmit,
  onNoteChange,
  onCopy,
  onSave,
  onCitationClick,
  onRegenerate,
  onStop,
  onOpenSettings,
  runtimeHint,
  className,
}: InterpretationCardProps) {
  const [stopping, setStopping] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const streaming = phase === "streaming"
  const busy = phase === "planning" || phase === "retrieving" || streaming
  const hasSelection = selectionText.trim().length > 0
  const showActions = hasSelection && !busy
  useEffect(() => {
    if (!streaming) {
      setStopping(false)
    }
  }, [streaming])

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      <div className="border-b pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                Spark
              </span>
              <Badge variant="secondary">{lightweight ? "轻量" : "深度"}</Badge>
            </div>
            <blockquote className="mt-3 border-l-2 border-primary/50 pl-3 font-reading text-sm leading-7 text-muted-foreground">
              {selectionText || "尚未选择文本"}
            </blockquote>
          </div>
          {streaming ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={stopping ? "停止中" : "停止生成"}
              disabled={stopping}
              onClick={() => {
                setStopping(true)
                onStop?.()
              }}
            >
              {stopping ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-4 py-4">
        <PhaseBody
          phase={phase}
          selectionText={selectionText}
          evidence={evidence}
          citationChunkIds={citationChunkIds}
          agentTrace={agentTrace}
          selectionRects={selectionRects}
          interpretation={interpretation}
          answerSource={answerSource}
          errorMessage={errorMessage}
          followUps={followUps}
          onCitationClick={onCitationClick}
          onOpenSettings={onOpenSettings}
        />
        {runtimeHint && !selectionText ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {sanitizeInternalReferenceText(runtimeHint)}
          </p>
        ) : null}
      </div>
      {showActions ? (
        <div className="mt-auto space-y-3 border-t pt-3">
          <div className="flex gap-2 rounded-md border bg-background p-2">
            <textarea
              className="min-h-16 flex-1 resize-none bg-transparent text-sm outline-none"
              placeholder="围绕这段继续追问；会检索证据后回答"
              value={question}
              onChange={(event) => onQuestionChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (shouldSubmitTextarea(event)) {
                  event.preventDefault()
                  onQuestionSubmit?.()
                }
              }}
            />
            <Button
              size="sm"
              className="self-end"
              disabled={question.trim().length === 0}
              onClick={onQuestionSubmit}
            >
              发送
            </Button>
          </div>
          {noteOpen ? (
            <div className="space-y-2 rounded-md border bg-background p-2">
              <textarea
                className="min-h-16 w-full resize-none bg-transparent text-sm leading-6 outline-none"
                placeholder="写下这段文字触发的想法"
                value={noteDraft}
                onChange={(event) => onNoteChange?.(event.target.value)}
              />
              {noteError ? <InlineError message={noteError} /> : null}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!noteDraft.trim() || noteSaving}
                  onClick={onSave}
                >
                  {noteSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  保存笔记
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant={noteOpen ? "secondary" : "ghost"}
              aria-pressed={noteOpen}
              onClick={() => setNoteOpen((open) => !open)}
            >
              <NotebookPen className="mr-1.5 h-4 w-4" />
              保存
            </Button>
            <Button size="icon" variant="ghost" aria-label="复制解读" onClick={onCopy}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="重新生成解读" onClick={onRegenerate}>
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function PhaseBody({
  phase,
  selectionText,
  evidence,
  citationChunkIds,
  agentTrace = [],
  selectionRects = [],
  interpretation,
  answerSource = "llm",
  followUps,
  errorMessage,
  onCitationClick,
  onOpenSettings,
}: Pick<
  InterpretationCardProps,
  | "phase"
  | "selectionText"
  | "evidence"
  | "citationChunkIds"
  | "agentTrace"
  | "selectionRects"
  | "interpretation"
  | "answerSource"
  | "errorMessage"
  | "followUps"
  | "onCitationClick"
  | "onOpenSettings"
>) {
  if (phase === "planning") {
    return (
      <div className="animate-fade-in space-y-3">
        <SkeletonLine className="w-2/3" />
        <SkeletonLine />
        <SkeletonLine className="w-5/6" />
      </div>
    )
  }

  if (phase === "retrieving") {
    const visibleEvidence =
      evidence.length > 0
        ? evidence
        : [{ chunkId: "local-selection", title: "当前选区", pageIndex: 0 }]
    const retrievalSteps = retrievalTraceItems(agentTrace, visibleEvidence)
    return (
      <div className="animate-fade-in space-y-3">
        <p className="text-sm text-muted-foreground">AI 正在书中查找</p>
        <div className="space-y-2">
          {retrievalSteps.map((step, index) => (
            <div
              key={`${step.label}-${index}`}
              className="animate-slide-in-up rounded-md border bg-background px-3 py-2"
              style={staggerStyle(index)}
            >
              <div className="flex items-start gap-2 text-sm font-medium">
                <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{step.label}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {step.evidence.map((item, evidenceIndex) => (
                  <Badge key={`${step.label}-${item.chunkId}`} variant="secondary">
                    {retrievalEvidenceLabel(item, evidenceIndex)}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if ((phase === "streaming" || phase === "reading") && interpretation) {
    const trust = interpretationTrustState(interpretation, evidence, citationChunkIds, answerSource)
    return (
      <div className="animate-fade-in space-y-4 text-sm leading-7">
        {answerSource === "local_fallback" ? (
          <LocalFallbackNotice message={errorMessage} onOpenSettings={onOpenSettings} />
        ) : null}
        <InterpretationTrustBadge trust={trust} />
        {phase === "streaming" ? (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            正在生成
          </p>
        ) : null}
        <MarkdownContent
          content={interpretation}
          evidence={evidence}
          citationChunkIds={citationChunkIds}
          onCitationClick={onCitationClick}
          className="text-sm"
        />
        {evidence.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {evidence.map((item, index) => (
              <CitationPreviewButton
                key={item.chunkId}
                item={item}
                label={evidenceLabel(item, evidence, index)}
                style={staggerStyle(index)}
                onClick={() => onCitationClick?.(item.chunkId)}
              />
            ))}
          </div>
        ) : null}
        {followUps.length > 0 ? (
          <div className="space-y-3 border-t pt-3">
            {followUps.map((turn, index) => (
              <div key={turn.id} className="animate-slide-in-up space-y-2" style={staggerStyle(index)}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">追问 #{index + 1}</Badge>
                </div>
                <div className="rounded-md bg-accent px-3 py-2 text-accent-foreground">
                  {turn.question}
                </div>
                <div className="rounded-md bg-muted/60 px-3 py-2">
                  <MarkdownContent
                    content={turn.answer}
                    evidence={evidence}
                    citationChunkIds={citationChunkIds}
                    onCitationClick={onCitationClick}
                    className="text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {selectionRects.length > 0 ? <CoordinateList selectionRects={selectionRects} /> : null}
        <TraceList agentTrace={agentTrace} />
      </div>
    )
  }

  if ((phase === "streaming" || phase === "reading") && selectionRects.length === 0) {
    if (selectionText) {
      return (
        <div className="animate-fade-in space-y-3">
          {evidence.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {evidence.map((item, index) => (
                <CitationPreviewButton
                  key={item.chunkId}
                  item={item}
                  label={evidenceLabel(item, evidence)}
                  style={staggerStyle(index)}
                  onClick={() => onCitationClick?.(item.chunkId)}
                />
              ))}
            </div>
          ) : null}
          {followUps.length > 0 ? (
            <FollowUpList
              followUps={followUps}
              evidence={evidence}
              citationChunkIds={citationChunkIds}
              onCitationClick={onCitationClick}
            />
          ) : null}
          <TraceList agentTrace={agentTrace} />
        </div>
      )
    }
    return (
      <div className="rounded-md border bg-muted/20 px-3 py-4 text-sm leading-6 text-muted-foreground">
        在文中框选一段，Spark 会显示深度解读、证据和引用回跳。
      </div>
    )
  }

  if (phase === "streaming" || phase === "reading") {
    return (
      <div className="animate-fade-in space-y-3 text-sm leading-7">
        {followUps.length > 0 ? (
          <FollowUpList
            followUps={followUps}
            evidence={evidence}
            citationChunkIds={citationChunkIds}
            onCitationClick={onCitationClick}
          />
        ) : null}
        <TraceList agentTrace={agentTrace} />
        <CoordinateList selectionRects={selectionRects} />
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="flex animate-fade-in gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">解读失败</p>
          <p className="mt-1 text-danger-foreground/85">
            {errorMessage || "完整 LLM 解读暂时不可用，已保留当前选区和检索证据。"}
          </p>
          {evidence.length > 0 ? (
            <p className="mt-2 text-xs text-danger-foreground/75">已检索证据：{evidence.length} 段</p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-muted/20 px-3 py-4 text-sm leading-6 text-muted-foreground">
      框选一段试试；Spark 会先找证据，再给出可回跳的解释。
    </div>
  )
}

function FollowUpList({
  followUps,
  evidence = [],
  citationChunkIds,
  onCitationClick,
}: {
  followUps: FollowUpTurn[]
  evidence?: EvidencePreview[]
  citationChunkIds?: string[]
  onCitationClick?: (chunkId: string) => void
}) {
  return (
    <div className="space-y-3 border-t pt-3 text-sm leading-7">
      {followUps.map((turn, index) => (
        <div key={turn.id} className="animate-slide-in-up space-y-2" style={staggerStyle(index)}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">追问 #{index + 1}</Badge>
          </div>
          <div className="rounded-md bg-accent px-3 py-2 text-accent-foreground">
            {turn.question}
          </div>
          <div className="rounded-md bg-muted/60 px-3 py-2">
            <MarkdownContent
              content={turn.answer}
              evidence={evidence}
              citationChunkIds={citationChunkIds}
              onCitationClick={onCitationClick}
              className="text-sm"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function CitationPreviewButton({
  item,
  label,
  style,
  onClick,
}: {
  item: EvidencePreview
  label: string
  style?: CSSProperties
  onClick?: () => void
}) {
  const preview = sanitizeInternalReferenceText(item.title)
    .replace(/[A-Za-z0-9]{6,}-p\d+-c\d+-[A-Za-z0-9]{6,}/g, "引用")
    .slice(0, 140)
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="animate-slide-in-up rounded-md border bg-background px-2 py-1 text-xs transition-[background-color,box-shadow,transform] duration-interactive ease-reader hover:bg-muted hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring active:scale-[0.98]"
        style={style}
        onClick={onClick}
        aria-label={`${label}，点击回到原文`}
      >
        {label}
      </button>
      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-64 rounded-md border bg-popover px-3 py-2 text-left text-xs leading-5 text-popover-foreground shadow-lg group-focus-within:block group-hover:block">
        <span className="block font-medium">第 {item.pageIndex + 1} 页</span>
        <span className="mt-1 block text-muted-foreground">{preview || "原文证据预览"}</span>
      </span>
    </span>
  )
}

function retrievalTraceItems(
  agentTrace: AgentTraceStep[],
  fallbackEvidence: EvidencePreview[],
) {
  const retrievalSteps = agentTrace.filter((step) => step.phase === "plan" || step.phase === "retrieve")
  if (retrievalSteps.length === 0) {
    return [
      {
        label: "当前选区的上下文和相邻证据",
        evidence: fallbackEvidence,
      },
    ]
  }

  return retrievalSteps.slice(0, 4).map((step, index) => {
    const stepEvidence = fallbackEvidence.filter((item) => step.chunkIds.includes(item.chunkId))
    return {
      label:
        traceQueryLabel(step.query) ||
        sanitizeInternalReferenceText(step.note).slice(0, 64) ||
        `检索子问题 ${index + 1}`,
      evidence: stepEvidence.length > 0 ? stepEvidence : fallbackEvidence.slice(0, 3),
    }
  })
}

type InterpretationTrustState = {
  groundedCitationCount: number
  droppedCitationCount: number
  answerSource: AnswerSource
  label: string
  tone: "ok" | "warn" | "muted"
}

function interpretationTrustState(
  text: string,
  evidence: EvidencePreview[],
  citationChunkIds: string[] | undefined,
  answerSource: AnswerSource,
): InterpretationTrustState {
  const allowed = new Set(citationChunkIds?.length ? citationChunkIds : evidence.map((item) => item.chunkId))
  const grounded = new Set<string>()
  let dropped = 0
  for (const match of text.matchAll(internalCitationPattern)) {
    const rawIds = match[1] ?? ""
    const ids = chunkIdsInCitation(rawIds)
    if (ids.length === 0) {
      dropped += 1
      continue
    }
    for (const chunkId of ids) {
      if (allowed.has(chunkId)) {
        grounded.add(chunkId)
      } else {
        dropped += 1
      }
    }
  }
  if (answerSource === "local_fallback") {
    return {
      groundedCitationCount: grounded.size,
      droppedCitationCount: dropped,
      answerSource,
      label: "本地兜底",
      tone: "muted",
    }
  }
  if (dropped > 0) {
    return {
      groundedCitationCount: grounded.size,
      droppedCitationCount: dropped,
      answerSource,
      label: "部分引用未核验",
      tone: "warn",
    }
  }
  return {
    groundedCitationCount: grounded.size,
    droppedCitationCount: 0,
    answerSource,
    label: grounded.size > 0 ? "全部引用可核验" : "未发现显式引用",
    tone: grounded.size > 0 ? "ok" : "muted",
  }
}

function InterpretationTrustBadge({ trust }: { trust: InterpretationTrustState }) {
  const className =
    trust.tone === "ok"
      ? "border-success/30 bg-success/10 text-success-foreground"
      : trust.tone === "warn"
        ? "border-warning/40 bg-warning/10 text-warning-foreground"
        : "border-muted bg-muted/60 text-muted-foreground"
  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${className}`}>
      <span className="font-medium">{trust.label}</span>
      <span>接地 {trust.groundedCitationCount}</span>
      {trust.droppedCitationCount > 0 ? <span>丢弃 {trust.droppedCitationCount}</span> : null}
      <span>{trust.answerSource === "llm" ? "LLM" : "local"}</span>
    </div>
  )
}

function LocalFallbackNotice({
  message,
  onOpenSettings,
}: {
  message?: string
  onOpenSettings?: () => void
}) {
  return (
    <div className="flex gap-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-6 text-warning-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="space-y-1">
        <Badge variant="secondary" className="bg-warning/15 text-warning-foreground">
          本地模板兜底
        </Badge>
        <p>
          {message?.trim() ||
            "已使用本地转换稿和可回跳证据生成回答；完整 LLM 解读需要桌面版、API Key 和网络连接可用。"}
        </p>
        {onOpenSettings ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 h-7 border-warning/40 bg-warning/15 px-2 text-xs text-warning-foreground hover:bg-warning/25"
            onClick={onOpenSettings}
          >
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            打开设置
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CoordinateList({ selectionRects }: { selectionRects: NormalizedPageRect[] }) {
  return (
    <details className="group rounded-md border bg-background text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <span>
          PDF 坐标选区（校对）· 归一化页坐标 · {selectionRects.length} 个矩形
        </span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-subtle ease-reader group-open:rotate-180" />
      </summary>
      <div className="max-h-52 space-y-2 overflow-auto border-t p-2 font-mono text-[11px] leading-5">
        <p className="font-sans text-[11px] leading-5 text-muted-foreground">
          扫描版或 OCR 结果可能近似；以转换稿文本和引用回跳作为核对入口。
        </p>
        {selectionRects.map((rect, index) => (
          <div key={index}>
            p{rect.pageIndex + 1}: [{rect.x0.toFixed(4)}, {rect.y0.toFixed(4)},{" "}
            {rect.x1.toFixed(4)}, {rect.y1.toFixed(4)}]
          </div>
        ))}
      </div>
    </details>
  )
}

function TraceList({ agentTrace }: { agentTrace: AgentTraceStep[] }) {
  if (agentTrace.length === 0) {
    return null
  }

  return (
    <details className="group rounded-md border bg-background text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <span>检索轨迹 · {agentTrace.length} 步</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-subtle ease-reader group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t p-2">
        {agentTrace.slice(0, 6).map((step, index) => (
          <div key={`${step.phase}-${index}`} className="rounded bg-muted/60 px-2 py-1.5">
            <div className="font-medium text-foreground/80">
              {tracePhaseLabel(step.phase)}
              {traceQueryLabel(step.query) ? (
                <span className="ml-1 text-muted-foreground">· {traceQueryLabel(step.query)}</span>
              ) : null}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {sanitizeInternalReferenceText(step.note)}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

function tracePhaseLabel(phase: AgentTraceStep["phase"]) {
  switch (phase) {
    case "plan":
      return "Plan"
    case "retrieve":
      return "Retrieve"
    case "iterate":
      return "Iterate"
    case "synthesize":
      return "Synthesize"
  }
}

function traceQueryLabel(query?: string | null) {
  if (!query) {
    return ""
  }
  if (query.startsWith("llm_tool_round_")) {
    const round = query.replace("llm_tool_round_", "")
    return `模型检索第 ${round} 轮`
  }
  if (query === "llm_tools") {
    return "模型检索"
  }
  if (query === "deterministic_fallback") {
    return "本地补检索"
  }
  if (query === "focus_chunk_ids") {
    return "当前选区"
  }
  if (query === "prior_evidence") {
    return "上一轮证据"
  }
  if (query === "list_structure") {
    return "章节结构"
  }
  if (query.includes("chunk_id") || query.includes("chunkId")) {
    return sanitizeInternalReferenceText(query)
  }
  return query
}

export function renderCitations(
  text: string,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
) {
  return renderMarkdownTextWithCitations(text, onCitationClick, clickableCitations, citationLabels)
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("reader-shimmer h-3 animate-shimmer rounded bg-muted", className)} />
}

function staggerStyle(index: number) {
  return { animationDelay: `${Math.min(index, 8) * 50}ms` }
}
