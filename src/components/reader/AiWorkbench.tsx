import { Highlighter, Sparkles, WandSparkles } from "lucide-react"
import type React from "react"
import { AnimatedValue } from "@/components/ui/animated-value"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  AgentTraceStep,
  AnswerSource,
  EvidencePreview,
  FollowUpTurn,
  KnowledgeCard,
  ReaderPhase,
  SavedHighlight,
  SavedInterpretation,
  WorkbenchTab,
} from "@/stores/reader-store"
import type { NormalizedPageRect } from "@/core/coordinates"
import type { AgentTask, AgentTaskKind } from "@/core/agent-task"
import { CurrentThread } from "./CurrentThread"
import { HighlightsList } from "./HighlightsList"
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
  highlights?: SavedHighlight[]
  knowledgeCards?: KnowledgeCard[]
  desktopAvailable?: boolean
  onOpenHighlight?: (highlight: SavedHighlight) => void
  onGenerateHighlightNote?: (cardId: string) => Promise<KnowledgeCard | null>
  onNotice?: (message: string) => void
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
  onExportSparkToObsidian?: () => void
  sparkObsidianExporting?: boolean
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
  highlights = [],
  knowledgeCards = [],
  desktopAvailable = true,
  onOpenHighlight = () => undefined,
  onGenerateHighlightNote,
  onNotice = () => undefined,
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
  onExportSparkToObsidian,
  sparkObsidianExporting = false,
  onRunTask,
  onStopTask,
  onOpenSparkItem = () => undefined,
}: AiWorkbenchProps) {
  return (
    <aside className="reader-panel flex h-full min-h-0 animate-fade-in flex-col overflow-hidden border-l transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none">
      {/* Tab bar：底线模式，无 box 嵌套 */}
      <div className="reader-panel-border -mb-px flex h-9 shrink-0 items-end gap-0 border-b px-3">
        <WorkbenchTabButton
          active={tab === "spark"}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Spark"
          onClick={() => onTabChange("spark")}
        />
        <WorkbenchTabButton
          active={tab === "highlights"}
          icon={<Highlighter className="h-3.5 w-3.5" />}
          label="高亮"
          badge={highlights.length}
          onClick={() => onTabChange("highlights")}
        />
        <WorkbenchTabButton
          active={tab === "tasks"}
          icon={<WandSparkles className="h-3.5 w-3.5" />}
          label="任务"
          badge={runningTaskCount}
          onClick={() => onTabChange("tasks")}
        />
        {/* 诚实标注：任务面板尚未接入真实 agent 引擎，当前由本地演示数据驱动。 */}
        <Badge
          variant="secondary"
          className="mb-1.5 ml-1.5 h-[18px] px-1.5 text-[10px] font-normal"
          title="功能预览中，任务尚未接入真实 agent 引擎"
        >
          预览
        </Badge>
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
            onExportToObsidian={onExportSparkToObsidian}
            obsidianExporting={sparkObsidianExporting}
            onOpenHistoryItem={onOpenSparkItem}
          />
        ) : tab === "highlights" ? (
          <HighlightsList
            highlights={highlights}
            knowledgeCards={knowledgeCards}
            desktopAvailable={desktopAvailable}
            onOpenHighlight={onOpenHighlight}
            onGenerateNote={onGenerateHighlightNote}
            onNotice={onNotice}
          />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
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
    <button
      type="button"
      className={cn(
        "reader-workbench-tab relative flex h-9 w-9 items-center justify-center border-b-2 text-sm transition-colors duration-100",
        active && "reader-workbench-tab-active font-medium",
      )}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span className="sr-only">{label}</span>
      {badge && badge > 0 ? (
        <span className="reader-workbench-badge absolute right-0.5 top-0.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4">
          <AnimatedValue value={badge} variant="number" animation="snappy" />
        </span>
      ) : null}
    </button>
  )
}
