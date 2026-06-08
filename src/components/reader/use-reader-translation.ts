import { useEffect, useState } from "react"
import {
  cancelTranslation,
  isTauriRuntime,
  startTranslation,
  translationStatus,
  type TranslationStatus,
} from "@/core/library-api"
import type { LibraryStatus } from "@/stores/reader-store"
import type { ReaderView } from "./highlight-target-view"

type SwitchReaderView = (
  nextView: ReaderView,
  options?: { page?: number; restorePage?: boolean },
) => void

type UseReaderTranslationDeps = {
  bookId: string
  libraryStatus: LibraryStatus
  readerView: ReaderView
  canShowConvertedText: boolean
  switchReaderView: SwitchReaderView
  pushNotice: (message: string) => void
}

/**
 * Whole-book translation: status polling, start/cancel. Owns translation state so
 * ReaderShell stays an orchestration shell rather than a state mega-component
 * (coding-style 小文件原则).
 */
export function useReaderTranslation({
  bookId,
  libraryStatus,
  readerView,
  canShowConvertedText,
  switchReaderView,
  pushNotice,
}: UseReaderTranslationDeps) {
  const [translation, setTranslation] = useState<TranslationStatus | null>(null)
  const [translationBusy, setTranslationBusy] = useState(false)
  const [translationMessage, setTranslationMessage] = useState("")

  // Reset + fetch translation status whenever the active indexed book changes.
  useEffect(() => {
    setTranslation(null)
    setTranslationMessage("")
    if (!bookId || libraryStatus !== "indexed" || !isTauriRuntime()) {
      return
    }
    let cancelled = false
    void translationStatus(bookId)
      .then((status) => {
        if (!cancelled) {
          setTranslation(status)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTranslationMessage(error instanceof Error ? error.message : "无法读取翻译状态")
        }
      })
    return () => {
      cancelled = true
    }
  }, [bookId, libraryStatus])

  // Poll translation progress while the translation view is open.
  useEffect(() => {
    if (!bookId || readerView !== "translation" || !isTauriRuntime()) {
      return
    }
    let cancelled = false
    const poll = () => {
      void translationStatus(bookId)
        .then((status) => {
          if (!cancelled) {
            setTranslation(status)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setTranslationMessage(error instanceof Error ? error.message : "无法读取翻译状态")
          }
        })
    }
    poll()
    const timer = window.setInterval(poll, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [bookId, readerView])

  async function refreshTranslation(targetBookId = bookId) {
    if (!targetBookId || !isTauriRuntime()) {
      setTranslation(null)
      return null
    }
    try {
      const status = await translationStatus(targetBookId)
      setTranslation(status)
      return status
    } catch (error) {
      setTranslationMessage(error instanceof Error ? error.message : "无法读取翻译状态")
      return null
    }
  }

  async function handleStartTranslation(force = false) {
    if (!bookId || !canShowConvertedText) {
      pushNotice("当前书籍还没有可翻译的转换稿")
      return
    }
    if (!isTauriRuntime()) {
      pushNotice("整本翻译需要桌面版和 LLM provider")
      return
    }
    switchReaderView("translation", { restorePage: !force })
    setTranslationBusy(true)
    setTranslationMessage(force ? "正在重新提交整本翻译任务" : "正在提交整本翻译任务")
    try {
      const status = await startTranslation(bookId, force)
      setTranslation(status)
      setTranslationMessage(
        status.running
          ? "翻译任务已在后台运行"
          : status.completedPages >= status.totalPages
            ? "整本翻译已完成"
            : "翻译状态已更新",
      )
      pushNotice(status.running ? "已开始后台翻译整本书" : "翻译缓存已就绪")
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法启动翻译任务"
      setTranslationMessage(message)
      pushNotice(message)
    } finally {
      setTranslationBusy(false)
    }
  }

  async function handleCancelTranslation() {
    if (!bookId || !isTauriRuntime()) {
      return
    }
    setTranslationBusy(true)
    try {
      const cancelled = await cancelTranslation(bookId)
      const status = await refreshTranslation(bookId)
      setTranslationMessage(cancelled ? "已请求取消翻译任务" : "当前没有运行中的翻译任务")
      if (status?.running) {
        pushNotice("翻译任务会在当前片段结束后停止")
      }
    } catch (error) {
      setTranslationMessage(error instanceof Error ? error.message : "取消翻译失败")
    } finally {
      setTranslationBusy(false)
    }
  }

  return {
    translation,
    translationBusy,
    translationMessage,
    refreshTranslation,
    handleStartTranslation,
    handleCancelTranslation,
  }
}
