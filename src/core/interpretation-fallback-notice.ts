import { normalizeCommandError } from "@/core/library-api"

export function localFallbackNotice(error?: unknown, action: "解读" | "追问" = "解读") {
  if (!error) {
    return "当前环境暂时不能使用完整 LLM 解读，已改用本地转换稿生成可核对回答；配置 LLM API Key 并确认网络后可恢复完整能力。"
  }
  const commandError = normalizeCommandError(error)
  const suggestion =
    commandError.suggestion ||
    "请在设置中检查 LLM API Key、Base URL 和网络连接；本地兜底仍会保留选区、证据和引用回跳。"
  switch (commandError.code) {
    case "authentication":
      return `完整 LLM ${action}需要有效的 API Key，当前已改用本地兜底。${suggestion}`
    case "network":
    case "timeout":
      return `完整 LLM ${action}暂时连接不上云端服务，当前已改用本地兜底。${suggestion}`
    default:
      return `完整 LLM ${action}暂时不可用，当前已改用本地兜底。${suggestion}`
  }
}
