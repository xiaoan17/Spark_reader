import {
  AlertCircle,
  Copy,
  RefreshCcw,
  Save,
  SearchCheck,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  MarkdownContent,
  renderMarkdownTextWithCitations,
} from "@/components/markdown/MarkdownContent"
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
  onExplain?: () => void
  onPlainExplain?: () => void
  onSave?: () => void
  onCitationClick?: (chunkId: string) => void
  onRegenerate?: () => void
  onStop?: () => void
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
  onExplain,
  onPlainExplain,
  onSave,
  onCitationClick,
  onRegenerate,
  onStop,
  runtimeHint,
  className,
}: InterpretationCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>深度解读</CardTitle>
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
        />
        {runtimeHint ? (
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
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  onQuestionSubmit?.()
                }
              }}
            />
            <Button size="sm" disabled={question.trim().length === 0} onClick={onQuestionSubmit}>
              发送
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" onClick={onExplain} disabled={!selectionText}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            深度解读
          </Button>
          <Button size="sm" variant="ghost" onClick={onPlainExplain} disabled={!selectionText}>
            <SearchCheck className="mr-1.5 h-4 w-4" />
            它在说什么
          </Button>
          <Button size="sm" variant="ghost" onClick={onAskToggle} disabled={!selectionText}>
            <Undo2 className="mr-1.5 h-4 w-4" />
            提问
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopy} disabled={!selectionText}>
            <Copy className="mr-1.5 h-4 w-4" />
            复制
          </Button>
          <Button size="sm" variant="ghost" onClick={onSave} disabled={!selectionText}>
            <Save className="mr-1.5 h-4 w-4" />
            保存
          </Button>
          <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={!selectionText}>
            <RefreshCcw className="mr-1.5 h-4 w-4" />
            重新解读
          </Button>
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
>) {
  if (phase === "planning") {
    return (
      <div className="space-y-3">
        <SkeletonLine className="w-2/3" />
        <SkeletonLine />
        <SkeletonLine className="w-5/6" />
      </div>
    )
  }

  if (phase === "retrieving") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">正在书中查找相关证据</p>
        <div className="flex flex-wrap gap-2">
          {(evidence.length > 0 ? evidence : [{ chunkId: "local-selection", title: "当前选区", pageIndex: 0 }]).map((item) => (
            <Badge key={item.chunkId} variant="secondary">
              {evidenceLabel(item, evidence)}
            </Badge>
          ))}
        </div>
      </div>
    )
  }

  if ((phase === "streaming" || phase === "reading") && interpretation) {
    return (
      <div className="space-y-4 text-sm leading-7">
        {answerSource === "local_fallback" ? (
          <Badge variant="secondary">本地模板兜底</Badge>
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
                className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
                onClick={() => onCitationClick?.(item.chunkId)}
              >
                {evidenceLabel(item, evidence, index)}
              </button>
            ))}
          </div>
        ) : null}
        {followUps.length > 0 ? (
          <div className="space-y-3 border-t pt-3">
            {followUps.map((turn) => (
              <div key={turn.id} className="space-y-2">
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
        {selectionRects.length > 0 ? (
          <CoordinateList selectionRects={selectionRects} />
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            当前选区来自转换稿，会保存为文本锚点；引用可点击回到原文。
          </p>
        )}
      </div>
    )
  }

  if ((phase === "streaming" || phase === "reading") && selectionRects.length === 0) {
    if (selectionText) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            已从转换稿选中文字，可以解读、追问并保存为文本高亮；原 PDF 坐标只用于版面校对。
          </p>
          {evidence.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {evidence.map((item) => (
                <button
                  key={item.chunkId}
                  className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
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
        </div>
      )
    }
    return <p className="text-sm text-muted-foreground">在转换稿上框选一段文字，右侧会显示解读入口。</p>
  }

  if (phase === "streaming" || phase === "reading") {
    return (
      <div className="space-y-3 text-sm leading-7">
        <p className="text-muted-foreground">
          已捕获带几何坐标的 PDF 选区；解读会使用转换稿文字，坐标用于高亮回跳。
        </p>
        {followUps.length > 0 ? (
          <FollowUpList
            followUps={followUps}
            evidence={evidence}
            citationChunkIds={citationChunkIds}
            onCitationClick={onCitationClick}
          />
        ) : null}
        <CoordinateList selectionRects={selectionRects} />
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-950">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">解读失败</p>
          <p className="mt-1 text-red-900/80">
            {errorMessage || "LLM 后端暂时不可用，已保留当前选区和检索证据。"}
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
      {followUps.map((turn) => (
        <div key={turn.id} className="space-y-2">
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

function CoordinateList({ selectionRects }: { selectionRects: NormalizedPageRect[] }) {
  return (
    <div className="max-h-52 space-y-2 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-5">
      {selectionRects.map((rect, index) => (
        <div key={index}>
          p{rect.pageIndex + 1}: [{rect.x0.toFixed(4)}, {rect.y0.toFixed(4)},{" "}
          {rect.x1.toFixed(4)}, {rect.y1.toFixed(4)}]
        </div>
      ))}
    </div>
  )
}

function TraceList({ agentTrace }: { agentTrace: AgentTraceStep[] }) {
  if (agentTrace.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-2 text-xs">
      <div className="font-medium text-muted-foreground">检索轨迹</div>
      {agentTrace.slice(0, 6).map((step, index) => (
        <div key={`${step.phase}-${index}`} className="rounded bg-muted/60 px-2 py-1.5">
          <div className="font-medium">
            {tracePhaseLabel(step.phase)}
            {step.query ? <span className="ml-1 text-muted-foreground">· {step.query}</span> : null}
          </div>
          <div className="mt-0.5 text-muted-foreground">{step.note}</div>
        </div>
      ))}
    </div>
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

export function renderCitations(
  text: string,
  onCitationClick?: (chunkId: string) => void,
  clickableCitations?: ReadonlySet<string>,
  citationLabels?: ReadonlyMap<string, string>,
) {
  return renderMarkdownTextWithCitations(text, onCitationClick, clickableCitations, citationLabels)
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("h-3 rounded bg-muted", className)} />
}
