import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InterpretationCard } from "@/components/interpretation/InterpretationCard"
import type {
  AgentTraceStep,
  AnswerSource,
  EvidencePreview,
  FollowUpTurn,
  ReaderPhase,
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
  question: string
  noteDraft: string
  noteSaving?: boolean
  noteError?: string
  lightweight: boolean
  runtimeHint?: string
  onNoteChange: (note: string) => void
  onSaveNote: () => void
  onCopyInterpretation: () => void
  onCitationClick: (chunkId: string) => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: () => void
  onRegenerate: () => void
  onStop: () => void
  onOpenSettings: () => void
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
  question,
  noteDraft,
  noteSaving = false,
  noteError = "",
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
}: CurrentThreadProps) {
  const hasSelection = selectionText.trim().length > 0
  const hasInterpretation = interpretation.trim().length > 0

  if (!hasSelection && !hasInterpretation) {
    return <SparkEmptyState runtimeHint={runtimeHint} onOpenSettings={onOpenSettings} />
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
      onCopy={onCopyInterpretation}
      onQuestionChange={onQuestionChange}
      onQuestionSubmit={onQuestionSubmit}
      onCitationClick={onCitationClick}
      onRegenerate={onRegenerate}
      onNoteChange={onNoteChange}
      onSave={onSaveNote}
      onStop={onStop}
      onOpenSettings={onOpenSettings}
      runtimeHint={runtimeHint}
    />
  )
}

function SparkEmptyState({
  runtimeHint,
  onOpenSettings,
}: {
  runtimeHint?: string
  onOpenSettings: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-foreground">框选一段原文试试</p>
      <p className="mt-2 max-w-64 text-sm leading-6 text-muted-foreground">
        Spark 会先在全书检索证据，再给出带可点击引用、可追问的解读。
      </p>
      <p className="mt-3 max-w-64 text-xs leading-5 text-muted-foreground">
        深度 / 轻量在框选浮条上选择。
      </p>
      {runtimeHint ? (
        <p className="mt-4 max-w-64 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
          {runtimeHint}
        </p>
      ) : null}
      <Button size="sm" variant="ghost" className="mt-4" onClick={onOpenSettings}>
        查看 AI 设置
      </Button>
    </div>
  )
}
