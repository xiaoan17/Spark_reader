import type { LlmProviderKind } from "@/core/library-api"

/** LLM provider 展示名。设置面板与首次配置向导共用,避免两处文案漂移。 */
export const LLM_PROVIDER_LABELS: Record<LlmProviderKind, string> = {
  deep_seek: "DeepSeek",
  open_ai: "OpenAI",
  anthropic: "Anthropic",
}

export const LLM_PROVIDER_ORDER: LlmProviderKind[] = ["deep_seek", "open_ai", "anthropic"]

/** 各 provider 的默认 baseUrl / model,作为未配置时的回退值。 */
export const LLM_PROVIDER_DEFAULTS: Record<LlmProviderKind, { baseUrl: string; model: string }> = {
  deep_seek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  open_ai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
  },
}

export const LLM_PROVIDER_KEY_LINKS: Record<LlmProviderKind, { label: string; href: string }> = {
  deep_seek: {
    label: "获取 DeepSeek key",
    href: "https://platform.deepseek.com/api_keys",
  },
  open_ai: {
    label: "获取 OpenAI key",
    href: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "获取 Anthropic key",
    href: "https://console.anthropic.com/settings/keys",
  },
}

export const MINERU_TOKEN_LINK = "https://mineru.net/apiManage/token"

/** provider → 对应密钥的环境变量名(与 Rust `SECRET_KEYS` 对齐)。 */
export const LLM_PROVIDER_SECRET_KEY: Record<LlmProviderKind, string> = {
  deep_seek: "DEEPSEEK_API_KEY",
  open_ai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
}

export const MINERU_SECRET_KEY = "MINERU_API_TOKEN"
