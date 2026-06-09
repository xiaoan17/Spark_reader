import { Sparkles, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import type {
  AgentTraceStep,
  AnswerSource,
  EvidencePreview,
  FollowUpTurn,
  ReaderPhase,
  SavedInterpretation,
  WorkbenchTab,
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { AgentTask, AgentTaskKind } from "@/core/agent-task"
import { CurrentThread } from "./CurrentThread"
import { TasksPanel } from "./TasksPanel"

type AiWorkbenchProps = {
  tab: WorkbenchTab
  runningTaskCount: number
  selectionText: string
  selectionRects: NormalizedPageRect[]
  interpretation: string
  answerSource?: AnswerSource
  followUps: FollowUpTurn[]
  noteDraft: string
  noteSaving?: boolean
  noteError?: string
  noteInitiallyOpen?: boolean
  lightweight: boolean
  citationChunkIds?: string[]
  phase: ReaderPhase
  evidence: EvidencePreview[]
  agentTrace: AgentTraceStep[]
  interpretationError?: string
  question: string
  interpretationRuntimeHint?: string
  tasks: AgentTask[]
  tasksDisabled?: boolean
  interpretationHistory?: SavedInterpretation[]
  onTabChange: (tab: WorkbenchTab) => void
  onNoteChange: (note: string) => void
  onSaveNote: () => void
  onCopyInterpretation: () => void
  onCitationClick: (chunkId: string) => void
  onQuestionChange: (question: string) => void
  onQuestionSubmit: (question?: string) => void
  onRegenerate: () => void
  onStop: () => void
  onOpenSettings: () => void
  onRunTask: (kind: AgentTaskKind, prompt?: string) => void
  onStopTask: (taskId: string) => void
  onOpenSparkItem?: (item: SavedInterpretation) => void
}

export function AiWorkbench({
  tab,
  runningTaskCount,
  selectionText,
  selectionRects,
  interpretation,
  answerSource = "llm",
  followUps,
  noteDraft,
  noteSaving = false,
  noteError = "",
  noteInitiallyOpen = false,
  lightweight,
  citationChunkIds,
  phase,
  evidence,
  agentTrace,
  interpretationError = "",
  question,
  interpretationRuntimeHint,
  tasks,
  tasksDisabled = false,
  interpretationHistory = [],
  onTabChange,
  onNoteChange,
  onSaveNote,
  onCopyInterpretation,
  onCitationClick,
  onQuestionChange,
  onQuestionSubmit,
  onRegenerate,
  onStop,
  onOpenSettings,
  onRunTask,
  onStopTask,
  onOpenSparkItem = () => undefined,
}: AiWorkbenchProps) {
  return (
    <aside className="flex h-full min-h-0 animate-fade-in flex-col overflow-hidden border-l bg-card/65 p-2 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none">
      <div className="-mx-2 -mt-2 mb-2 shrink-0 border-b bg-card/95 px-2 py-2 backdrop-blur">
        <div className="grid grid-cols-2 rounded-md border bg-background p-0.5">
          <WorkbenchTabButton
            active={tab === "spark"}
            icon={<Sparkles className="h-4 w-4" />}
            label="Spark"
            onClick={() => onTabChange("spark")}
          />
          <WorkbenchTabButton
            active={tab === "tasks"}
            icon={<WandSparkles className="h-4 w-4" />}
            label="任务"
            badge={runningTaskCount}
            onClick={() => onTabChange("tasks")}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "spark" ? (
          <CurrentThread
            selectionText={selectionText}
            selectionRects={selectionRects}
            interpretation={interpretation}
            answerSource={answerSource}
            followUps={followUps}
            noteDraft={noteDraft}
            noteSaving={noteSaving}
            noteError={noteError}
            noteInitiallyOpen={noteInitiallyOpen}
            lightweight={lightweight}
            citationChunkIds={citationChunkIds}
            phase={phase}
            evidence={evidence}
            agentTrace={agentTrace}
            interpretationError={interpretationError}
            interpretationHistory={interpretationHistory}
            question={question}
            runtimeHint={interpretationRuntimeHint}
            onNoteChange={onNoteChange}
            onSaveNote={onSaveNote}
            onCopyInterpretation={onCopyInterpretation}
            onCitationClick={onCitationClick}
            onQuestionChange={onQuestionChange}
            onQuestionSubmit={onQuestionSubmit}
            onRegenerate={onRegenerate}
            onStop={onStop}
            onOpenSettings={onOpenSettings}
            onOpenHistoryItem={onOpenSparkItem}
          />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto pr-1">
            <TasksPanel
              tasks={tasks}
              runningCount={runningTaskCount}
              disabled={tasksDisabled}
              onRunTask={onRunTask}
              onStopTask={onStopTask}
            />
          </div>
        )}
      </div>
    </aside>
  )
}

function WorkbenchTabButton({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  badge?: number
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-8 gap-1.5"
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
      {badge && badge > 0 ? (
        <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </Button>
  )
}
