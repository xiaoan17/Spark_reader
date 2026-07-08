import { useEffect, useState } from "react"
import { getLlmSettings, isTauriRuntime, type LlmSettings } from "@/core/library-api"

/**
 * 当前 LLM provider 设置：桌面版读取本机 provider/模型，浏览器版留空走本地兜底。
 * 挂载时拉一次；保存面板回调可直接 setLlmSettings 覆盖。
 */
export function useLlmSettings() {
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [llmSettingsError, setLlmSettingsError] = useState("")

  useEffect(() => {
    void refreshLlmSettings()
  }, [])

  async function refreshLlmSettings() {
    if (!isTauriRuntime()) {
      setLlmSettings(null)
      setLlmSettingsError("")
      return null
    }

    try {
      const settings = await getLlmSettings()
      setLlmSettings(settings)
      setLlmSettingsError("")
      return settings
    } catch (error) {
      setLlmSettings(null)
      setLlmSettingsError(error instanceof Error ? error.message : "AI provider 读取失败")
      return null
    }
  }

  return {
    llmSettings,
    llmSettingsError,
    setLlmSettings,
    setLlmSettingsError,
  }
}
