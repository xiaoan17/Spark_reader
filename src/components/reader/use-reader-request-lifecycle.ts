import { useRef } from "react"
import { cancelInterpretation } from "@/core/library-api"
import { createRequestGuard } from "@/core/async-request-guard"

/**
 * 请求生命周期基础设施：单飞版本守卫、延时任务、流监听器、活跃解读请求 id。
 * App 编排层不用 useEffect，这里用 ref + 命令式管理副作用；被 App、解读域、
 * 高亮域共用。streamUnlisten / activeInterpretationRequestId 两个 ref 直接暴露，
 * 供解读域在流式过程中原地读写。
 */
export function useReaderRequestLifecycle() {
  const timers = useRef<number[]>([])
  const requestGuard = useRef(createRequestGuard())
  const streamUnlisten = useRef<(() => void) | null>(null)
  const activeInterpretationRequestId = useRef<string>("")

  function clearTimers() {
    for (const timer of timers.current) {
      window.clearTimeout(timer)
    }
    timers.current = []
  }

  function schedule(callback: () => void, delay: number) {
    const timer = window.setTimeout(callback, delay)
    timers.current.push(timer)
  }

  function startRequest() {
    return requestGuard.current.start()
  }

  function isCurrentRequest(version: number) {
    return requestGuard.current.isCurrent(version)
  }

  function clearStreamListener() {
    streamUnlisten.current?.()
    streamUnlisten.current = null
  }

  function stopActiveRequest() {
    const requestId = activeInterpretationRequestId.current
    if (requestId) {
      void cancelInterpretation(requestId).catch(() => undefined)
    }
    requestGuard.current.stop()
    clearTimers()
    clearStreamListener()
    activeInterpretationRequestId.current = ""
  }

  return {
    streamUnlisten,
    activeInterpretationRequestId,
    clearTimers,
    schedule,
    startRequest,
    isCurrentRequest,
    clearStreamListener,
    stopActiveRequest,
  }
}

export type ReaderRequestLifecycle = ReturnType<typeof useReaderRequestLifecycle>
