import {
  AlertCircle,
  BookMarked,
  ChevronDown,
  Copy,
  FileSearch,
  KeyRound,
  Loader2,
  NotebookPen,
  RefreshCcw,
  Send,
  Square,
  User,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
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
  citationMarkerLabel,
  citationMarkerLabelMapForChunkIds,
  chunkIdsInCitation,
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
  noteInitiallyOpen?: boolean
  onQuestionChange?: (question: string) => void
  onQuestionSubmit?: (question?: string) => void
  onNoteChange?: (note: string) => void
  onCopy?: () => void
  onSave?: () => void
  onCitationClick?: (chunkId: string) => void
  onRegenerate?: () => void
  onStop?: () => void
  onOpenSettings?: () => void
  onExportToObsidian?: () => void
  obsidianExporting?: boolean
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
  noteInitiallyOpen = false,
  onQuestionChange,
  onQuestionSubmit,
  onNoteChange,
  onCopy,
  onSave,
  onCitationClick,
  onRegenerate,
  onStop,
  onOpenSettings,
  onExportToObsidian,
  obsidianExporting = false,
  runtimeHint,
  className,
}: InterpretationCardProps) {
  const [stopping, setStopping] = useState(false)
  const [noteOpen, setNoteOpen] = useState(noteInitiallyOpen)
  const previousNoteSaving = useRef(noteSaving)
  const streaming = phase === "streaming"
  const busy = phase === "planning" || phase === "retrieving" || streaming
  const hasSelection = selectionText.trim().length > 0
  const showActions = hasSelection && !busy
  const submitQuestion = (value = question) => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    onQuestionSubmit?.(trimmed)
  }
  useEffect(() => {
    if (!streaming) {
      setStopping(false)
    }
  }, [streaming])
  useEffect(() => {
    if (noteInitiallyOpen) {
      setNoteOpen(true)
    }
  }, [noteInitiallyOpen])
  useEffect(() => {
    const wasSaving = previousNoteSaving.current
    previousNoteSaving.current = noteSaving
    if (noteOpen && wasSaving && !noteSaving && !noteError && !noteDraft.trim()) {
      setNoteOpen(false)
    }
  }, [noteDraft, noteError, noteOpen, noteSaving])

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {streaming ? (
        <div className="shrink-0 pb-2">
          <div className="reader-panel-muted flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="reader-provider-dot-active h-1.5 w-1.5 animate-pulse rounded-full" />
              正在生成
            </span>
            <button
              type="button"
              className="reader-chrome-icon-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={stopping ? "停止中" : "停止生成"}
              disabled={stopping}
              onClick={() => {
                setStopping(true)
                onStop?.()
              }}
            >
              {stopping ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3 pr-1">
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
          <p className="reader-panel-subtle rounded-md px-3 py-2 text-xs">
            {sanitizeInternalReferenceText(runtimeHint)}
          </p>
        ) : null}
      </div>
      {showActions ? (
        <div className="reader-panel-border reader-panel-input-bar -mx-2 mt-auto shrink-0 space-y-2 border-t px-2 py-2 backdrop-blur">
          <div className="reader-panel-input flex gap-1.5 rounded-md border p-1.5">
            <textarea
              className="max-h-24 min-h-9 flex-1 resize-none bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-[var(--reader-panel-muted)]"
              placeholder="围绕这段继续追问；会检索证据后回答"
              value={question}
              onChange={(event) => onQuestionChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (shouldSubmitTextarea(event)) {
                  event.preventDefault()
                  submitQuestion()
                }
              }}
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0 self-end"
              disabled={question.trim().length === 0}
              aria-label="发送"
              title="发送"
              onClick={() => submitQuestion()}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">发送</span>
            </Button>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <SuggestedFollowUps
              selectionText={selectionText}
              followUps={followUps}
              onPick={(suggestion) => {
                onQuestionChange?.(suggestion)
                submitQuestion(suggestion)
              }}
            />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {onExportToObsidian && interpretation.trim().length > 0 ? (
                <button
                  type="button"
                  className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="存到 Obsidian"
                  title="存到 Obsidian"
                  disabled={obsidianExporting}
                  onClick={onExportToObsidian}
                >
                  {obsidianExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BookMarked className="h-4 w-4" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                className={cn(
                  "reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100",
                  noteOpen && "reader-chrome-view-active",
                )}
                aria-pressed={noteOpen}
                aria-label="保存笔记"
                title="保存笔记"
                onClick={() => setNoteOpen((open) => !open)}
              >
                <NotebookPen className="h-4 w-4" />
                <span className="sr-only">保存</span>
              </button>
              <button
                type="button"
                className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100"
                aria-label="复制解读"
                title="复制解读"
                onClick={onCopy}
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="reader-chrome-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100"
                aria-label="重新生成解读"
                title="重新生成解读"
                onClick={onRegenerate}
              >
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
          {noteOpen ? (
            <div className="reader-panel-input space-y-2 rounded-md border p-2">
              <textarea
                className="min-h-14 w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-[var(--reader-panel-muted)]"
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
        <p className="reader-panel-muted text-sm">AI 正在书中查找</p>
        <div className="space-y-2">
          {retrievalSteps.map((step, index) => (
            <div
              key={`${step.label}-${index}`}
              className="reader-panel-card animate-slide-in-up rounded-md border px-3 py-2"
              style={staggerStyle(index)}
            >
              <div className="flex items-start gap-2 text-sm font-medium">
                <FileSearch className="reader-panel-accent mt-0.5 h-4 w-4 shrink-0" />
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
    const citationLabels = visibleCitationLabelMap(evidence, citationChunkIds, interpretation, followUps)
    return (
      <div className="animate-fade-in space-y-4 text-sm leading-7">
        {answerSource === "local_fallback" ? (
          <LocalFallbackNotice message={errorMessage} onOpenSettings={onOpenSettings} />
        ) : null}
        {answerSource !== "local_fallback" && trust.droppedCitationCount > 0 ? (
          <CitationValidationNotice />
        ) : null}
        <ConversationTimeline
          interpretation={interpretation}
          followUps={followUps}
          evidence={evidence}
          citationChunkIds={citationChunkIds}
          citationLabels={citationLabels}
          onCitationClick={onCitationClick}
        />
        {selectionRects.length > 0 ? <CoordinateList selectionRects={selectionRects} /> : null}
        <TraceList agentTrace={agentTrace} />
      </div>
    )
  }

  if ((phase === "streaming" || phase === "reading") && selectionRects.length === 0) {
    if (selectionText) {
      const citationLabels = visibleCitationLabelMap(evidence, citationChunkIds, "", followUps)
      return (
        <div className="animate-fade-in space-y-3">
          {evidence.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {evidence.map((item, index) => (
                <CitationPreviewButton
                  key={item.chunkId}
                  item={item}
                  label={citationLabels.get(item.chunkId) ?? citationMarkerLabel(index)}
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
              citationLabels={citationLabels}
              onCitationClick={onCitationClick}
            />
          ) : null}
          <TraceList agentTrace={agentTrace} />
        </div>
      )
    }
    return (
      <div className="reader-panel-card reader-panel-muted rounded-md border px-3 py-4 text-sm leading-6">
        在文中框选一段，Spark 会显示深度解读、证据和引用回跳。
      </div>
    )
  }

  if (phase === "streaming" || phase === "reading") {
    const citationLabels = visibleCitationLabelMap(evidence, citationChunkIds, "", followUps)
    return (
      <div className="animate-fade-in space-y-3 text-sm leading-7">
        {followUps.length > 0 ? (
          <FollowUpList
            followUps={followUps}
            evidence={evidence}
            citationChunkIds={citationChunkIds}
            citationLabels={citationLabels}
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
    <div className="reader-panel-card reader-panel-muted rounded-md border px-3 py-4 text-sm leading-6">
      框选一段试试；Spark 会先找证据，再给出可回跳的解释。
    </div>
  )
}

function ConversationTimeline({
  interpretation,
  followUps,
  evidence,
  citationChunkIds,
  citationLabels,
  onCitationClick,
}: {
  interpretation: string
  followUps: FollowUpTurn[]
  evidence: EvidencePreview[]
  citationChunkIds?: string[]
  citationLabels: ReadonlyMap<string, string>
  onCitationClick?: (chunkId: string) => void
}) {
  return (
    <div className="space-y-4">
      {interpretation ? (
        <AssistantTurn
          content={interpretation}
          evidence={evidence}
          citationChunkIds={citationChunkIds}
          citationLabels={citationLabels}
          variant="plain"
          onCitationClick={onCitationClick}
        >
          {evidence.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {evidence.map((item, index) => (
                <CitationPreviewButton
                  key={item.chunkId}
                  item={item}
                  label={citationLabels.get(item.chunkId) ?? citationMarkerLabel(index)}
                  onClick={() => onCitationClick?.(item.chunkId)}
                />
              ))}
            </div>
          ) : null}
        </AssistantTurn>
      ) : null}
      {followUps.length > 0 ? (
        <div className="reader-panel-border space-y-4 border-t pt-4">
          {followUps.map((turn, index) => (
            <div key={turn.id} className="animate-slide-in-up space-y-3" style={staggerStyle(index)}>
              <UserTurn label={`你 · 追问 ${index + 1}`}>{turn.question}</UserTurn>
              <AssistantTurn
                content={turn.answer}
                evidence={evidence}
                citationChunkIds={citationChunkIds}
                citationLabels={citationLabels}
                streaming={turn.answer.trim().length === 0}
                onCitationClick={onCitationClick}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FollowUpList({
  followUps,
  evidence = [],
  citationChunkIds,
  citationLabels,
  onCitationClick,
}: {
  followUps: FollowUpTurn[]
  evidence?: EvidencePreview[]
  citationChunkIds?: string[]
  citationLabels?: ReadonlyMap<string, string>
  onCitationClick?: (chunkId: string) => void
}) {
  const labels = citationLabels ?? visibleCitationLabelMap(evidence, citationChunkIds, "", followUps)
  return (
    <div className="reader-panel-border space-y-4 border-t pt-4 text-sm leading-7">
      {followUps.map((turn, index) => (
        <div key={turn.id} className="animate-slide-in-up space-y-3" style={staggerStyle(index)}>
          <UserTurn label={`你 · 追问 ${index + 1}`}>{turn.question}</UserTurn>
          <AssistantTurn
            content={turn.answer}
            evidence={evidence}
            citationChunkIds={citationChunkIds}
            citationLabels={labels}
            streaming={turn.answer.trim().length === 0}
            onCitationClick={onCitationClick}
          />
        </div>
      ))}
    </div>
  )
}

function AssistantTurn({
  content,
  evidence,
  citationChunkIds,
  citationLabels,
  streaming = false,
  variant = "card",
  children,
  onCitationClick,
}: {
  content: string
  evidence: EvidencePreview[]
  citationChunkIds?: string[]
  citationLabels?: ReadonlyMap<string, string>
  streaming?: boolean
  variant?: "plain" | "card"
  children?: React.ReactNode
  onCitationClick?: (chunkId: string) => void
}) {
  return (
    <section
      className={cn(
        variant === "card"
          ? "reader-panel-card rounded-md border px-3 py-3 shadow-sm"
          : "reader-panel-text px-0.5",
      )}
    >
      {streaming ? (
        <p className="reader-panel-chip inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs">
          <span className="reader-provider-dot-active h-1.5 w-1.5 animate-pulse rounded-full" />
          正在回答
        </p>
      ) : (
        <MarkdownContent
          content={content}
          evidence={evidence}
          citationChunkIds={citationChunkIds}
          citationLabels={citationLabels}
          onCitationClick={onCitationClick}
          className="text-sm"
        />
      )}
      {children}
    </section>
  )
}

function UserTurn({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="reader-spark-user-turn ml-6 rounded-md px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium opacity-75">
        <span className="reader-spark-user-icon inline-flex h-5 w-5 items-center justify-center rounded-full">
          <User className="h-3 w-3" />
        </span>
        {label}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{children}</p>
    </section>
  )
}

function SuggestedFollowUps({
  selectionText,
  followUps,
  onPick,
}: {
  selectionText: string
  followUps: FollowUpTurn[]
  onPick: (question: string) => void
}) {
  const suggestions = followUpSuggestions(selectionText, followUps.length)
  return (
    <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
      {suggestions.slice(0, 2).map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="reader-panel-button min-w-0 truncate rounded-md border px-2 py-1 text-xs transition-[background-color,color,box-shadow,transform] duration-interactive ease-reader hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring active:scale-[0.98]"
          title={suggestion}
          onClick={() => onPick(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}

function followUpSuggestions(selectionText: string, followUpCount: number) {
  const shortSelection = selectionText.trim().length < 80
  if (followUpCount > 0) {
    return ["继续追问证据", "换个角度解释", "和前文怎么接上？"]
  }
  if (shortSelection) {
    return ["它在说什么？", "为什么重要？", "前后文依据是什么？"]
  }
  return ["概括核心意思", "这段的隐含前提是什么？", "找书中呼应证据"]
}

function CitationPreviewButton({
  item,
  label,
  onClick,
}: {
  item: EvidencePreview
  label: string
  onClick?: () => void
}) {
  const pageLabel = `第 ${item.pageIndex + 1} 页`
  return (
    <span className="inline-flex">
      <button
        type="button"
        className="reader-spark-citation inline-flex rounded px-1 text-xs font-semibold underline-offset-2 transition-colors duration-subtle ease-reader hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
        onClick={onClick}
        aria-label={`${label}，点击回到${pageLabel}原文`}
      >
        {label}
      </button>
    </span>
  )
}

function visibleCitationLabelMap(
  evidence: EvidencePreview[],
  citationChunkIds: string[] | undefined,
  interpretation: string,
  followUps: FollowUpTurn[],
) {
  return citationMarkerLabelMapForChunkIds([
    ...(citationChunkIds ?? []),
    ...chunkIdsInText(interpretation),
    ...followUps.flatMap((turn) => chunkIdsInText(turn.answer)),
    ...evidence.map((item) => item.chunkId),
  ])
}

function chunkIdsInText(text: string) {
  const ids: string[] = []
  for (const match of text.matchAll(internalCitationPattern)) {
    ids.push(...chunkIdsInCitation(match[1] ?? ""))
  }
  return ids
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

function CitationValidationNotice() {
  return (
    <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning-foreground">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>部分引用未核验，已保留可点击的有效引用。</span>
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
    <details className="reader-panel-details group rounded-md border text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <span>
          PDF 坐标选区（校对）· 归一化页坐标 · {selectionRects.length} 个矩形
        </span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-subtle ease-reader group-open:rotate-180" />
      </summary>
      <div className="reader-panel-border max-h-52 space-y-2 overflow-auto border-t p-2 font-mono text-[11px] leading-5">
        <p className="reader-panel-muted font-sans text-[11px] leading-5">
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
    <details className="reader-panel-details group rounded-md border text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <span>检索轨迹 · {agentTrace.length} 步</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-subtle ease-reader group-open:rotate-180" />
      </summary>
      <div className="reader-panel-border space-y-2 border-t p-2">
        {agentTrace.slice(0, 6).map((step, index) => (
          <div key={`${step.phase}-${index}`} className="reader-panel-details-row rounded px-2 py-1.5">
            <div className="reader-panel-text font-medium opacity-80">
              {tracePhaseLabel(step.phase)}
              {traceQueryLabel(step.query) ? (
                <span className="reader-panel-muted ml-1">· {traceQueryLabel(step.query)}</span>
              ) : null}
            </div>
            <div className="reader-panel-muted mt-0.5">
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
  return <div className={cn("reader-shimmer reader-shimmer-reader h-3 animate-shimmer rounded", className)} />
}

function staggerStyle(index: number) {
  return { animationDelay: `${Math.min(index, 8) * 50}ms` }
}
