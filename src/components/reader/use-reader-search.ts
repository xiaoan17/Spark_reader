import { useEffect, useRef, useState } from "react"
import {
  isTauriRuntime,
  listenSearchIndexProgress,
  rebuildSearchIndexAsync,
  searchBook,
  type SearchBookHit,
  type SearchIndexProgressEvent,
  type SearchIndexSummary,
} from "@/core/library-api"
import { embeddingSaveIndexAction } from "@/core/index-rebuild-policy"
import type { LibraryStatus } from "@/stores/reader-store"

type SearchIndexTask = {
  taskId: string
  bookId: string
  successPrefix: string
  failureMessage: string
  notify: boolean
}

type UseReaderSearchDeps = {
  bookId: string
  libraryStatus: LibraryStatus
  pushNotice: (message: string) => void
  refreshStoredBooks: () => Promise<unknown>
}

/**
 * Full-text search state plus search-index lifecycle (debounced backend query,
 * async index rebuild, progress events, embedding-settings rebuild). Extracted
 * from ReaderShell so the shell no longer owns search plumbing.
 */
export function useReaderSearch({ bookId, libraryStatus, pushNotice, refreshStoredBooks }: UseReaderSearchDeps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [backendSearchHits, setBackendSearchHits] = useState<SearchBookHit[]>([])
  const [searchStatus, setSearchStatus] = useState<"idle" | "searching" | "fallback">("idle")
  const searchIndexProgressHandlerRef = useRef<(event: SearchIndexProgressEvent) => void>(() => undefined)
  const searchIndexTaskRef = useRef<SearchIndexTask | null>(null)

  function handleSearchIndexProgress(event: SearchIndexProgressEvent) {
    const activeTask = searchIndexTaskRef.current
    if (!activeTask || event.taskId !== activeTask.taskId) {
      return
    }
    if (event.stage === "completed") {
      if (activeTask.notify && event.summary) {
        pushNotice(searchIndexSuccessMessage(activeTask.successPrefix, event.summary))
      }
      searchIndexTaskRef.current = null
      void refreshStoredBooks()
      return
    }
    if (event.stage === "failed") {
      if (activeTask.notify) {
        pushNotice(activeTask.failureMessage)
      }
      searchIndexTaskRef.current = null
    }
  }
  searchIndexProgressHandlerRef.current = handleSearchIndexProgress

  // Subscribe once to backend search-index progress events.
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    void listenSearchIndexProgress((event) => {
      if (cancelled) return
      searchIndexProgressHandlerRef.current(event)
    }).then((cleanup) => {
      if (cancelled) {
        cleanup?.()
      } else {
        unlisten = cleanup
      }
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Debounced full-text search against the backend for the active indexed book.
  useEffect(() => {
    const query = searchQuery.trim()
    if (!query || !bookId || libraryStatus !== "indexed") {
      setBackendSearchHits([])
      setSearchStatus("idle")
      return
    }

    let cancelled = false
    setSearchStatus("searching")
    setBackendSearchHits([])
    const timer = window.setTimeout(() => {
      if (!isTauriRuntime()) {
        setBackendSearchHits([])
        setSearchStatus("fallback")
        return
      }
      void searchBook(bookId, query, 12)
        .then((hits) => {
          if (!cancelled) {
            setBackendSearchHits(hits)
            setSearchStatus("idle")
          }
        })
        .catch(() => {
          if (!cancelled) {
            setBackendSearchHits([])
            setSearchStatus("fallback")
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bookId, libraryStatus, searchQuery])

  async function rebuildCurrentBookSearchIndex({
    unavailableMessage,
    browserMessage,
    progressMessage,
    successPrefix,
    failureMessage,
    notify,
  }: {
    unavailableMessage: string
    browserMessage: string
    progressMessage: string
    successPrefix: string
    failureMessage: string
    notify: boolean
  }) {
    if (!bookId || libraryStatus !== "indexed") {
      if (notify) pushNotice(unavailableMessage)
      return null
    }
    if (!isTauriRuntime()) {
      if (notify) pushNotice(browserMessage)
      return null
    }

    pushNotice(progressMessage)
    try {
      const taskId = createSearchIndexTaskId()
      searchIndexTaskRef.current = { taskId, bookId, successPrefix, failureMessage, notify }
      const task = await rebuildSearchIndexAsync(bookId, taskId)
      searchIndexTaskRef.current = {
        taskId: task.taskId,
        bookId,
        successPrefix,
        failureMessage,
        notify,
      }
      return task
    } catch {
      if (notify) pushNotice(failureMessage)
      return null
    }
  }

  async function handleEmbeddingSettingsSaved() {
    const action = embeddingSaveIndexAction({
      bookId,
      libraryStatus,
      tauriRuntime: isTauriRuntime(),
    })
    if (action === "refresh-only") {
      pushNotice(
        isTauriRuntime()
          ? "Embedding 设置已保存；打开书籍后会按新配置建索引"
          : "Embedding 设置已保存；浏览器版不建立云端向量索引",
      )
      return
    }
    await rebuildCurrentBookSearchIndex({
      unavailableMessage: "Embedding 设置已保存；当前书籍还没有写入本地文本库",
      browserMessage: "Embedding 设置已保存；浏览器版不建立云端向量索引",
      progressMessage: "Embedding 设置已保存，正在按新配置重建当前书索引",
      successPrefix: "Embedding 设置已保存，当前书索引已重建",
      failureMessage: "Embedding 设置已保存，但当前书索引重建失败",
      notify: true,
    })
  }

  return {
    searchQuery,
    backendSearchHits,
    searchStatus,
    setSearchQuery,
    handleEmbeddingSettingsSaved,
  }
}

function searchIndexSuccessMessage(successPrefix: string, summary: SearchIndexSummary) {
  return summary.vectorCount > 0 && summary.embeddingMatchesConfig
    ? `${successPrefix}：向量索引已就绪`
    : `${successPrefix}：当前使用 FTS 文本检索`
}

function createSearchIndexTaskId() {
  return `search-index-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
