import { Clock, MessageSquare, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InterpretationCard } from "@/components/interpretation/InterpretationCard"
import { summarizeInterpretationSessions } from "@/core/interpretation-history"
import type {
  AgentTraceStep,
  AnswerSource,
  EvidencePreview,
  FollowUpTurn,
  ReaderPhase,
  SavedInterpretation,
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"

export type CurrentThreadProps = {
  selectionText: string
  selectionRects: NormalizedPageRect[]
  interpretation: string
  answerSource?: AnswerSource
  followUps: FollowUpTurn[]
  citationChunkIds?: string[]
  phase: ReaderPhase
  evidence: EvidencePreview[]
  agentTrace: AgentTraceStep[]
  interpretationError?: string
  interpretationHistory?: SavedInterpretation[]
  question: string
  noteDraft: string
  noteSaving?: boolean
  noteError?: string
  noteInitiallyOpen?: boolean
  lightweight: boolean
  runtimeHint?: string
  onNoteChange: (note: string) => void
  onSaveNote: () => void
  onCopyInterpretation: () => void
  onCitationClick: (chunkId: string) => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: (question?: string) => void
  onRegenerate: () => void
  onStop: () => void
  onOpenSettings: () => void
  onExportToObsidian?: () => void
  obsidianExporting?: boolean
  onOpenHistoryItem?: (item: SavedInterpretation) => void
}

export function CurrentThread({
  selectionText,
  selectionRects,
  interpretation,
  answerSource = "llm",
  followUps,
  citationChunkIds,
  phase,
  evidence,
  agentTrace,
  interpretationError = "",
  interpretationHistory = [],
  question,
  noteDraft,
  noteSaving = false,
  noteError = "",
  noteInitiallyOpen = false,
  lightweight,
  runtimeHint,
  onNoteChange,
  onSaveNote,
  onCopyInterpretation,
  onCitationClick,
  onQuestionChange,
  onQuestionSubmit,
  onRegenerate,
  onStop,
  onOpenSettings,
  onExportToObsidian,
  obsidianExporting = false,
  onOpenHistoryItem = () => undefined,
}: CurrentThreadProps) {
  const hasSelection = selectionText.trim().length > 0
  const hasInterpretation = interpretation.trim().length > 0

  if (!hasSelection && !hasInterpretation) {
    return (
      <SparkEmptyState
        runtimeHint={runtimeHint}
        history={interpretationHistory}
        onOpenSettings={onOpenSettings}
        onOpenHistoryItem={onOpenHistoryItem}
      />
    )
  }

  return (
    <InterpretationCard
      phase={phase}
      selectionText={selectionText}
      selectionRects={selectionRects}
      evidence={evidence}
      citationChunkIds={citationChunkIds}
      agentTrace={agentTrace}
      interpretation={interpretation}
      answerSource={answerSource}
      errorMessage={interpretationError}
      followUps={followUps}
      lightweight={lightweight}
      question={question}
      noteDraft={noteDraft}
      noteSaving={noteSaving}
      noteError={noteError}
      noteInitiallyOpen={noteInitiallyOpen}
      onCopy={onCopyInterpretation}
      onQuestionChange={onQuestionChange}
      onQuestionSubmit={onQuestionSubmit}
      onCitationClick={onCitationClick}
      onRegenerate={onRegenerate}
      onNoteChange={onNoteChange}
      onSave={onSaveNote}
      onStop={onStop}
      onOpenSettings={onOpenSettings}
      onExportToObsidian={onExportToObsidian}
      obsidianExporting={obsidianExporting}
      runtimeHint={runtimeHint}
    />
  )
}

function SparkEmptyState({
  runtimeHint,
  history,
  onOpenSettings,
  onOpenHistoryItem,
}: {
  runtimeHint?: string
  history: SavedInterpretation[]
  onOpenSettings: () => void
  onOpenHistoryItem: (item: SavedInterpretation) => void
}) {
  const recent = summarizeInterpretationSessions(history).slice(0, 8)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto pb-2">
      <div className="flex min-h-[44vh] flex-col items-center justify-center px-5 text-center">
        <span className="reader-panel-accent-bg mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full">
          <Sparkles className="h-5 w-5" />
        </span>
        <p className="reader-panel-text text-sm font-medium">框选一段原文试试</p>
        <p className="reader-panel-muted mt-2 max-w-64 text-sm leading-6">
          Spark 会先在全书检索证据，再给出带可点击引用、可追问的解读。
        </p>
        <p className="reader-panel-muted mt-3 max-w-64 text-xs leading-5">
          深度 / 轻量在框选浮条上选择。
        </p>
        {runtimeHint ? (
          <p className="reader-panel-accent-border reader-panel-muted mt-4 max-w-64 border-l-2 pl-3 text-left text-xs leading-5">
            {runtimeHint}
          </p>
        ) : null}
        <Button size="sm" variant="ghost" className="mt-4" onClick={onOpenSettings}>
          查看 AI 设置
        </Button>
      </div>
      {recent.length > 0 ? (
        <section className="reader-panel-border space-y-0 border-t">
          <div className="reader-panel-muted flex items-center gap-2 px-3 py-3 text-xs font-medium">
            <Clock className="h-3.5 w-3.5" />
            最近 Spark
          </div>
          <div>
            {recent.map((item) => (
              <button
                key={item.sessionId || item.id}
                type="button"
                className="reader-panel-border reader-panel-row w-full border-t px-3 py-2.5 text-left text-sm transition-[background-color,transform] duration-interactive ease-reader focus:outline-none focus:ring-2 focus:ring-ring active:scale-[0.99]"
                onClick={() => onOpenHistoryItem(item)}
              >
                <span className="reader-panel-text line-clamp-2 font-reading leading-6">
                  {item.selectionText}
                </span>
                <span className="reader-panel-muted mt-2 flex items-center justify-between gap-2 text-xs">
                  <span>{formatHistoryTime(item.lastCreatedAt)}</span>
                  {item.followUpCount > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {item.followUpCount}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function formatHistoryTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "已保存"
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
