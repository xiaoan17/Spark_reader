import { describe, expect, it } from "vitest"
import { translateOpencodeEventToAgentTask } from "./opencode-runner"
import type { AgentTask } from "./types"

describe("translateOpencodeEventToAgentTask", () => {
  it("adds message events as running steps", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      sessionId: "session-1",
      type: "message.delta",
      id: "message-1",
      message: "正在读取本章",
    })

    expect(next.status).toBe("running")
    expect(next.steps.at(-1)).toMatchObject({
      id: "message-1",
      label: "正在读取本章",
      status: "running",
    })
  })

  it("maps tool completion events to done tool steps", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      sessionId: "session-1",
      type: "tool.done",
      tool: { name: "read_book_chunk" },
    })

    expect(next.steps.at(-1)).toMatchObject({
      label: "调用工具：read_book_chunk",
      status: "done",
    })
  })

  it("marks terminal events as done and adds a report artifact", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      sessionId: "session-1",
      type: "session.completed",
    })

    expect(next.status).toBe("done")
    expect(next.steps.every((step) => step.status === "done")).toBe(true)
    expect(next.artifacts).toEqual([{ kind: "report" }])
  })

  it("ignores events for other sessions", () => {
    const original = task()
    const next = translateOpencodeEventToAgentTask(original, {
      sessionId: "other-session",
      type: "message.delta",
      message: "不应进入任务",
    })

    expect(next).toBe(original)
  })

  it("marks error events as failed", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      sessionId: "session-1",
      type: "session.error",
      message: "OpenCode 失败",
    })

    expect(next.status).toBe("error")
    expect(next.steps.at(-1)).toMatchObject({
      label: "OpenCode 失败",
      status: "error",
    })
  })

  it("handles the real message.part.updated text delta shape", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        part: { type: "text", text: "正在合成回答" },
        delta: "正在",
      },
    })

    expect(next.status).toBe("running")
    expect(next.steps.at(-1)?.status).toBe("running")
  })

  it("handles the real message.part.updated completed tool shape", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        part: {
          type: "tool",
          tool: "book_search",
          state: { status: "completed", output: "[]" },
        },
      },
    })

    expect(next.steps.at(-1)).toMatchObject({
      label: "调用工具：book_search",
      status: "done",
    })
  })

  it("treats session.idle as terminal done", () => {
    const next = translateOpencodeEventToAgentTask(task(), {
      type: "session.idle",
      properties: { sessionID: "session-1" },
    })

    expect(next.status).toBe("done")
    expect(next.artifacts).toEqual([{ kind: "report" }])
  })

  it("ignores real-shape events for other sessions", () => {
    const original = task()
    const next = translateOpencodeEventToAgentTask(original, {
      type: "message.part.updated",
      properties: { sessionID: "other", part: { type: "text", text: "x" } },
    })

    expect(next).toBe(original)
  })
})

function task(): AgentTask {
  return {
    id: "session-1",
    kind: "summarize-chapter",
    title: "整理本章论证结构",
    status: "running",
    startedAt: "2026-06-08T00:00:00Z",
    steps: [{ id: "start", label: "等待 OpenCode 响应", status: "running" }],
  }
}
