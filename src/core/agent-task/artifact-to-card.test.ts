import { describe, expect, it } from "vitest"
import { TASK_ARTIFACT_CARD_TYPES, agentTaskToKnowledgeCardRequests } from "./artifact-to-card"
import type { AgentTask } from "./types"

describe("agentTaskToKnowledgeCardRequests", () => {
  it("maps each artifact kind to a candidate knowledge card request", () => {
    const requests = agentTaskToKnowledgeCardRequests(
      task({
        artifacts: [
          { kind: "deck", cardIds: ["mock-card-id"] },
          { kind: "outline" },
          { kind: "report" },
        ],
      }),
      "book-1",
    )

    expect(requests.map((request) => request.cardType)).toEqual([
      "knowledge_deck",
      "chapter_outline",
      "agent_report",
    ])
    expect(requests.map((request) => request.status)).toEqual([
      "candidate",
      "candidate",
      "candidate",
    ])
    expect(requests[0]?.title).toBe("整理本章论证结构 · 知识册 #1")
    expect(requests[1]?.bodyMarkdown).toContain("### 执行步骤")
  })

  it("keeps task artifact card types explicit for backend validation", () => {
    expect(TASK_ARTIFACT_CARD_TYPES).toEqual([
      "knowledge_deck",
      "chapter_outline",
      "agent_report",
    ])
  })

  it("deduplicates evidence chunk ids from task steps and ignores artifact card ids", () => {
    const requests = agentTaskToKnowledgeCardRequests(
      task({
        steps: [
          {
            id: "step-1",
            label: "抽取论点",
            status: "done",
            evidence: [
              { chunkId: "chunk-a", title: "第 1 页", pageIndex: 0 },
              { chunkId: "chunk-b", title: "第 2 页", pageIndex: 1 },
            ],
          },
          {
            id: "step-2",
            label: "寻找支撑",
            status: "done",
            evidence: [
              { chunkId: "chunk-a", title: "第 1 页", pageIndex: 0 },
              { chunkId: " ", title: "空", pageIndex: 0 },
            ],
          },
        ],
        artifacts: [{ kind: "report", cardIds: ["mock-card-id"] }],
      }),
      "book-1",
    )

    expect(requests[0]?.evidenceChunkIds).toEqual(["chunk-a", "chunk-b"])
    expect(requests[0]?.evidenceChunkIds).not.toContain("mock-card-id")
  })

  it("returns no requests when a task has no artifacts", () => {
    expect(agentTaskToKnowledgeCardRequests(task({ artifacts: undefined }), "book-1")).toEqual([])
    expect(agentTaskToKnowledgeCardRequests(task({ artifacts: [] }), "book-1")).toEqual([])
  })
})

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    kind: "summarize-chapter",
    title: "整理本章论证结构",
    status: "done",
    startedAt: "2026-06-08T00:00:00Z",
    steps: [
      { id: "step-1", label: "抽取论点", status: "done" },
      { id: "step-2", label: "寻找支撑", status: "done" },
    ],
    artifacts: [{ kind: "outline" }],
    ...overrides,
  }
}
