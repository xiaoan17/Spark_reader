import { useEffect, useRef } from "react"
import { listenAppMenuAction } from "@/core/library-api"
import { dispatchAppMenuAction, type AppMenuHandlers } from "./app-menu-actions"

/**
 * macOS 原生菜单：只订阅一次，动作经 ref 分发到与顶栏相同的 handler。
 * 返回的 ref 由 ReaderShell 在每次渲染刷新为最新闭包（appMenuHandlersRef.current = {...}），
 * 这样订阅只建立一次，而处理器始终是最新的。
 */
export function useAppMenu() {
  const appMenuHandlersRef = useRef<AppMenuHandlers | null>(null)
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void listenAppMenuAction((actionId) => {
      const handlers = appMenuHandlersRef.current
      if (handlers) {
        dispatchAppMenuAction(actionId, handlers)
      }
    }).then((fn) => {
      if (disposed) {
        fn?.()
      } else {
        unlisten = fn
      }
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
  return appMenuHandlersRef
}
