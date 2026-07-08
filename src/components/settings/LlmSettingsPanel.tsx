import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  SearchCheck,
  Settings2,
  XCircle,
} from "lucide-react"
import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  getEmbeddingSettings,
  getLlmSettings,
  getMineruSettings,
  isTauriRuntime,
  openExternalUrl,
  productSelfCheck,
  saveEmbeddingSettings,
  saveLlmSettings,
  saveMineruSettings,
  testEmbeddingConnection,
  testLlmConnectionWithSettings,
  testMineruConnectionWithSettings,
  normalizeCommandError,
  type LlmSettings,
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
  onLlmSettingsSaved?: (settings: LlmSettings) => void
  onEmbeddingSettingsSaved?: () => void
  onOpenObsidian?: () => void
  defaultAdvancedOpen?: boolean
}

const providerLabels: Record<LlmProviderKind, string> = {
  deep_seek: "DeepSeek",
  open_ai: "OpenAI",
  anthropic: "Anthropic",
}

type ProviderDraft = {
  baseUrl: string
  model: string
  apiKey: string
  apiKeyConfigured: boolean
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
    model: "claude-sonnet-4-5",
  },
}

const providerOrder: LlmProviderKind[] = ["deep_seek", "open_ai", "anthropic"]

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

const initialProviderDrafts: Record<LlmProviderKind, ProviderDraft> = {
  deep_seek: {
    ...defaultSettings.deep_seek,
    apiKey: "",
    apiKeyConfigured: false,
  },
  open_ai: {
    ...defaultSettings.open_ai,
    apiKey: "",
    apiKeyConfigured: false,
  },
  anthropic: {
    ...defaultSettings.anthropic,
    apiKey: "",
    apiKeyConfigured: false,
  },
}

const defaultEmbeddingSettings = {
  provider: "siliconflow",
  baseUrl: "https://api.siliconflow.cn/v1/embeddings",
  model: "Qwen/Qwen3-Embedding-4B",
  expectedDimension: 2560,
  batchSize: 64,
}

const defaultMineruSettings = {
  baseUrl: "https://mineru.net",
}

const mineruTokenLink = "https://mineru.net/apiManage/token"
const siliconFlowKeyLink = "https://cloud.siliconflow.cn/account/ak"

const browserModeSaveMessage = "保存设置请使用桌面版。"

const browserModeMineruMessage = "MinerU 云端解析设置请使用桌面版保存。"

const browserModeTestMessage = "连接测试请使用桌面版。"

const browserModeSelfCheckMessage = "开发诊断请使用桌面版。"

export function LlmSettingsPanel({
  open,
  onClose,
  onLlmSettingsSaved,
  onEmbeddingSettingsSaved,
  onOpenObsidian,
  defaultAdvancedOpen = false,
}: LlmSettingsPanelProps) {
  const [provider, setProvider] = useState<LlmProviderKind>("deep_seek")
  const [providerDrafts, setProviderDrafts] = useState(initialProviderDrafts)
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "testing" | "ok" | "error">("idle")
  const [message, setMessage] = useState("")
  const [embeddingEnabled, setEmbeddingEnabled] = useState(true)
  const [embeddingProvider, setEmbeddingProvider] = useState(defaultEmbeddingSettings.provider)
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(defaultEmbeddingSettings.baseUrl)
  const [embeddingModel, setEmbeddingModel] = useState(defaultEmbeddingSettings.model)
  const [embeddingDimension, setEmbeddingDimension] = useState(String(defaultEmbeddingSettings.expectedDimension))
  const [embeddingBatchSize, setEmbeddingBatchSize] = useState(String(defaultEmbeddingSettings.batchSize))
  const [embeddingApiKey, setEmbeddingApiKey] = useState("")
  const [embeddingApiKeyConfigured, setEmbeddingApiKeyConfigured] = useState(false)
  const [embeddingStatus, setEmbeddingStatus] = useState<"idle" | "saving" | "testing" | "ok" | "error">("idle")
  const [embeddingMessage, setEmbeddingMessage] = useState("")
  const [mineruBaseUrl, setMineruBaseUrl] = useState(defaultMineruSettings.baseUrl)
  const [mineruApiToken, setMineruApiToken] = useState("")
  const [mineruApiTokenConfigured, setMineruApiTokenConfigured] = useState(false)
  const [mineruStatus, setMineruStatus] = useState<"idle" | "saving" | "testing" | "ok" | "error">("idle")
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
      setMessage("")
      return
    }

    setStatus("loading")
    void Promise.all([getLlmSettings(), getEmbeddingSettings(), getMineruSettings()])
      .then(([settings, embedding, mineru]) => {
        if (cancelled) return
        setProvider(settings.provider)
        setProviderDrafts(() => providerDraftsFromSettings(settings))
        setEmbeddingEnabled(embedding.enabled)
        setEmbeddingProvider(embedding.provider === "disabled" ? defaultEmbeddingSettings.provider : embedding.provider)
        setEmbeddingBaseUrl(embedding.baseUrl || defaultEmbeddingSettings.baseUrl)
        setEmbeddingModel(embedding.model || defaultEmbeddingSettings.model)
        setEmbeddingDimension(String(embedding.expectedDimension ?? defaultEmbeddingSettings.expectedDimension))
        setEmbeddingBatchSize(String(embedding.batchSize ?? defaultEmbeddingSettings.batchSize))
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

  const activeDraft = providerDrafts[provider]
  const baseUrl = activeDraft.baseUrl
  const model = activeDraft.model
  const apiKey = activeDraft.apiKey
  const apiKeyConfigured = activeDraft.apiKeyConfigured

  function handleProviderChange(nextProvider: LlmProviderKind) {
    setProvider(nextProvider)
    setMessage("")
  }

  function updateProviderDraft(nextPatch: Partial<ProviderDraft>) {
    setProviderDrafts((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        ...nextPatch,
      },
    }))
  }

  function activeLlmRequest() {
    return {
      provider,
      baseUrl,
      model,
      apiKey: apiKey.trim() || undefined,
    }
  }

  async function handleSave() {
    if (!isTauriRuntime()) {
      setMessage(browserModeSaveMessage)
      return
    }

    setStatus("saving")
    setMessage("")
    try {
      const settings = await saveLlmSettings(activeLlmRequest())
      setProvider(settings.provider)
      setProviderDrafts(() => providerDraftsFromSettings(settings))
      setStatus("ok")
      setMessage("设置已保存")
      onLlmSettingsSaved?.(settings)
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
    const batchSize = parseOptionalPositiveInt(embeddingBatchSize)
    if (embeddingBatchSize.trim() && batchSize === null) {
      setEmbeddingStatus("error")
      setEmbeddingMessage("批大小必须是正整数")
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
        batchSize,
        enabled: embeddingEnabled,
        apiKey: embeddingApiKey.trim() || undefined,
      })
      setEmbeddingEnabled(settings.enabled)
      setEmbeddingProvider(settings.provider === "disabled" ? defaultEmbeddingSettings.provider : settings.provider)
      setEmbeddingBaseUrl(settings.baseUrl)
      setEmbeddingModel(settings.model)
      setEmbeddingDimension(String(settings.expectedDimension ?? ""))
      setEmbeddingBatchSize(String(settings.batchSize ?? defaultEmbeddingSettings.batchSize))
      setEmbeddingApiKeyConfigured(settings.apiKeyConfigured)
      setEmbeddingApiKey("")
      setEmbeddingStatus("ok")
      setEmbeddingMessage("Embedding 设置已保存")
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
      setMineruMessage("MinerU 设置已保存")
    } catch (error) {
      setMineruStatus("error")
      setMineruMessage(settingsErrorMessage(error))
    }
  }

  async function handleTestMineru() {
    if (!isTauriRuntime()) {
      setMineruMessage(browserModeTestMessage)
      return
    }
    setMineruStatus("testing")
    setMineruMessage("")
    try {
      const result = await testMineruConnectionWithSettings({
        baseUrl: mineruBaseUrl.trim() || defaultMineruSettings.baseUrl,
        apiToken: mineruApiToken.trim() || undefined,
      })
      setMineruStatus(result.ok ? "ok" : "error")
      setMineruMessage(
        result.ok
          ? "MinerU 连通正常，只读测试不消耗解析配额"
          : "MinerU 连通失败",
      )
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
      const request = activeLlmRequest()
      const result = await testLlmConnectionWithSettings(request)
      if (result.ok) {
        const settings = await saveLlmSettings(request)
        setProvider(settings.provider)
        setProviderDrafts(() => providerDraftsFromSettings(settings))
        setStatus("ok")
        setMessage(`${providerLabels[result.provider]} ${result.model} 连通正常`)
        onLlmSettingsSaved?.(settings)
        return
      }
      setStatus("error")
      setMessage("连通失败")
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
  const mineruBusy = mineruStatus === "saving" || mineruStatus === "testing"
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
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={handleTest}>
                {status === "testing" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                测试并记录
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
                  {providerDrafts[preset].model || defaultSettings[preset].model}
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
              onChange={(event) => updateProviderDraft({ apiKey: event.target.value })}
            />
          </label>
          <div className="flex justify-end">
            <ExternalHelpLink
              href={providerKeyLinks[provider].href}
              onError={(error) => setMessage(settingsErrorMessage(error))}
            >
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
                  onChange={(event) => updateProviderDraft({ baseUrl: event.target.value })}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Model</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={model}
                  onChange={(event) => updateProviderDraft({ model: event.target.value })}
                />
              </label>
            </div>
          ) : null}
          {message ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {status === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {status === "error" ? <XCircle className="h-4 w-4 text-danger" /> : null}
              <span>{message}</span>
            </div>
          ) : null}
        </div>
        <div className="space-y-4 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">MinerU 云端解析</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={mineruBusy || !mineruBaseUrl.trim()}
                onClick={() => void handleTestMineru()}
              >
                {mineruStatus === "testing" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                测试
              </Button>
              <Button
                size="sm"
                disabled={mineruBusy || !mineruBaseUrl.trim()}
                onClick={() => void handleSaveMineru()}
              >
                {mineruStatus === "saving" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                保存 MinerU
              </Button>
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              API Token {mineruApiTokenConfigured ? "· 已配置" : "· 未配置"}
            </span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              type="password"
              value={mineruApiToken}
              onChange={(event) => setMineruApiToken(event.target.value)}
            />
          </label>
          <div className="flex justify-end">
            <ExternalHelpLink
              href={mineruTokenLink}
              onError={(error) => setMineruMessage(settingsErrorMessage(error))}
            >
              获取 MinerU token
            </ExternalHelpLink>
          </div>
          {advancedOpen ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">MinerU Base URL</span>
              <input
                className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                value={mineruBaseUrl}
                onChange={(event) => setMineruBaseUrl(event.target.value)}
              />
            </label>
          ) : null}
          {mineruMessage ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {mineruStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {mineruStatus === "error" ? <XCircle className="h-4 w-4 text-danger" /> : null}
              <span>{mineruMessage}</span>
            </div>
          ) : null}
        </div>
        <div className="space-y-4 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">检索模式</div>
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
                  onChange={(event) => setEmbeddingApiKey(event.target.value)}
                />
              </label>
              <div className="flex justify-end">
                <ExternalHelpLink
                  href={siliconFlowKeyLink}
                  onError={(error) => setEmbeddingMessage(settingsErrorMessage(error))}
                >
                  获取 SiliconFlow key
                </ExternalHelpLink>
              </div>
            </>
          ) : null}
          {advancedOpen && embeddingEnabled ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Provider ID</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                value={embeddingProvider}
                onChange={(event) => setEmbeddingProvider(event.target.value)}
              />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Embedding URL</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={embeddingBaseUrl}
                  onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Model ID</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  value={embeddingModel}
                  onChange={(event) => setEmbeddingModel(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">向量维度</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  inputMode="numeric"
                  value={embeddingDimension}
                  onChange={(event) => setEmbeddingDimension(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">批大小</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  inputMode="numeric"
                  value={embeddingBatchSize}
                  onChange={(event) => setEmbeddingBatchSize(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {embeddingMessage ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {embeddingStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {embeddingStatus === "error" ? <XCircle className="h-4 w-4 text-danger" /> : null}
              <span>{embeddingMessage}</span>
            </div>
          ) : null}
        </div>
        {advancedOpen ? (
          <div className="space-y-3 border-b p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">开发诊断</div>
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
                {selfCheckStatus === "error" ? <XCircle className="h-4 w-4 text-danger" /> : null}
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
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
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
        <div className="flex items-center justify-end gap-2 border-t p-4">
          {onOpenObsidian ? (
            <Button variant="ghost" className="mr-auto" onClick={onOpenObsidian}>
              Obsidian 导出设置
            </Button>
          ) : null}
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
  onError,
  children,
}: {
  href: string
  onError?: (error: unknown) => void
  children: ReactNode
}) {
  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!isTauriRuntime()) {
      return
    }
    event.preventDefault()
    try {
      await openExternalUrl(href)
    } catch (error) {
      onError?.(error)
    }
  }

  return (
    <a
      className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 transition-colors duration-interactive hover:text-primary hover:underline"
      href={href}
      onClick={(event) => void handleClick(event)}
      rel="noreferrer noopener"
      target="_blank"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  )
}

function providerDraftsFromSettings(settings: LlmSettings): Record<LlmProviderKind, ProviderDraft> {
  return providerOrder.reduce(
    (drafts, providerKind) => {
      const saved = settings.providers?.[providerKind]
      const activeFallback =
        providerKind === settings.provider
          ? {
              baseUrl: settings.baseUrl,
              model: settings.model,
              apiKeyConfigured: settings.apiKeyConfigured,
            }
          : undefined
      const providerSettings = saved ?? activeFallback

      drafts[providerKind] = {
        baseUrl: providerSettings?.baseUrl || defaultSettings[providerKind].baseUrl,
        model: providerSettings?.model || defaultSettings[providerKind].model,
        apiKey: "",
        apiKeyConfigured: providerSettings?.apiKeyConfigured ?? false,
      }
      return drafts
    },
    {} as Record<LlmProviderKind, ProviderDraft>,
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
