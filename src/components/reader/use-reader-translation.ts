import { useEffect, useState } from "react"
import {
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
 * Whole-book translation: status polling and automatic start. Owns translation state so
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

  // Reset + fetch translation status whenever the active indexed book changes.
  useEffect(() => {
    setTranslation(null)
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
      .catch(() => undefined)
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
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [bookId, readerView])

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
    try {
      const status = await startTranslation(bookId, force)
      setTranslation(status)
      pushNotice(status.running ? "已开始后台翻译整本书" : "翻译缓存已就绪")
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法启动翻译任务"
      pushNotice(message)
    }
  }

  return {
    translation,
    handleStartTranslation,
  }
}
