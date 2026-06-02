import type { LibraryStatus } from "@/stores/reader-store"

type LlmKeySettings = {
  provider: string
  model: string
  apiKeyConfigured: boolean
}

type LlmKeyReadiness =
  | { ready: true }
  | { ready: false; reason: "missing_api_key"; message: string }

export function shouldUseBackendInterpretation({
  bookId,
  libraryStatus,
  tauriRuntime,
}: {
  bookId: string
  libraryStatus: LibraryStatus
  tauriRuntime: boolean
}) {
  return tauriRuntime && Boolean(bookId) && libraryStatus === "indexed"
}

export function llmKeyReadiness(
  settings: LlmKeySettings,
  action: "解读" | "追问" = "解读",
): LlmKeyReadiness {
  if (settings.apiKeyConfigured) {
    return { ready: true }
  }
  const provider = llmProviderLabel(settings.provider)
  const model = settings.model.trim() ? `（${settings.model}）` : ""
  return {
    ready: false,
    reason: "missing_api_key",
    message: `${provider}${model} 还没有配置 API Key，当前已改用本地兜底。请在设置中填入 API Key 后重试完整 LLM ${action}。`,
  }
}

function llmProviderLabel(provider: string) {
  switch (provider) {
    case "deep_seek":
      return "DeepSeek"
    case "open_ai":
      return "OpenAI"
    case "anthropic":
      return "Anthropic"
    default:
      return provider || "当前 LLM provider"
  }
}
