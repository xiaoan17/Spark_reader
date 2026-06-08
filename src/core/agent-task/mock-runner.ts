import type {
  AgentTask,
  AgentTaskKind,
  AgentTaskRunContext,
  AgentTaskRunner,
  AgentTaskStep,
} from "./types"

const taskKindLabels: Record<AgentTaskKind, string> = {
  "summarize-chapter": "整理本章论证结构",
  "recurring-concepts": "找全书反复概念",
  "highlights-to-deck": "全书高亮生成知识册",
  "contradiction-check": "检查前文矛盾",
  freeform: "自由任务",
}

const taskStepLabels: Record<AgentTaskKind, string[]> = {
  "summarize-chapter": ["抽取本章论点", "寻找支撑证据", "整理层级大纲"],
  "recurring-concepts": ["扫描章节标题", "聚合同义概念", "生成概念清单"],
  "highlights-to-deck": ["读取高亮", "归并主题", "生成知识册产物"],
  "contradiction-check": ["定位当前观点", "回查前文表述", "形成矛盾报告"],
  freeform: ["理解指令", "规划检索路径", "整理任务结果"],
}

type TaskRecord = {
  task: AgentTask
  subscribers: Set<(task: AgentTask) => void>
  timers: number[]
}

export class MockAgentTaskRunner implements AgentTaskRunner {
  private tasks = new Map<string, TaskRecord>()

  async run(kind: AgentTaskKind, ctx: AgentTaskRunContext) {
    const taskId = `agent-task-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const task: AgentTask = {
      id: taskId,
      kind,
      title: taskTitle(kind, ctx),
      status: "queued",
      steps: taskStepLabels[kind].map((label, index): AgentTaskStep => ({
        id: `${taskId}-step-${index}`,
        label,
        status: "planning",
      })),
      startedAt: new Date().toISOString(),
    }
    const record: TaskRecord = {
      task,
      subscribers: new Set(),
      timers: [],
    }
    this.tasks.set(taskId, record)
    this.advanceTask(record)
    return taskId
  }

  subscribe(taskId: string, onStep: (task: AgentTask) => void) {
    const record = this.tasks.get(taskId)
    if (!record) {
      return () => undefined
    }
    record.subscribers.add(onStep)
    onStep(cloneTask(record.task))
    return () => {
      record.subscribers.delete(onStep)
    }
  }

  stop(taskId: string) {
    const record = this.tasks.get(taskId)
    if (!record || record.task.status === "done" || record.task.status === "stopped") {
      return
    }
    for (const timer of record.timers) {
      window.clearTimeout(timer)
    }
    record.timers = []
    record.task = {
      ...record.task,
      status: "stopped",
      steps: record.task.steps.map((step) =>
        step.status === "done" ? step : { ...step, status: "error" },
      ),
    }
    this.publish(record)
  }

  private advanceTask(record: TaskRecord) {
    record.task = {
      ...record.task,
      status: "running",
      steps: record.task.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? "running" : "planning",
      })),
    }
    this.publish(record)

    record.task.steps.forEach((step, index) => {
      const timer = window.setTimeout(() => {
        if (record.task.status === "stopped") {
          return
        }
        const isLast = index === record.task.steps.length - 1
        record.task = {
          ...record.task,
          status: isLast ? "done" : "running",
          steps: record.task.steps.map((candidate, candidateIndex) => {
            if (candidate.id === step.id) {
              return { ...candidate, status: "done" }
            }
            if (candidateIndex === index + 1) {
              return { ...candidate, status: "running" }
            }
            return candidate
          }),
          artifacts: isLast ? artifactsForTask(record.task.kind, record.task.id) : record.task.artifacts,
        }
        this.publish(record)
      }, 600 + index * 700)
      record.timers.push(timer)
    })
  }

  private publish(record: TaskRecord) {
    const snapshot = cloneTask(record.task)
    for (const subscriber of record.subscribers) {
      subscriber(snapshot)
    }
  }
}

function taskTitle(kind: AgentTaskKind, ctx: AgentTaskRunContext) {
  if (kind === "freeform" && ctx.prompt?.trim()) {
    return ctx.prompt.trim()
  }
  return taskKindLabels[kind]
}

function artifactsForTask(kind: AgentTaskKind, taskId: string) {
  const cardIds = [`kb-${taskId}-1`, `kb-${taskId}-2`]
  switch (kind) {
    case "summarize-chapter":
      return [{ kind: "outline" as const, cardIds }]
    case "highlights-to-deck":
      return [{ kind: "deck" as const, cardIds }]
    default:
      return [{ kind: "report" as const, cardIds }]
  }
}

function cloneTask(task: AgentTask): AgentTask {
  return {
    ...task,
    steps: task.steps.map((step) => ({ ...step, evidence: step.evidence ? [...step.evidence] : undefined })),
    artifacts: task.artifacts?.map((artifact) => ({
      ...artifact,
      cardIds: artifact.cardIds ? [...artifact.cardIds] : undefined,
    })),
  }
}
