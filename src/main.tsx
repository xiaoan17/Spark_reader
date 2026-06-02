import React from "react"
import ReactDOM from "react-dom/client"
import "katex/dist/katex.min.css"
import { App } from "./App"
import "./styles.css"

declare global {
  interface Window {
    __focusedReadingShowStartupError?: (message: string) => void
  }
}

function reportStartupError(error: unknown) {
  const message =
    error instanceof Error
      ? [error.message, error.stack].filter(Boolean).join("\n\n")
      : String(error)
  window.__focusedReadingShowStartupError?.(`前端启动失败：${message}`)
}

const rootElement = document.getElementById("root")
if (!rootElement) {
  reportStartupError("缺少 root 挂载节点")
} else {
  try {
    ReactDOM.createRoot(rootElement, {
      onUncaughtError: reportStartupError,
      onCaughtError: reportStartupError,
      onRecoverableError: reportStartupError,
    }).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  } catch (error) {
    reportStartupError(error)
  }
}
