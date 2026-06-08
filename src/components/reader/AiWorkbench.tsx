import { Bot, Loader2, MessageSquareText, WandSparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  AgentTraceStep,
  AnswerSource,
  EvidencePreview,
  FollowUpTurn,
  ReaderPhase,
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
  lightweight: boolean
  citationChunkIds?: string[]
  phase: ReaderPhase
  evidence: EvidencePreview[]
  agentTrace: AgentTraceStep[]
  interpretationError?: string
  askOpen: boolean
  question: string
  interpretationRuntimeHint?: string
  tasks: AgentTask[]
  tasksDisabled?: boolean
  onTabChange: (tab: WorkbenchTab) => void
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
  onRunTask: (kind: AgentTaskKind, prompt?: string) => void
  onStopTask: (taskId: string) => void
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
  lightweight,
  citationChunkIds,
  phase,
  evidence,
  agentTrace,
  interpretationError = "",
  askOpen,
  question,
  interpretationRuntimeHint,
  tasks,
  tasksDisabled = false,
  onTabChange,
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
  onRunTask,
  onStopTask,
}: AiWorkbenchProps) {
  return (
    <aside className="min-h-0 animate-fade-in overflow-y-auto border-l bg-card/65 p-3 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none">
      <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 border-b bg-card/95 px-3 py-3 backdrop-blur">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="h-4 w-4 text-primary" />
              AI 工作台
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              当前区处理选文；任务区跑整章、整书和核验
            </p>
          </div>
          {runningTaskCount > 0 ? (
            <Badge>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              {runningTaskCount}
            </Badge>
          ) : null}
        </div>
        <div className="grid grid-cols-2 rounded-md border bg-background p-1">
          <WorkbenchTabButton
            active={tab === "current"}
            icon={<MessageSquareText className="h-4 w-4" />}
            label="当前"
            onClick={() => onTabChange("current")}
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

      {tab === "current" ? (
        <CurrentThread
          selectionText={selectionText}
          selectionRects={selectionRects}
          interpretation={interpretation}
          answerSource={answerSource}
          followUps={followUps}
          noteDraft={noteDraft}
          noteSaving={noteSaving}
          noteError={noteError}
          lightweight={lightweight}
          citationChunkIds={citationChunkIds}
          phase={phase}
          evidence={evidence}
          agentTrace={agentTrace}
          interpretationError={interpretationError}
          askOpen={askOpen}
          question={question}
          runtimeHint={interpretationRuntimeHint}
          onLightweightChange={onLightweightChange}
          onNoteChange={onNoteChange}
          onSaveNote={onSaveNote}
          onCopyInterpretation={onCopyInterpretation}
          onCitationClick={onCitationClick}
          onAskToggle={onAskToggle}
          onQuestionChange={onQuestionChange}
          onQuestionSubmit={onQuestionSubmit}
          onRegenerate={onRegenerate}
          onStop={onStop}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <TasksPanel
          tasks={tasks}
          runningCount={runningTaskCount}
          disabled={tasksDisabled}
          onRunTask={onRunTask}
          onStopTask={onStopTask}
        />
      )}
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
