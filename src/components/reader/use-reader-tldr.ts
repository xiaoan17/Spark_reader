import { useRef } from "react"
import {
  getDocumentTldr,
  getLlmSettings,
  isTauriRuntime,
  regenerateDocumentTldr,
} from "@/core/library-api"
import { llmKeyReadiness } from "@/core/interpretation-runtime"
import { localFallbackNotice } from "@/core/interpretation-fallback-notice"
import { useReaderStore } from "@/stores/reader-store"

/**
 * 整书 TLDR：懒加载/强制重生成，带 LLM key 预检与「同书只请求一次」的守卫。
 * tldrRequestBookId ref 记录在途请求归属，保持 App 的 no-useEffect 命令式约定。
 */
export function useReaderTldr() {
  const tldrRequestBookId = useRef("")
  const {
    bookId,
    setTldr,
    setTldrLoading,
    setTldrError,
    setTldrLlmReady,
  } = useReaderStore()

  async function ensureTldr(bookIdToLoad = bookId, options: { force?: boolean; manual?: boolean } = {}) {
    if (!bookIdToLoad || !isTauriRuntime()) {
      setTldr(null)
      setTldrLoading(false)
      setTldrError("")
      setTldrLlmReady(false)
      return
    }
    if (!options.force && tldrRequestBookId.current === bookIdToLoad) {
      return
    }
    if (!options.force) {
      const cached = useReaderStore.getState().tldr
      if (cached?.text.trim() && useReaderStore.getState().bookId === bookIdToLoad) {
        return
      }
    }
    try {
      const readiness = await llmKeyReadiness(await getLlmSettings(), "解读")
      setTldrLlmReady(readiness.ready)
      if (!readiness.ready) {
        if (options.manual) {
          setTldrError(readiness.message)
        }
        return
      }
    } catch (error) {
      setTldrLlmReady(false)
      if (options.manual) {
        setTldrError(localFallbackNotice(error, "解读"))
      }
      return
    }
    tldrRequestBookId.current = bookIdToLoad
    setTldrLoading(true)
    setTldrError("")
    try {
      const result = options.force
        ? await regenerateDocumentTldr(bookIdToLoad)
        : await getDocumentTldr(bookIdToLoad)
      if (useReaderStore.getState().bookId !== bookIdToLoad) {
        return
      }
      setTldr({
        text: result.text,
        generatedAt: result.generatedAt,
        model: result.model,
        sourceVersion: result.sourceVersion,
      })
    } catch (error) {
      setTldrError(error instanceof Error ? error.message : "TLDR 生成失败")
    } finally {
      setTldrLoading(false)
      tldrRequestBookId.current = ""
    }
  }

  return {
    ensureTldr,
  }
}

export type ReaderTldr = ReturnType<typeof useReaderTldr>
