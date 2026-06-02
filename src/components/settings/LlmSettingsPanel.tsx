import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  SearchCheck,
  Settings2,
  XCircle,
} from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  getEmbeddingSettings,
  getLlmSettings,
  getMineruSettings,
  isTauriRuntime,
  productSelfCheck,
  saveEmbeddingSettings,
  saveLlmSettings,
  saveMineruSettings,
  testEmbeddingConnection,
  testLlmConnection,
  normalizeCommandError,
  type LlmProviderKind,
  type ProductSelfCheckResponse,
} from "@/core/library-api"
import {
  replaceInternalCitationsWithReadableLabels,
  sanitizeInternalReferenceText,
} from "@/core/citation-display"

type LlmSettingsPanelProps = {
  open: boolean
  onClose: () => void
  onEmbeddingSettingsSaved?: () => void
  defaultAdvancedOpen?: boolean
}

const providerLabels: Record<LlmProviderKind, string> = {
  deep_seek: "DeepSeek",
  open_ai: "OpenAI",
  anthropic: "Anthropic",
}

const defaultSettings: Record<LlmProviderKind, { baseUrl: string; model: string }> = {
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
    model: "claude-4-5-sonnet",
  },
}

const providerOrder: LlmProviderKind[] = ["deep_seek", "open_ai", "anthropic"]

const providerDescriptions: Record<LlmProviderKind, string> = {
  deep_seek: "推荐默认项，成本低，适合作为日常解读模型。",
  open_ai: "适合英文论文和复杂推理，使用 OpenAI 兼容接口。",
  anthropic: "适合长上下文和细致解释，使用 Anthropic Messages API。",
}

const providerKeyLinks: Record<LlmProviderKind, { label: string; href: string }> = {
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

const defaultEmbeddingSettings = {
  provider: "siliconflow",
  baseUrl: "https://api.siliconflow.cn/v1/embeddings",
  model: "Qwen/Qwen3-Embedding-4B",
  expectedDimension: 2560,
}

const defaultMineruSettings = {
  baseUrl: "https://mineru.net",
}

const mineruTokenLink = "https://mineru.net/apiManage/docs"
const siliconFlowKeyLink = "https://cloud.siliconflow.cn/account/ak"

const browserModeNotice =
  "浏览器版可查看界面、导入示例书和体验本地兜底；保存密钥、测试连接和 MinerU 云端解析请使用桌面版。"

const browserModeSettingsMessage =
  "浏览器版可体验界面和本地兜底；保存密钥和测试连接请使用桌面版。"

const browserModeSaveMessage = "保存设置请使用桌面版；浏览器版可先体验本地兜底。"

const browserModeMineruMessage =
  "MinerU 云端解析设置请使用桌面版保存；浏览器版可先使用示例书和本地文本体验。"

const browserModeTestMessage = "连接测试请使用桌面版；浏览器版不会读取本机密钥。"

const browserModeSelfCheckMessage = "开发诊断仅桌面版可运行；浏览器版可查看界面和本地兜底体验。"

export function LlmSettingsPanel({
  open,
  onClose,
  onEmbeddingSettingsSaved,
  defaultAdvancedOpen = false,
}: LlmSettingsPanelProps) {
  const [provider, setProvider] = useState<LlmProviderKind>("deep_seek")
  const [baseUrl, setBaseUrl] = useState(defaultSettings.deep_seek.baseUrl)
  const [model, setModel] = useState(defaultSettings.deep_seek.model)
  const [apiKey, setApiKey] = useState("")
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "testing" | "ok" | "error">("idle")
  const [message, setMessage] = useState("")
  const [embeddingEnabled, setEmbeddingEnabled] = useState(true)
  const [embeddingProvider, setEmbeddingProvider] = useState(defaultEmbeddingSettings.provider)
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(defaultEmbeddingSettings.baseUrl)
  const [embeddingModel, setEmbeddingModel] = useState(defaultEmbeddingSettings.model)
  const [embeddingDimension, setEmbeddingDimension] = useState(String(defaultEmbeddingSettings.expectedDimension))
  const [embeddingApiKey, setEmbeddingApiKey] = useState("")
  const [embeddingApiKeyConfigured, setEmbeddingApiKeyConfigured] = useState(false)
  const [embeddingStatus, setEmbeddingStatus] = useState<"idle" | "saving" | "testing" | "ok" | "error">("idle")
  const [embeddingMessage, setEmbeddingMessage] = useState("")
  const [mineruBaseUrl, setMineruBaseUrl] = useState(defaultMineruSettings.baseUrl)
  const [mineruApiToken, setMineruApiToken] = useState("")
  const [mineruApiTokenConfigured, setMineruApiTokenConfigured] = useState(false)
  const [mineruStatus, setMineruStatus] = useState<"idle" | "saving" | "ok" | "error">("idle")
  const [mineruMessage, setMineruMessage] = useState("")
  const [selfCheckStatus, setSelfCheckStatus] = useState<"idle" | "running" | "ok" | "error">("idle")
  const [selfCheckMessage, setSelfCheckMessage] = useState("")
  const [selfCheckResult, setSelfCheckResult] = useState<ProductSelfCheckResponse | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    if (!isTauriRuntime()) {
      setStatus("idle")
      setMessage(browserModeSettingsMessage)
      return
    }

    setStatus("loading")
    void Promise.all([getLlmSettings(), getEmbeddingSettings(), getMineruSettings()])
      .then(([settings, embedding, mineru]) => {
        if (cancelled) return
        setProvider(settings.provider)
        setBaseUrl(settings.baseUrl)
        setModel(settings.model)
        setApiKeyConfigured(settings.apiKeyConfigured)
        setApiKey("")
        setEmbeddingEnabled(embedding.enabled)
        setEmbeddingProvider(embedding.provider === "disabled" ? defaultEmbeddingSettings.provider : embedding.provider)
        setEmbeddingBaseUrl(embedding.baseUrl || defaultEmbeddingSettings.baseUrl)
        setEmbeddingModel(embedding.model || defaultEmbeddingSettings.model)
        setEmbeddingDimension(String(embedding.expectedDimension ?? defaultEmbeddingSettings.expectedDimension))
        setEmbeddingApiKeyConfigured(embedding.apiKeyConfigured)
        setEmbeddingApiKey("")
        setEmbeddingStatus("idle")
        setEmbeddingMessage("")
        setMineruBaseUrl(mineru.baseUrl || defaultMineruSettings.baseUrl)
        setMineruApiTokenConfigured(mineru.apiTokenConfigured)
        setMineruApiToken("")
        setMineruStatus("idle")
        setMineruMessage("")
        setSelfCheckStatus("idle")
        setSelfCheckMessage("")
        setSelfCheckResult(null)
        setStatus("idle")
        setMessage("")
      })
      .catch((error) => {
        if (cancelled) return
        setStatus("error")
        setMessage(settingsErrorMessage(error))
      })

    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) {
    return null
  }

  function handleProviderChange(nextProvider: LlmProviderKind) {
    setProvider(nextProvider)
    setBaseUrl(defaultSettings[nextProvider].baseUrl)
    setModel(defaultSettings[nextProvider].model)
    setApiKey("")
    setApiKeyConfigured(false)
  }

  async function handleSave() {
    if (!isTauriRuntime()) {
      setMessage(browserModeSaveMessage)
      return
    }

    setStatus("saving")
    setMessage("")
    try {
      const settings = await saveLlmSettings({
        provider,
        baseUrl,
        model,
        apiKey: apiKey.trim() || undefined,
      })
      setApiKeyConfigured(settings.apiKeyConfigured)
      setApiKey("")
      setStatus("ok")
      setMessage("设置已保存")
    } catch (error) {
      setStatus("error")
      setMessage(settingsErrorMessage(error))
    }
  }

  async function handleSaveEmbedding() {
    if (!isTauriRuntime()) {
      setEmbeddingMessage(browserModeSaveMessage)
      return
    }

    const expectedDimension = parseOptionalPositiveInt(embeddingDimension)
    if (embeddingDimension.trim() && expectedDimension === null) {
      setEmbeddingStatus("error")
      setEmbeddingMessage("向量维度必须是正整数")
      return
    }

    setEmbeddingStatus("saving")
    setEmbeddingMessage("")
    try {
      const settings = await saveEmbeddingSettings({
        provider: embeddingProvider.trim() || defaultEmbeddingSettings.provider,
        baseUrl: embeddingBaseUrl,
        model: embeddingModel,
        expectedDimension,
        enabled: embeddingEnabled,
        apiKey: embeddingApiKey.trim() || undefined,
      })
      setEmbeddingEnabled(settings.enabled)
      setEmbeddingProvider(settings.provider === "disabled" ? defaultEmbeddingSettings.provider : settings.provider)
      setEmbeddingBaseUrl(settings.baseUrl)
      setEmbeddingModel(settings.model)
      setEmbeddingDimension(String(settings.expectedDimension ?? ""))
      setEmbeddingApiKeyConfigured(settings.apiKeyConfigured)
      setEmbeddingApiKey("")
      setEmbeddingStatus("ok")
      setEmbeddingMessage("Embedding 设置已保存；当前打开的书籍会自动按新配置重建索引")
      onEmbeddingSettingsSaved?.()
    } catch (error) {
      setEmbeddingStatus("error")
      setEmbeddingMessage(settingsErrorMessage(error))
    }
  }

  async function handleSaveMineru() {
    if (!isTauriRuntime()) {
      setMineruMessage(browserModeMineruMessage)
      return
    }
    setMineruStatus("saving")
    setMineruMessage("")
    try {
      const settings = await saveMineruSettings({
        baseUrl: mineruBaseUrl.trim() || defaultMineruSettings.baseUrl,
        apiToken: mineruApiToken.trim() || undefined,
      })
      setMineruBaseUrl(settings.baseUrl)
      setMineruApiTokenConfigured(settings.apiTokenConfigured)
      setMineruApiToken("")
      setMineruStatus("ok")
      setMineruMessage("MinerU 设置已保存；云端解析会使用新的 token")
    } catch (error) {
      setMineruStatus("error")
      setMineruMessage(settingsErrorMessage(error))
    }
  }

  async function handleTest() {
    if (!isTauriRuntime()) {
      setMessage(browserModeTestMessage)
      return
    }

    setStatus("testing")
    setMessage("")
    try {
      const result = await testLlmConnection()
      setStatus(result.ok ? "ok" : "error")
      setMessage(result.ok ? `${providerLabels[result.provider]} ${result.model} 连通正常` : "连通失败")
    } catch (error) {
      setStatus("error")
      setMessage(settingsErrorMessage(error))
    }
  }

  async function handleTestEmbedding() {
    if (!isTauriRuntime()) {
      setEmbeddingMessage(browserModeTestMessage)
      return
    }
    setEmbeddingStatus("testing")
    setEmbeddingMessage("")
    try {
      const result = await testEmbeddingConnection()
      setEmbeddingStatus(result.ok ? "ok" : "error")
      setEmbeddingMessage(
        result.ok
          ? `${result.provider} ${result.model} 连通正常，维度 ${result.dimension}`
          : "Embedding 连通失败",
      )
    } catch (error) {
      setEmbeddingStatus("error")
      setEmbeddingMessage(settingsErrorMessage(error))
    }
  }

  async function handleProductSelfCheck() {
    if (!isTauriRuntime()) {
      setSelfCheckStatus("error")
      setSelfCheckMessage(browserModeSelfCheckMessage)
      return
    }

    setSelfCheckStatus("running")
    setSelfCheckMessage("")
    setSelfCheckResult(null)
    try {
      const result = await productSelfCheck()
      setSelfCheckResult(result)
      setSelfCheckStatus(result.ok ? "ok" : "error")
      setSelfCheckMessage(
        result.ok
          ? `产品自检通过：${result.steps.length} 个核心步骤已跑通`
          : "产品自检未通过，请查看失败步骤",
      )
    } catch (error) {
      setSelfCheckStatus("error")
      setSelfCheckMessage(settingsErrorMessage(error))
    }
  }

  async function handleSaveAll() {
    if (!isTauriRuntime()) {
      setMessage(browserModeSaveMessage)
      setMineruMessage(browserModeMineruMessage)
      setEmbeddingMessage(browserModeSaveMessage)
      return
    }

    await handleSave()
    await handleSaveMineru()
    await handleSaveEmbedding()
  }

  const busy = status === "loading" || status === "saving" || status === "testing"
  const embeddingBusy = embeddingStatus === "saving" || embeddingStatus === "testing"
  const mineruBusy = mineruStatus === "saving"
  const selfCheckBusy = selfCheckStatus === "running"
  const saveAllBusy = busy || embeddingBusy || mineruBusy || selfCheckBusy
  const canSaveAll =
    Boolean(baseUrl.trim()) &&
    Boolean(model.trim()) &&
    Boolean(mineruBaseUrl.trim()) &&
    (!embeddingEnabled || (Boolean(embeddingBaseUrl.trim()) && Boolean(embeddingModel.trim())))
  const desktopRuntime = isTauriRuntime()

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 p-4"
      data-testid="settings-panel"
    >
      <div className="max-h-[calc(100vh-2rem)] w-[640px] overflow-auto rounded-lg border bg-card text-card-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <div className="text-base font-semibold">设置</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              推荐模式只需要选择模型服务并填入必要密钥；密钥只保存到本机 .env，不会在界面回显。
            </div>
          </div>
          <div className="flex shrink-0 rounded-md border bg-background p-1" aria-label="设置模式">
            <Button
              size="sm"
              variant={!advancedOpen ? "secondary" : "ghost"}
              className="h-7 px-2.5"
              aria-pressed={!advancedOpen}
              onClick={() => setAdvancedOpen(false)}
            >
              <SearchCheck className="mr-1.5 h-4 w-4" />
              推荐
            </Button>
            <Button
              size="sm"
              variant={advancedOpen ? "secondary" : "ghost"}
              className="h-7 px-2.5"
              aria-pressed={advancedOpen}
              onClick={() => setAdvancedOpen(true)}
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              高级
            </Button>
          </div>
        </div>
        <div className="space-y-4 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                LLM 解读模型
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                选择一个预设，只填当前 provider 的 API key 即可开始深度解读。
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={handleTest}>
                {status === "testing" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                测试
              </Button>
              <Button
                size="sm"
                disabled={busy || !baseUrl.trim() || !model.trim()}
                onClick={handleSave}
              >
                {status === "saving" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                保存 LLM
              </Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3" aria-label="LLM provider 预设">
            {providerOrder.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cn(
                  "rounded-md border bg-background px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-interactive ease-reader hover:bg-muted active:scale-[0.99]",
                  provider === preset
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-border",
                )}
                aria-pressed={provider === preset}
                onClick={() => handleProviderChange(preset)}
              >
                <span className="block text-sm font-medium">{providerLabels[preset]}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {defaultSettings[preset].model}
                </span>
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              API Key {apiKeyConfigured ? "· 已配置" : "· 未配置"}
            </span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              type="password"
              value={apiKey}
              placeholder={apiKeyConfigured ? "留空则沿用已保存密钥" : "输入密钥后保存"}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <span>
              当前预设：{providerLabels[provider]} · {model}。{providerDescriptions[provider]}
            </span>
            <ExternalHelpLink href={providerKeyLinks[provider].href}>
              {providerKeyLinks[provider].label}
            </ExternalHelpLink>
          </div>
          {advancedOpen ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Base URL</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  模型服务地址；使用官方预设时保持默认即可。
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Model</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  具体模型 ID；只有切换到自定义模型时需要修改。
                </span>
              </label>
            </div>
          ) : null}
          {message ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {status === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {status === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : null}
              <span>{message}</span>
            </div>
          ) : null}
        </div>
        <div className="space-y-4 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">MinerU 云端解析</div>
              <div className="mt-1 text-xs text-muted-foreground">
                导入 PDF 时保留 Markdown 结构、图片、表格和公式资源；这里通常只需要填 token。
              </div>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              disabled={mineruBusy || !mineruBaseUrl.trim()}
              onClick={() => void handleSaveMineru()}
            >
              {mineruStatus === "saving" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              保存 MinerU
            </Button>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              API Token {mineruApiTokenConfigured ? "· 已配置" : "· 未配置"}
            </span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              type="password"
              value={mineruApiToken}
              placeholder={mineruApiTokenConfigured ? "留空则沿用已保存 token" : "输入 MinerU token 后保存"}
              onChange={(event) => setMineruApiToken(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <span>用于云端解析论文、扫描件、公式和表格；token 只保存到本机。</span>
            <ExternalHelpLink href={mineruTokenLink}>获取 MinerU token</ExternalHelpLink>
          </div>
          {advancedOpen ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">MinerU Base URL</span>
              <input
                className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                value={mineruBaseUrl}
                onChange={(event) => setMineruBaseUrl(event.target.value)}
              />
              <span className="block text-[11px] leading-4 text-muted-foreground">
                MinerU 服务地址；通常保持 https://mineru.net。
              </span>
            </label>
          ) : (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              使用默认 MinerU 服务：{mineruBaseUrl}
            </div>
          )}
          {mineruMessage ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {mineruStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {mineruStatus === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : null}
              <span>{mineruMessage}</span>
            </div>
          ) : null}
        </div>
        <div className="space-y-4 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">检索模式</div>
              <div className="mt-1 text-xs text-muted-foreground">
                没有 Embedding key 也能先用本地文本检索；向量检索只是语义召回增强。
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {embeddingEnabled ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={embeddingBusy}
                  onClick={handleTestEmbedding}
                >
                  {embeddingStatus === "testing" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  测试
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={embeddingBusy || (embeddingEnabled && (!embeddingBaseUrl.trim() || !embeddingModel.trim()))}
                onClick={handleSaveEmbedding}
              >
                {embeddingStatus === "saving" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                保存 Embedding
              </Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2" aria-label="检索模式选择">
            <button
              type="button"
              className={cn(
                "rounded-md border bg-background px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-interactive ease-reader hover:bg-muted active:scale-[0.99]",
                !embeddingEnabled
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border",
              )}
              aria-pressed={!embeddingEnabled}
              onClick={() => setEmbeddingEnabled(false)}
            >
              <span className="block text-sm font-medium">本地文本检索</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                无需 key；保留全文搜索、引用回跳和本地兜底解读。
              </span>
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md border bg-background px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-interactive ease-reader hover:bg-muted active:scale-[0.99]",
                embeddingEnabled
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border",
              )}
              aria-pressed={embeddingEnabled}
              onClick={() => setEmbeddingEnabled(true)}
            >
              <span className="block text-sm font-medium">语义向量检索</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                可选增强；默认使用 SiliconFlow Qwen3 Embedding。
              </span>
            </button>
          </div>
          {embeddingEnabled ? (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Embedding API Key {embeddingApiKeyConfigured ? "· 已配置" : "· 未配置"}
                </span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  type="password"
                  value={embeddingApiKey}
                  placeholder={embeddingApiKeyConfigured ? "留空则沿用已保存密钥" : "可先不填，改用本地文本检索"}
                  onChange={(event) => setEmbeddingApiKey(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                <span>默认使用 SiliconFlow Qwen3 Embedding；也可以切回本地文本检索。</span>
                <ExternalHelpLink href={siliconFlowKeyLink}>获取 SiliconFlow key</ExternalHelpLink>
              </div>
            </>
          ) : (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              保存后会关闭向量索引；已转换书籍仍可使用 FTS 文本搜索。
            </div>
          )}
          {advancedOpen && embeddingEnabled ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Provider ID</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={embeddingProvider}
                  onChange={(event) => setEmbeddingProvider(event.target.value)}
                />
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  向量服务名称，用于判断旧索引是否需要重建。
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Embedding URL</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={embeddingBaseUrl}
                  onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
                />
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  兼容 OpenAI embeddings 协议的接口地址。
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Model ID</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={embeddingModel}
                  onChange={(event) => setEmbeddingModel(event.target.value)}
                />
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  向量模型 ID；切换后已导入书籍会重建索引。
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">向量维度</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  inputMode="numeric"
                  value={embeddingDimension}
                  onChange={(event) => setEmbeddingDimension(event.target.value)}
                />
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  必须匹配模型输出维度；不确定时使用默认值。
                </span>
              </label>
            </div>
          ) : null}
          {embeddingMessage ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {embeddingStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {embeddingStatus === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : null}
              <span>{embeddingMessage}</span>
            </div>
          ) : null}
        </div>
        {advancedOpen ? (
          <div className="space-y-3 border-b p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">开发诊断</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  用临时 PDF 和临时书库验收 Markdown 转换、搜索、解读引用、追问、高亮和历史。
                </div>
              </div>
              <Button
                variant="outline"
                data-testid="product-self-check-button"
                disabled={selfCheckBusy}
                onClick={handleProductSelfCheck}
              >
                {selfCheckBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                运行自检
              </Button>
            </div>
            {selfCheckMessage ? (
              <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
                {selfCheckStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
                {selfCheckStatus === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : null}
                <span>{selfCheckMessage}</span>
              </div>
            ) : null}
            {selfCheckResult ? (
              <div className="space-y-2 rounded-md bg-muted/70 p-2 text-xs">
                <div className="text-muted-foreground">
                  {selfCheckResult.summary.pageCount} 页 · 搜索命中{" "}
                  {selfCheckResult.summary.searchHitCount} · 引用 {selfCheckResult.summary.citationCount}
                </div>
                <div className="space-y-1">
                  {selfCheckResult.steps.map((step) => (
                    <div key={step.id} className="flex gap-2">
                      {step.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                      )}
                      <div className="min-w-0">
                        <span className="font-medium">{selfCheckDisplayText(step.label)}</span>
                        <span className="text-muted-foreground">：{selfCheckDisplayText(step.detail)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {!desktopRuntime ? (
          <div className="border-b bg-muted/45 px-4 py-2 text-xs text-muted-foreground">
            {browserModeNotice}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button disabled={saveAllBusy || !canSaveAll} onClick={() => void handleSaveAll()}>
            {status === "saving" || mineruStatus === "saving" || embeddingStatus === "saving" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            保存全部
          </Button>
        </div>
      </div>
    </div>
  )
}

function ExternalHelpLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a
      className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 transition-colors duration-interactive hover:text-primary hover:underline"
      href={href}
      rel="noreferrer noopener"
      target="_blank"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  )
}

function selfCheckDisplayText(value: string) {
  return sanitizeInternalReferenceText(replaceInternalCitationsWithReadableLabels(value))
    .replace(/\/chunks\b/gi, "")
    .replace(/\bchunks\b/gi, "相关段落")
    .replace(/(\d+)\s*个\s*chunk\b/gi, "$1 段正文")
    .replace(/\bchunk\b/gi, "正文段落")
}

function settingsErrorMessage(error: unknown) {
  const normalized = normalizeCommandError(error)
  if (!normalized.suggestion) {
    return normalized.message
  }

  const messageWithoutSuggestion = normalized.message
    .replace(normalized.suggestion, "")
    .replace(/[。.\s]+$/, "")
  return `${messageWithoutSuggestion}。建议：${normalized.suggestion}`
}

function parseOptionalPositiveInt(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === trimmed ? parsed : null
}
