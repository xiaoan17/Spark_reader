import { useRef } from "react"
import {
  cancelDocumentTldr,
  getDocumentTldr,
  getLlmSettings,
  isTauriRuntime,
  listenDocumentTldrStream,
  regenerateDocumentTldr,
} from "@/core/library-api"
import { llmKeyReadiness } from "@/core/interpretation-runtime"
import { localFallbackNotice } from "@/core/interpretation-fallback-notice"
import { useReaderStore } from "@/stores/reader-store"

/**
 * 整书 TLDR：懒加载/强制重生成，带 LLM key 预检、阶段进度事件监听与取消。
 * 全部副作用走 ref 命令式模式（no-useEffect）：tldrRequestBookId 记录在途请求归属，
 * loadedTldrBookId 记录本会话已让后端裁决过缓存的书（后端才知道引擎标签是否新鲜，
 * 所以不再用 store 里的缓存文本短路，改为每本书至少让后端 get 一次），
 * tldrStreamUnlisten 手动 attach/detach 阶段事件监听（对齐 use-reader-interpretation）。
 */
export function useReaderTldr() {
  const tldrRequestBookId = useRef("")
  const loadedTldrBookId = useRef("")
  const tldrStreamUnlisten = useRef<(() => void) | null>(null)
  const tldrCancellingBookId = useRef("")
  const {
    bookId,
    setTldr,
    setTldrLoading,
    setTldrError,
    setTldrLlmReady,
    setTldrProgress,
  } = useReaderStore()

  function detachTldrStream() {
    if (tldrStreamUnlisten.current) {
      tldrStreamUnlisten.current()
      tldrStreamUnlisten.current = null
    }
  }

  async function attachTldrStream(bookIdToLoad: string) {
    detachTldrStream()
    tldrStreamUnlisten.current = await listenDocumentTldrStream((event) => {
      if (event.bookId !== bookIdToLoad) {
        return
      }
      if (
        event.stage === "structureAnalysis" ||
        event.stage === "sampling" ||
        event.stage === "synthesizing"
      ) {
        setTldrProgress({
          stage: event.stage,
          message: event.message,
          sampled: event.sampled,
          engine: event.engine,
        })
        return
      }
      // done / cancelled / failed are terminal — the command return (or catch)
      // drives the final store state; just drop the progress indicator.
      setTldrProgress(null)
    })
  }

  async function ensureTldr(bookIdToLoad = bookId, options: { force?: boolean; manual?: boolean } = {}) {
    if (!bookIdToLoad || !isTauriRuntime()) {
      setTldr(null)
      setTldrLoading(false)
      setTldrError("")
      setTldrLlmReady(false)
      setTldrProgress(null)
      return
    }
    if (tldrRequestBookId.current === bookIdToLoad) {
      return
    }
    if (!options.force && loadedTldrBookId.current === bookIdToLoad) {
      return
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
    tldrCancellingBookId.current = ""
    setTldrLoading(true)
    setTldrError("")
    setTldrProgress(null)
    await attachTldrStream(bookIdToLoad)
    try {
      const result = options.force
        ? await regenerateDocumentTldr(bookIdToLoad)
        : await getDocumentTldr(bookIdToLoad)
      if (useReaderStore.getState().bookId !== bookIdToLoad) {
        return
      }
      loadedTldrBookId.current = bookIdToLoad
      setTldr({
        text: result.text,
        generatedAt: result.generatedAt,
        model: result.model,
        sourceVersion: result.sourceVersion,
      })
    } catch (error) {
      // A user-initiated cancel rejects the pending command — swallow it rather
      // than surfacing the cancellation as an error.
      if (tldrCancellingBookId.current === bookIdToLoad) {
        setTldrError("")
      } else {
        setTldrError(error instanceof Error ? error.message : "TLDR 生成失败")
      }
    } finally {
      detachTldrStream()
      setTldrLoading(false)
      setTldrProgress(null)
      tldrRequestBookId.current = ""
      tldrCancellingBookId.current = ""
    }
  }

  function cancelTldr(bookIdToCancel = bookId) {
    if (!bookIdToCancel || !isTauriRuntime()) {
      return
    }
    tldrCancellingBookId.current = bookIdToCancel
    void cancelDocumentTldr(bookIdToCancel)
  }

  return {
    ensureTldr,
    cancelTldr,
  }
}

export type ReaderTldr = ReturnType<typeof useReaderTldr>
