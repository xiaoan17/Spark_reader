import { AlertCircle, BookOpen, Loader2, NotebookPen, SearchCheck, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  askOpen: boolean
  question: string
  noteDraft: string
  noteSaving?: boolean
  noteError?: string
  lightweight: boolean
  runtimeHint?: string
  onLightweightChange: (enabled: boolean) => void
  onNoteChange: (note: string) => void
  onSaveNote: () => void
  onCopyInterpretation: () => void
  onCitationClick: (chunkId: string) => void
  onAskToggle: () => void
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
  askOpen,
  question,
  noteDraft,
  noteSaving = false,
  noteError = "",
  lightweight,
  runtimeHint,
  onLightweightChange,
  onNoteChange,
  onSaveNote,
  onCopyInterpretation,
  onCitationClick,
  onAskToggle,
  onQuestionChange,
  onQuestionSubmit,
  onRegenerate,
  onStop,
  onOpenSettings,
}: CurrentThreadProps) {
  const hasSelection = selectionText.trim().length > 0

  return (
    <div className="space-y-3">
      {hasSelection ? (
      <div className="rounded-md border bg-background p-2">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          <Button
            size="sm"
            variant={lightweight ? "ghost" : "secondary"}
            className="h-8"
            aria-pressed={!lightweight}
            onClick={() => onLightweightChange(false)}
          >
            <SearchCheck className="mr-1.5 h-4 w-4" />
            深度
          </Button>
          <Button
            size="sm"
            variant={lightweight ? "secondary" : "ghost"}
            className="h-8"
            aria-pressed={lightweight}
            onClick={() => onLightweightChange(true)}
          >
            <Zap className="mr-1.5 h-4 w-4" />
            轻量
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>{lightweight ? "适合快速改写、换一种说法、继续追问" : "适合需要原文证据、引用回跳和多轮核验的问题"}</span>
          <Badge variant="secondary">{lightweight ? "轻量解读" : "Spark 深度"}</Badge>
        </div>
      </div>
      ) : (
        <div className="rounded-md border bg-background p-4 text-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
              <BookOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-medium">框选一段试试</div>
              <p className="mt-1 leading-6 text-muted-foreground">
                Spark 会先检索全书证据，再生成可回跳的解读；需要快速解释时可在浮条选择轻量。
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={onOpenSettings}
              >
                查看 AI 设置
              </Button>
            </div>
          </div>
        </div>
      )}

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
        askOpen={askOpen}
        question={question}
        onAskToggle={onAskToggle}
        onCopy={onCopyInterpretation}
        onQuestionChange={onQuestionChange}
        onQuestionSubmit={onQuestionSubmit}
        onCitationClick={onCitationClick}
        onRegenerate={onRegenerate}
        onSave={onSaveNote}
        saveLabel="保存为笔记"
        saveDisabled={!selectionText.trim() || noteSaving}
        onStop={onStop}
        onOpenSettings={onOpenSettings}
        runtimeHint={runtimeHint}
        className="border-border/80"
      />

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <NotebookPen className="h-4 w-4 text-muted-foreground" />
            保存为笔记
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!hasSelection || !noteDraft.trim() || noteSaving}
            onClick={onSaveNote}
          >
            {noteSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </div>
        <textarea
          className="min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
          placeholder={hasSelection ? "用 Markdown 写下这段文字触发的想法" : "框选正文后可保存笔记"}
          value={noteDraft}
          disabled={!hasSelection}
          onChange={(event) => onNoteChange(event.target.value)}
        />
        {noteError ? <CurrentThreadError message={noteError} /> : null}
      </div>
    </div>
  )
}

function CurrentThreadError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
