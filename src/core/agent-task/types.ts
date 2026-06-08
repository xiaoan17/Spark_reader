import type { EvidencePreview } from "@/stores/reader-store"

export type AgentTaskKind =
  | "summarize-chapter"
  | "recurring-concepts"
  | "highlights-to-deck"
  | "contradiction-check"
  | "freeform"

export type AgentTaskStepStatus = "planning" | "running" | "done" | "error"

export type AgentTaskStatus = "queued" | "running" | "done" | "error" | "stopped"

export type AgentTaskStep = {
  id: string
  label: string
  status: AgentTaskStepStatus
  evidence?: EvidencePreview[]
}

export type AgentTaskArtifactKind = "deck" | "outline" | "report"

export type AgentTaskArtifact = {
  kind: AgentTaskArtifactKind
  cardIds?: string[]
}

export type AgentTask = {
  id: string
  kind: AgentTaskKind
  title: string
  status: AgentTaskStatus
  steps: AgentTaskStep[]
  startedAt: string
  errorMessage?: string
  artifacts?: AgentTaskArtifact[]
}

export type AgentTaskRunContext = {
  bookId: string
  chapterId?: string
  prompt?: string
}

export interface AgentTaskRunner {
  run(kind: AgentTaskKind, ctx: AgentTaskRunContext): Promise<string>
  subscribe(taskId: string, onStep: (task: AgentTask) => void): () => void
  stop(taskId: string): void
}
