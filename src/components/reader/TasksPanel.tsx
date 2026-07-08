import {
  AlertCircle,
  CheckCircle2,
  Circle,
  FileCheck2,
  FileText,
  Layers3,
  ListTree,
  Loader2,
  Play,
  SearchCheck,
  Square,
  TimerReset,
  WandSparkles,
} from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AnimatedValue } from "@/components/ui/animated-value"
import type { AgentTask, AgentTaskArtifactKind, AgentTaskKind, AgentTaskStep } from "@/core/agent-task"
import { cn } from "@/lib/utils"

type TasksPanelProps = {
  tasks: AgentTask[]
  runningCount: number
  disabled?: boolean
  onRunTask: (kind: AgentTaskKind, prompt?: string) => void
  onStopTask: (taskId: string) => void
}

const presets: Array<{
  kind: AgentTaskKind
  label: string
  description: string
  scope: string
  output: string
  artifact: AgentTaskArtifactKind
}> = [
  {
    kind: "summarize-chapter",
    label: "本章结构",
    description: "抽取论点、支撑、反例",
    scope: "整章",
    output: "章节大纲",
    artifact: "outline",
  },
  {
    kind: "recurring-concepts",
    label: "全书概念",
    description: "合并术语、别名和证据",
    scope: "全书",
    output: "概念报告",
    artifact: "report",
  },
  {
    kind: "highlights-to-deck",
    label: "高亮成册",
    description: "沉淀为知识册候选",
    scope: "高亮",
    output: "知识册",
    artifact: "deck",
  },
  {
    kind: "contradiction-check",
    label: "前文核验",
    description: "回查限制、反例和冲突",
    scope: "前文",
    output: "核验报告",
    artifact: "report",
  },
]

export function TasksPanel({ tasks, runningCount, disabled = false, onRunTask, onStopTask }: TasksPanelProps) {
  const [prompt, setPrompt] = useState("")

  function runFreeform() {
    const trimmed = prompt.trim()
    if (!trimmed) {
      return
    }
    onRunTask("freeform", trimmed)
    setPrompt("")
  }

  return (
    <div className="flex min-h-full flex-col gap-3">
      {/* 诚实标注：真实 agent 引擎桥接尚未完成，任务卡片由本地演示数据驱动。 */}
      <p className="reader-panel-muted rounded-md border border-dashed px-3 py-2 text-xs leading-5">
        功能预览中：当前任务由本地演示数据驱动，尚未接入真实 agent 引擎。
      </p>
      <div className="reader-panel-card space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <WandSparkles className="reader-panel-accent h-4 w-4" />
              工作规划
            </div>
            <p className="reader-panel-muted mt-1 text-xs leading-5">
              用来处理跨段、整章、整书的长任务；当前选文的即时追问留在「当前」区。
            </p>
          </div>
          <Badge
            variant={runningCount > 0 ? "default" : "secondary"}
            className={cn("gap-1", runningCount > 0 && "reader-workbench-badge")}
          >
            {runningCount > 0 ? (
              <>
                运行中
                <AnimatedValue value={runningCount} variant="number" animation="snappy" />
              </>
            ) : (
              "空闲"
            )}
          </Badge>
        </div>
        <div className="grid gap-2">
          {presets.map((preset) => (
            <PresetTaskButton
              key={preset.kind}
              preset={preset}
              disabled={disabled}
              onRunTask={onRunTask}
            />
          ))}
        </div>
      </div>

      <div className="reader-panel-card space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <SearchCheck className="reader-panel-muted h-4 w-4" />
          自定义任务
        </div>
        <p className="reader-panel-muted text-xs leading-5">
          适合一次性问题，比如回查某个观点、整理某组高亮、比较两个章节。
        </p>
        <div className="flex gap-2">
          <textarea
            className="reader-panel-input min-h-20 flex-1 resize-none rounded-md border px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            placeholder="检查这个观点在前文是否被限定…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Button
            size="icon"
            aria-label="运行自定义任务"
            disabled={disabled || !prompt.trim()}
            onClick={runFreeform}
          >
            <Play className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {tasks.length > 0 ? (
          <>
            <div className="reader-panel-muted flex items-center justify-between px-1 text-xs">
              <span>执行队列</span>
              <span>
                <AnimatedValue value={tasks.length} variant="number" animation="snappy" /> 个任务
              </span>
            </div>
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onStopTask={onStopTask} />
            ))}
          </>
        ) : (
          <div className="reader-panel-card reader-panel-muted flex min-h-52 flex-col items-center justify-center rounded-md border p-6 text-center text-sm">
            <TimerReset className="mb-3 h-8 w-8" />
            <div className="reader-panel-text font-medium">暂无后台任务</div>
            <p className="mt-2 max-w-56 leading-6">
              运行任务后，这里会显示计划、进度、证据和沉淀到知识体系的产物。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function PresetTaskButton({
  preset,
  disabled,
  onRunTask,
}: {
  preset: (typeof presets)[number]
  disabled: boolean
  onRunTask: (kind: AgentTaskKind, prompt?: string) => void
}) {
  return (
    <button
      type="button"
      className="reader-panel-card reader-panel-row h-auto w-full justify-start rounded-md border px-3 py-2 text-left transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={() => onRunTask(preset.kind)}
      title={preset.description}
    >
      <span className="flex w-full items-start gap-2">
        <span className="reader-panel-subtle mt-0.5 rounded-md p-1.5">
          <PresetIcon artifact={preset.artifact} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">{preset.label}</span>
            <span className="reader-panel-border reader-panel-muted inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-normal">
              {preset.scope}
            </span>
          </span>
          <span className="reader-panel-muted mt-1 block text-xs font-normal leading-5">
            {preset.description}
          </span>
          <span className="reader-panel-muted mt-1 inline-flex items-center gap-1 text-[11px] font-normal">
            <FileCheck2 className="h-3 w-3" />
            {preset.output}
          </span>
        </span>
      </span>
    </button>
  )
}

function TaskCard({ task, onStopTask }: { task: AgentTask; onStopTask: (taskId: string) => void }) {
  const running = task.status === "queued" || task.status === "running"
  const completedSteps = task.steps.filter((step) => step.status === "done").length
  return (
    <article className="reader-panel-card rounded-md border p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{task.title}</div>
          <div className="reader-panel-muted mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span>{taskStatusLabel(task.status)}</span>
            {task.steps.length ? (
              <span>
                <AnimatedValue value={completedSteps} variant="number" animation="snappy" />/{task.steps.length} 步
              </span>
            ) : null}
          </div>
        </div>
        {running ? (
          <Button
            size="icon"
            variant="ghost"
            className="reader-chrome-icon-button h-8 w-8"
            aria-label="停止任务"
            title="停止任务"
            onClick={() => onStopTask(task.id)}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <TaskStatusIcon status={task.status} />
        )}
      </div>
      <div className="reader-panel-border mt-3 space-y-2 border-l pl-3">
        {task.steps.map((step) => (
          <TaskStepRow key={step.id} step={step} />
        ))}
      </div>
      {task.errorMessage ? (
        <div className="mt-3 flex gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-5 text-danger-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{task.errorMessage}</span>
        </div>
      ) : null}
      {task.artifacts?.length ? (
        <div className="reader-panel-card mt-3 rounded-md border px-3 py-2 text-xs leading-5">
          <span className="font-medium">已沉淀</span>
          {task.artifacts.map((artifact) => (
            <span
              key={`${artifact.kind}-${artifact.cardIds?.join("-")}`}
              className="ml-2 inline-flex items-center gap-1"
            >
              <PresetIcon artifact={artifact.kind} />
              {artifactLabel(artifact.kind)}
              {artifact.cardIds?.length ? (
                <>
                  {" · "}
                  <AnimatedValue value={artifact.cardIds.length} variant="number" animation="snappy" /> 条线索
                </>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function TaskStepRow({ step }: { step: AgentTaskStep }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <TaskStepIcon status={step.status} />
      <span className="min-w-0 flex-1">
        <span className={cn(step.status === "done" ? "reader-panel-muted" : "reader-panel-text")}>
          {step.label}
        </span>
        {step.evidence?.length ? (
          <span className="reader-panel-muted mt-1 block text-xs">
            命中 <AnimatedValue value={step.evidence.length} variant="number" animation="snappy" /> 条证据
          </span>
        ) : null}
      </span>
    </div>
  )
}

function TaskStatusIcon({ status }: { status: AgentTask["status"] }) {
  if (status === "done") {
    return <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-success" />
  }
  if (status === "error" || status === "stopped") {
    return <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-warning" />
  }
  return <Loader2 className="reader-panel-accent mt-1 h-4 w-4 shrink-0 animate-spin" />
}

function PresetIcon({ artifact }: { artifact: AgentTaskArtifactKind }) {
  switch (artifact) {
    case "deck":
      return <Layers3 className="h-4 w-4" />
    case "outline":
      return <ListTree className="h-4 w-4" />
    case "report":
      return <FileText className="h-4 w-4" />
  }
}

function TaskStepIcon({ status }: { status: AgentTaskStep["status"] }) {
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
  }
  if (status === "running") {
    return <Loader2 className="reader-panel-accent h-4 w-4 shrink-0 animate-spin" />
  }
  if (status === "error") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
  }
  return <Circle className="reader-panel-muted h-4 w-4 shrink-0" />
}

function taskStatusLabel(status: AgentTask["status"]) {
  switch (status) {
    case "queued":
      return "排队中"
    case "running":
      return "运行中"
    case "done":
      return "已完成"
    case "error":
      return "失败"
    case "stopped":
      return "已停止"
  }
}

function artifactLabel(kind: NonNullable<AgentTask["artifacts"]>[number]["kind"]) {
  switch (kind) {
    case "deck":
      return "知识册候选"
    case "outline":
      return "章节大纲"
    case "report":
      return "任务报告"
  }
}
