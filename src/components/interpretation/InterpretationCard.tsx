import {
  AlertCircle,
  ChevronDown,
  Copy,
  KeyRound,
  RefreshCcw,
  Save,
  Square,
  MessageSquareText,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  MarkdownContent,
  renderMarkdownTextWithCitations,
} from "@/components/markdown/MarkdownContent"
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
  evidenceLabel,
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
  askOpen?: boolean
  question?: string
  onAskToggle?: () => void
  onQuestionChange?: (question: string) => void
  onQuestionSubmit?: () => void
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
  askOpen = false,
  question = "",
  onAskToggle,
  onQuestionChange,
  onQuestionSubmit,
  onCopy,
  onSave,
  onCitationClick,
  onRegenerate,
  onStop,
  onOpenSettings,
  runtimeHint,
  className,
}: InterpretationCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>解读</CardTitle>
            <blockquote className="mt-3 border-l-2 border-primary/50 pl-3 font-reading text-sm leading-7 text-muted-foreground">
              {selectionText || "尚未选择文本"}
            </blockquote>
          </div>
          {phase === "streaming" ? (
            <Button size="icon" variant="ghost" aria-label="停止生成" onClick={onStop}>
              <Square className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
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
        {askOpen ? (
          <div className="flex gap-2 rounded-md border bg-background p-2">
            <textarea
              className="min-h-20 flex-1 resize-none bg-transparent text-sm outline-none"
              placeholder="输入你的问题或解读要求；会围绕当前选区继续检索证据"
              value={question}
              onChange={(event) => onQuestionChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (shouldSubmitTextarea(event)) {
                  event.preventDefault()
                  onQuestionSubmit?.()
                }
              }}
            />
            <Button size="sm" disabled={question.trim().length === 0} onClick={onQuestionSubmit}>
              发送
            </Button>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button size="sm" onClick={onAskToggle} disabled={!selectionText}>
            <MessageSquareText className="mr-1.5 h-4 w-4" />
            继续追问
          </Button>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="复制解读" onClick={onCopy} disabled={!selectionText}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="保存标记" onClick={onSave} disabled={!selectionText}>
              <Save className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="重新生成解读" onClick={onRegenerate} disabled={!selectionText}>
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
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
    return (
      <div className="animate-fade-in space-y-3">
        <p className="text-sm text-muted-foreground">正在书中查找相关证据</p>
        <div className="flex flex-wrap gap-2">
          {visibleEvidence.map((item, index) => (
            <Badge
              key={item.chunkId}
              variant="secondary"
              className="animate-slide-in-up"
              style={staggerStyle(index)}
            >
              {evidenceLabel(item, evidence)}
            </Badge>
          ))}
        </div>
      </div>
    )
  }

  if ((phase === "streaming" || phase === "reading") && interpretation) {
    return (
      <div className="animate-fade-in space-y-4 text-sm leading-7">
        {answerSource === "local_fallback" ? (
          <LocalFallbackNotice message={errorMessage} onOpenSettings={onOpenSettings} />
        ) : null}
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
              <button
                key={item.chunkId}
                className="animate-slide-in-up rounded-md border bg-background px-2 py-1 text-xs transition-[background-color,box-shadow,transform] duration-interactive ease-reader hover:bg-muted hover:shadow-sm active:scale-[0.98]"
                style={staggerStyle(index)}
                onClick={() => onCitationClick?.(item.chunkId)}
              >
                {evidenceLabel(item, evidence, index)}
              </button>
            ))}
          </div>
        ) : null}
        {followUps.length > 0 ? (
          <div className="space-y-3 border-t pt-3">
            {followUps.map((turn, index) => (
              <div key={turn.id} className="animate-slide-in-up space-y-2" style={staggerStyle(index)}>
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
                <button
                  key={item.chunkId}
                  className="animate-slide-in-up rounded-md border bg-background px-2 py-1 text-xs transition-[background-color,box-shadow,transform] duration-interactive ease-reader hover:bg-muted hover:shadow-sm active:scale-[0.98]"
                  style={staggerStyle(index)}
                  onClick={() => onCitationClick?.(item.chunkId)}
                >
                  {evidenceLabel(item, evidence)}
                </button>
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
    return <p className="text-sm text-muted-foreground">在转换稿上框选一段文字，右侧会显示解读入口。</p>
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
      <div className="flex animate-fade-in gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-950">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">解读失败</p>
          <p className="mt-1 text-red-900/80">
            {errorMessage || "完整 LLM 解读暂时不可用，已保留当前选区和检索证据。"}
          </p>
        </div>
      </div>
    )
  }

  return <p className="text-sm text-muted-foreground">选择一段文字后开始解读。</p>
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

function LocalFallbackNotice({
  message,
  onOpenSettings,
}: {
  message?: string
  onOpenSettings?: () => void
}) {
  return (
    <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-950">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div className="space-y-1">
        <Badge variant="secondary" className="bg-amber-100 text-amber-950">
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
            className="mt-1 h-7 border-amber-300 bg-amber-100 px-2 text-xs text-amber-950 hover:bg-amber-200"
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
