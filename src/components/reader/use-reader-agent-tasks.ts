import { useRef } from "react"
import {
  MockAgentTaskRunner,
  agentTaskToKnowledgeCardRequests,
  createAgentTaskRunner,
  type AgentTaskKind,
  type AgentTaskRunner,
} from "@/core/agent-task"
import { getAgentHostUrl, type UpsertKnowledgeCardRequest } from "@/core/library-api"
import { useReaderStore } from "@/stores/reader-store"

type UseReaderAgentTasksDeps = {
  persistAgentTaskCards: (
    targetBookId: string,
    taskId: string,
    requests: Omit<UpsertKnowledgeCardRequest, "bookId">[],
  ) => Promise<void>
}

/**
 * Agent 任务运行器：懒替换 Mock→真实 runner（sidecar 就绪时），订阅任务进度、
 * 终态释放订阅、done 时把产物落库。runner 懒替换刻意不用 useEffect，保持 App
 * 命令式 bootstrap 架构；agentTaskUnsubscribers / persistedAgentTaskIds 用 ref。
 */
export function useReaderAgentTasks({ persistAgentTaskCards }: UseReaderAgentTasksDeps) {
  const agentTaskRunner = useRef<AgentTaskRunner>(new MockAgentTaskRunner())
  const agentRunnerResolved = useRef(false)
  const agentTaskUnsubscribers = useRef(new Map<string, () => void>())
  const persistedAgentTaskIds = useRef(new Set<string>())
  const { bookId, upsertAgentTask, setWorkbenchTab } = useReaderStore()

  async function ensureAgentTaskRunner() {
    // Lazily swap the Mock runner for the real OpenCode runner once, the first
    // time an agent task is started, if the sidecar is up. Keeps the no-useEffect
    // bootstrap architecture intact.
    if (agentRunnerResolved.current) {
      return
    }
    agentRunnerResolved.current = true
    const status = await getAgentHostUrl()
    if (status?.ready && status.hostUrl) {
      agentTaskRunner.current = createAgentTaskRunner({
        hostUrl: status.hostUrl,
        ready: status.ready,
      })
    }
  }

  async function handleRunAgentTask(kind: AgentTaskKind, prompt?: string) {
    if (!bookId) {
      return
    }
    await ensureAgentTaskRunner()
    const taskId = await agentTaskRunner.current.run(kind, { bookId, prompt })
    const unsubscribe = agentTaskRunner.current.subscribe(taskId, (task) => {
      upsertAgentTask(task)
      if (task.status === "done" && !persistedAgentTaskIds.current.has(task.id)) {
        persistedAgentTaskIds.current.add(task.id)
        // Persist artifacts back to the book the task was STARTED for, not the
        // book currently open — the user may have switched books while a long
        // task was running. So bind bookId explicitly here instead of routing
        // through handleSaveKnowledgeCard (which uses the current bookId).
        const requests = agentTaskToKnowledgeCardRequests(task, bookId)
        if (requests.length > 0) {
          void persistAgentTaskCards(bookId, task.id, requests)
        }
      }
      // App.tsx manages side effects explicitly (no useEffect); release the
      // subscription as soon as the task reaches a terminal state so real
      // runners (OpenCode) don't leak listeners.
      if (task.status === "done" || task.status === "stopped" || task.status === "error") {
        agentTaskUnsubscribers.current.get(taskId)?.()
        agentTaskUnsubscribers.current.delete(taskId)
      }
    })
    agentTaskUnsubscribers.current.set(taskId, unsubscribe)
    setWorkbenchTab("tasks")
  }

  function handleStopAgentTask(taskId: string) {
    agentTaskRunner.current.stop(taskId)
  }

  return {
    handleRunAgentTask,
    handleStopAgentTask,
  }
}

export type ReaderAgentTasks = ReturnType<typeof useReaderAgentTasks>
