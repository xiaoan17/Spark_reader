/**
 * OpenCode agent-task runner. Endpoint paths and event schema verified against
 * opencode-ai@1.15.13 (POST /session, POST /session/{id}/message, POST
 * /session/{id}/abort, GET /event SSE; events are {type, properties} unions).
 * `createAgentTaskRunner` returns the real runner only when given a ready host
 * URL; otherwise the Mock runner stays the default.
 */
import type {
  AgentTask,
  AgentTaskKind,
  AgentTaskRunContext,
  AgentTaskRunner,
  AgentTaskStep,
  AgentTaskStepStatus,
} from "./types"
import { MockAgentTaskRunner } from "./mock-runner"

export const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:48172"
export const SESSION_CREATE_PATH = "/session"
// Real SDK route: prompts are sent as a message with a parts array.
export const SESSION_PROMPT_PATH = "/session/:id/message"
export const SESSION_ABORT_PATH = "/session/:id/abort"
export const EVENT_SUBSCRIBE_PATH = "/event"
export const OPENCODE_AGENT_NAME = "deep_reader"

type OpencodeAgentTaskRunnerOptions = {
  baseUrl?: string
}

export type OpencodeEvent = Record<string, unknown>

export class OpencodeAgentTaskRunner implements AgentTaskRunner {
  private baseUrl: string
  private tasks = new Map<string, AgentTask>()
  private streamAborters = new Map<string, AbortController>()

  constructor(options: OpencodeAgentTaskRunnerOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_OPENCODE_BASE_URL
  }

  async run(kind: AgentTaskKind, ctx: AgentTaskRunContext) {
    const session = await postJson<unknown>(this.url(SESSION_CREATE_PATH), {})
    const taskId = opencodeSessionId(session)
    const task = initialTask(taskId, kind, ctx)
    this.tasks.set(taskId, task)
    // Real SDK message shape: { agent, parts: [{ type: "text", text }] }.
    await postJson(this.url(sessionPath(SESSION_PROMPT_PATH, taskId)), {
      agent: OPENCODE_AGENT_NAME,
      parts: [{ type: "text", text: promptForTask(kind, ctx) }],
    })
    return taskId
  }

  subscribe(taskId: string, onStep: (task: AgentTask) => void) {
    const controller = new AbortController()
    this.streamAborters.set(taskId, controller)
    const existing = this.tasks.get(taskId)
    if (existing) {
      onStep(cloneTask(existing))
    }
    void this.consumeEvents(taskId, onStep, controller)
    return () => {
      controller.abort()
      this.streamAborters.delete(taskId)
    }
  }

  stop(taskId: string) {
    this.streamAborters.get(taskId)?.abort()
    this.streamAborters.delete(taskId)
    void postJson(this.url(sessionPath(SESSION_ABORT_PATH, taskId)), {}).catch(() => undefined)
    const task = this.tasks.get(taskId)
    if (task) {
      this.tasks.set(taskId, {
        ...task,
        status: "stopped",
        steps: task.steps.map((step) => (step.status === "done" ? step : { ...step, status: "error" })),
      })
    }
  }

  private async consumeEvents(taskId: string, onStep: (task: AgentTask) => void, controller: AbortController) {
    const response = await fetch(this.url(EVENT_SUBSCRIBE_PATH), {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    })
    if (!response.body) {
      throw new Error("OpenCode event stream did not return a readable body")
    }
    await readSse(response.body, (event) => {
      const current = this.tasks.get(taskId)
      if (!current) {
        return
      }
      const next = translateOpencodeEventToAgentTask(current, event)
      this.tasks.set(taskId, next)
      onStep(cloneTask(next))
    })
  }

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`
  }
}

/**
 * Choose the agent-task runner. Returns the real OpenCode runner only when a
 * ready host URL is provided (the Tauri sidecar is up); otherwise falls back to
 * the Mock runner so the workbench keeps working with no sidecar.
 */
export function createAgentTaskRunner(options?: {
  hostUrl?: string | null
  ready?: boolean
}): AgentTaskRunner {
  const hostUrl = options?.hostUrl?.trim()
  if (options?.ready && hostUrl) {
    return new OpencodeAgentTaskRunner({ baseUrl: hostUrl })
  }
  return new MockAgentTaskRunner()
}

export function translateOpencodeEventToAgentTask(task: AgentTask, event: OpencodeEvent): AgentTask {
  // Real opencode-ai@1.15.13 events are a { type, properties } discriminated
  // union. We also tolerate the older flat shape for resilience.
  const type = stringValue(event, ["type", "event", "name"]).toLowerCase()
  const properties = (event.properties && typeof event.properties === "object"
    ? (event.properties as Record<string, unknown>)
    : undefined)

  // Session scoping: real events carry properties.sessionID.
  const sessionId =
    stringValue(event, ["sessionId", "sessionID", "session_id"], ["session", "id"]) ||
    (properties ? stringValue(properties, ["sessionID", "sessionId", "session_id"]) : "")
  if (sessionId && sessionId !== task.id) {
    return task
  }

  // Terminal / error via real session.* events.
  if (type === "session.error") {
    const label = eventLabel(event) || "OpenCode 任务失败"
    return withStep(
      task,
      { id: eventStepId(event, "error"), label, status: "error" },
      "error",
    )
  }
  if (type === "session.idle") {
    const steps = task.steps.length
      ? task.steps
      : [{ id: `${task.id}-done`, label: "整理任务结果", status: "done" as AgentTaskStepStatus }]
    return {
      ...task,
      status: "done",
      steps: steps.map((step) => ({ ...step, status: step.status === "error" ? "error" : "done" })),
      artifacts: task.artifacts ?? [{ kind: "report" }],
    }
  }

  // Part updates carry the actual work (text deltas + tool calls).
  if (type === "message.part.updated" && properties) {
    const part = (properties.part && typeof properties.part === "object"
      ? (properties.part as Record<string, unknown>)
      : undefined)
    const partType = part ? stringValue(part, ["type"]).toLowerCase() : ""
    if (partType === "tool") {
      const tool = part ? stringValue(part, ["tool"]) : ""
      const state = part && typeof part.state === "object" ? (part.state as Record<string, unknown>) : undefined
      const status = state ? stringValue(state, ["status"]).toLowerCase() : ""
      const step: AgentTaskStep = {
        id: eventStepId(event, "tool") || `tool:${tool}`,
        label: tool ? `调用工具：${tool}` : "调用工具",
        status: status === "completed" ? "done" : status === "error" ? "error" : "running",
      }
      return withStep(task, step, "running")
    }
    if (partType === "text") {
      const text = part ? stringValue(part, ["text"]) : ""
      const delta = stringValue(properties, ["delta"])
      const label = (delta || text || "OpenCode 更新").slice(0, 60)
      return withStep(
        task,
        { id: eventStepId(event, "message"), label, status: "running" },
        "running",
      )
    }
    return task
  }

  // Legacy flat-shape fallback (kept for resilience against older servers).
  return translateLegacyFlatEvent(task, event, type)
}

function translateLegacyFlatEvent(task: AgentTask, event: OpencodeEvent, type: string): AgentTask {
  const status = stringValue(event, ["status", "state"]).toLowerCase()
  const label = eventLabel(event)
  if (isErrorEvent(type, status)) {
    return withStep(task, {
      id: eventStepId(event, "error"),
      label: label || "OpenCode 任务失败",
      status: "error",
    }, "error")
  }
  if (isTerminalEvent(type, status)) {
    const steps = task.steps.length ? task.steps : [{ id: `${task.id}-done`, label: "整理任务结果", status: "done" as AgentTaskStepStatus }]
    return {
      ...task,
      status: "done",
      steps: steps.map((step) => ({ ...step, status: step.status === "error" ? "error" : "done" })),
      artifacts: task.artifacts ?? [{ kind: "report" }],
    }
  }
  if (!label && !type) {
    return task
  }
  const step: AgentTaskStep = {
    id: eventStepId(event, type.includes("tool") ? "tool" : "message"),
    label: stepLabel(type, label),
    status: stepStatus(type, status),
  }
  return withStep(task, step, "running")
}

function promptForTask(kind: AgentTaskKind, ctx: AgentTaskRunContext) {
  if (kind === "freeform") {
    return ctx.prompt?.trim() || "请围绕当前书籍执行一个阅读整理任务，并给出可回跳证据。"
  }
  const prompts: Record<Exclude<AgentTaskKind, "freeform">, string> = {
    "summarize-chapter": "请整理本章论证结构：抽取论点、支撑证据、反例和层级大纲。",
    "recurring-concepts": "请找出全书反复出现的概念，合并同义表达，并列出关键证据。",
    "highlights-to-deck": "请把全书高亮整理成知识册候选卡片，保留每张卡的原文依据。",
    "contradiction-check": "请检查当前观点在前文是否存在矛盾或限定条件，并形成报告。",
  }
  return prompts[kind]
}

function initialTask(id: string, kind: AgentTaskKind, ctx: AgentTaskRunContext): AgentTask {
  return {
    id,
    kind,
    title: kind === "freeform" && ctx.prompt?.trim() ? ctx.prompt.trim() : taskKindLabel(kind),
    status: "running",
    startedAt: new Date().toISOString(),
    steps: [{ id: `${id}-start`, label: "等待 OpenCode 响应", status: "running" }],
  }
}

function withStep(task: AgentTask, step: AgentTaskStep, status: AgentTask["status"]) {
  const exists = task.steps.some((candidate) => candidate.id === step.id)
  return {
    ...task,
    status,
    steps: exists
      ? task.steps.map((candidate) => (candidate.id === step.id ? { ...candidate, ...step } : candidate))
      : [...task.steps, step],
  }
}

function stepStatus(type: string, status: string): AgentTaskStepStatus {
  if (isErrorEvent(type, status)) return "error"
  if (type.includes("done") || type.includes("complete") || status === "done" || status === "completed") return "done"
  if (type.includes("plan") || status === "planning") return "planning"
  return "running"
}

function isTerminalEvent(type: string, status: string) {
  return (
    type.includes("session.completed") ||
    type.includes("session.done") ||
    type.includes("task.done") ||
    type.includes("task.completed") ||
    status === "completed"
  )
}

function isErrorEvent(type: string, status: string) {
  return type.includes("error") || status === "error" || status === "failed"
}

function stepLabel(type: string, label: string) {
  if (type.includes("tool") && label) return `调用工具：${label}`
  return label || "OpenCode 更新"
}

function eventLabel(event: OpencodeEvent) {
  return (
    stringValue(event, ["message", "text", "content", "title", "name"]) ||
    stringValue(event, [], ["tool", "name"]) ||
    stringValue(event, ["part", "text"]) ||
    stringValue(event, ["data", "message"])
  )
}

function eventStepId(event: OpencodeEvent, prefix: string) {
  return stringValue(event, ["id", "messageId", "toolCallId"]) || `${prefix}:${eventLabel(event) || "update"}`
}

function stringValue(event: OpencodeEvent, keys: string[], nestedKeys?: [string, string]) {
  for (const key of keys) {
    const value = event[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  if (nestedKeys) {
    const parent = event[nestedKeys[0]]
    if (typeof parent === "object" && parent !== null) {
      const value = (parent as Record<string, unknown>)[nestedKeys[1]]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return ""
}

function opencodeSessionId(response: unknown) {
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>
    const direct = record.id
    if (typeof direct === "string" && direct.trim()) return direct.trim()
    const session = record.session
    if (typeof session === "object" && session !== null) {
      const nested = (session as Record<string, unknown>).id
      if (typeof nested === "string" && nested.trim()) return nested.trim()
    }
  }
  throw new Error("OpenCode session.create response did not include a session id")
}

function sessionPath(path: string, id: string) {
  return path.replace(":id", encodeURIComponent(id))
}

async function postJson<T = unknown>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`OpenCode request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function readSse(stream: ReadableStream<Uint8Array>, onEvent: (event: OpencodeEvent) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\n\n+/)
    buffer = blocks.pop() ?? ""
    for (const block of blocks) {
      const data = block
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
      if (!data || data === "[DONE]") continue
      onEvent(JSON.parse(data) as OpencodeEvent)
    }
  }
}

function cloneTask(task: AgentTask): AgentTask {
  return {
    ...task,
    steps: task.steps.map((step) => ({ ...step, evidence: step.evidence ? [...step.evidence] : undefined })),
    artifacts: task.artifacts?.map((artifact) => ({ ...artifact, cardIds: artifact.cardIds ? [...artifact.cardIds] : undefined })),
  }
}

function taskKindLabel(kind: AgentTaskKind) {
  switch (kind) {
    case "summarize-chapter":
      return "整理本章论证结构"
    case "recurring-concepts":
      return "找全书反复概念"
    case "highlights-to-deck":
      return "全书高亮生成知识册"
    case "contradiction-check":
      return "检查前文矛盾"
    case "freeform":
      return "自由任务"
  }
}
