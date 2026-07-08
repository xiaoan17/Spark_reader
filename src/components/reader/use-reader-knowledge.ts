import {
  buildKnowledgeGraph,
  confirmKnowledgeCard,
  deleteKnowledgeCard,
  exportBookKnowledgeJson,
  exportBookKnowledgeMarkdown,
  getBookKnowledgeMap,
  getKnowledgeGraph,
  getKnowledgeHealth,
  isTauriRuntime,
  listKnowledgeCards,
  listKnowledgeDrift,
  normalizeCommandError,
  rejectKnowledgeCard,
  upsertKnowledgeCard,
  type UpsertKnowledgeCardRequest,
} from "@/core/library-api"
import { downloadMarkdownFile, downloadTextFile } from "@/core/download-file"
import { knowledgeExportFilename } from "@/core/knowledge-export"
import { useReaderStore } from "@/stores/reader-store"

/**
 * 单书知识层：卡片 / 图谱 / 健康 / 漂移 / 地图的加载与刷新，构建、导出
 * (Markdown/JSON)，确认/驳回/删除/保存卡片，以及 Agent 任务产物落库。
 * 从 App 编排层抽出；副作用仍走命令式调用，不引入 useEffect。
 */
export function useReaderKnowledge() {
  const {
    bookId,
    bookTitle,
    setKnowledgeCards,
    setKnowledgeGraph,
    setKnowledgeHealth,
    setKnowledgeDrift,
    setKnowledgeMap,
    setKnowledgeLoading,
    setKnowledgeGraphLoading,
    setKnowledgeGraphBuilding,
    setKnowledgeError,
    upsertAgentTask,
  } = useReaderStore()

  async function loadKnowledgeCards(bookIdToLoad: string) {
    if (!isTauriRuntime()) {
      setKnowledgeCards([])
      setKnowledgeGraph(null)
      setKnowledgeHealth(null)
      setKnowledgeDrift([])
      setKnowledgeMap(null)
      return
    }
    setKnowledgeLoading(true)
    try {
      const rows = await listKnowledgeCards(bookIdToLoad)
      setKnowledgeCards(rows)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function loadKnowledgeHealth(bookIdToLoad: string) {
    if (!isTauriRuntime()) {
      setKnowledgeHealth(null)
      setKnowledgeDrift([])
      return
    }
    try {
      const [health, drift] = await Promise.all([
        getKnowledgeHealth(bookIdToLoad),
        listKnowledgeDrift(bookIdToLoad),
      ])
      setKnowledgeHealth(health)
      setKnowledgeDrift(drift)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function loadKnowledgeGraph(bookIdToLoad: string) {
    if (!isTauriRuntime()) {
      setKnowledgeGraph(null)
      setKnowledgeMap(null)
      return
    }
    setKnowledgeGraphLoading(true)
    try {
      const [graph, map] = await Promise.all([
        getKnowledgeGraph(bookIdToLoad),
        getBookKnowledgeMap(bookIdToLoad),
      ])
      setKnowledgeGraph(graph)
      setKnowledgeMap(map)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  function refreshKnowledge(bookIdToLoad: string) {
    void loadKnowledgeCards(bookIdToLoad)
    void loadKnowledgeGraph(bookIdToLoad)
    void loadKnowledgeHealth(bookIdToLoad)
  }

  async function handleBuildKnowledge() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    setKnowledgeGraphBuilding(true)
    try {
      await buildKnowledgeGraph(bookId)
      await Promise.all([loadKnowledgeCards(bookId), loadKnowledgeGraph(bookId), loadKnowledgeHealth(bookId)])
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleExportKnowledgeMarkdown() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      const exportResult = await exportBookKnowledgeMarkdown(bookId)
      downloadMarkdownFile(
        knowledgeExportFilename(bookTitle || "reading-knowledge", "md", new Date()),
        exportResult.markdown,
      )
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleExportKnowledgeJson() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      const exportResult = await exportBookKnowledgeJson(bookId)
      downloadTextFile(
        knowledgeExportFilename(bookTitle || "reading-knowledge", "json", new Date()),
        JSON.stringify(exportResult, null, 2),
        "application/json;charset=utf-8",
      )
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleConfirmKnowledgeCard(cardId: string) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await confirmKnowledgeCard(bookId, cardId)
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleRejectKnowledgeCard(cardId: string) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await rejectKnowledgeCard(bookId, cardId)
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleDeleteKnowledgeCard(cardId: string) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await deleteKnowledgeCard(bookId, cardId)
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function handleSaveKnowledgeCard(request: Omit<UpsertKnowledgeCardRequest, "bookId">) {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    try {
      await upsertKnowledgeCard({
        ...request,
        bookId,
      })
      refreshKnowledge(bookId)
    } catch (error) {
      setKnowledgeError(normalizeCommandError(error).message)
    }
  }

  async function persistAgentTaskCards(
    targetBookId: string,
    taskId: string,
    requests: Omit<UpsertKnowledgeCardRequest, "bookId">[],
  ) {
    if (!targetBookId || !isTauriRuntime()) {
      return
    }
    try {
      for (const request of requests) {
        await upsertKnowledgeCard({ ...request, bookId: targetBookId })
      }
      refreshKnowledge(targetBookId)
    } catch (error) {
      const message = normalizeCommandError(error).message
      const currentTask = useReaderStore.getState().agentTasks.find((task) => task.id === taskId)
      if (currentTask) {
        upsertAgentTask({
          ...currentTask,
          status: "error",
          errorMessage: `任务产物保存失败：${message}`,
        })
      }
    }
  }

  return {
    refreshKnowledge,
    handleBuildKnowledge,
    handleExportKnowledgeMarkdown,
    handleExportKnowledgeJson,
    handleConfirmKnowledgeCard,
    handleRejectKnowledgeCard,
    handleDeleteKnowledgeCard,
    handleSaveKnowledgeCard,
    persistAgentTaskCards,
  }
}

export type ReaderKnowledge = ReturnType<typeof useReaderKnowledge>
