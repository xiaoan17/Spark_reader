import type { UpsertKnowledgeCardRequest } from "@/core/library-api"
import type { AgentTask, AgentTaskArtifact, AgentTaskArtifactKind } from "./types"

export const TASK_ARTIFACT_CARD_TYPES = [
  "knowledge_deck",
  "chapter_outline",
  "agent_report",
] as const

const artifactCardTypes: Record<AgentTaskArtifactKind, (typeof TASK_ARTIFACT_CARD_TYPES)[number]> = {
  deck: "knowledge_deck",
  outline: "chapter_outline",
  report: "agent_report",
}

export function agentTaskToKnowledgeCardRequests(
  task: AgentTask,
  bookId: string,
): Omit<UpsertKnowledgeCardRequest, "bookId">[] {
  if (!task.artifacts?.length) {
    return []
  }
  const evidenceChunkIds = evidenceChunkIdsForTask(task)
  return task.artifacts.map((artifact, index) => ({
    cardType: artifactCardTypes[artifact.kind],
    title: artifactTitle(task, artifact, index),
    summary: task.title,
    bodyMarkdown: taskBodyMarkdown(task, artifact),
    payloadJson: JSON.stringify({
      taskId: task.id,
      taskKind: task.kind,
      artifactKind: artifact.kind,
      artifactIndex: index,
    }),
    status: "candidate",
    evidenceChunkIds,
  }))
}

function evidenceChunkIdsForTask(task: AgentTask) {
  const chunkIds = new Set<string>()
  for (const step of task.steps) {
    for (const evidence of step.evidence ?? []) {
      if (evidence.chunkId.trim()) {
        chunkIds.add(evidence.chunkId)
      }
    }
  }
  return [...chunkIds]
}

function artifactTitle(task: AgentTask, artifact: AgentTaskArtifact, index: number) {
  const suffix = task.artifacts && task.artifacts.length > 1 ? ` #${index + 1}` : ""
  return `${task.title} · ${artifactKindLabel(artifact.kind)}${suffix}`
}

function taskBodyMarkdown(task: AgentTask, artifact: AgentTaskArtifact) {
  const stepLines = task.steps.length
    ? task.steps.map((step) => `- ${stepStatusLabel(step.status)} ${step.label}`).join("\n")
    : "- 暂无步骤记录"
  return [
    `## ${artifactKindLabel(artifact.kind)}`,
    "",
    `任务：${task.title}`,
    `状态：${taskStatusLabel(task.status)}`,
    "",
    "### 执行步骤",
    stepLines,
  ].join("\n")
}

function artifactKindLabel(kind: AgentTaskArtifact["kind"]) {
  switch (kind) {
    case "deck":
      return "知识册"
    case "outline":
      return "章节大纲"
    case "report":
      return "任务报告"
  }
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

function stepStatusLabel(status: AgentTask["steps"][number]["status"]) {
  switch (status) {
    case "planning":
      return "计划"
    case "running":
      return "运行"
    case "done":
      return "完成"
    case "error":
      return "失败"
  }
}
