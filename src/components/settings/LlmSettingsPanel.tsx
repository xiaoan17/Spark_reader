import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
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

const defaultEmbeddingSettings = {
  provider: "siliconflow",
  baseUrl: "https://api.siliconflow.cn/v1/embeddings",
  model: "Qwen/Qwen3-Embedding-4B",
  expectedDimension: 2560,
}

const defaultMineruSettings = {
  baseUrl: "https://mineru.net",
}

export function LlmSettingsPanel({ open, onClose, onEmbeddingSettingsSaved }: LlmSettingsPanelProps) {
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

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    if (!isTauriRuntime()) {
      setStatus("idle")
      setMessage("当前是浏览器预览模式；保存和测试连接需要在 Tauri 桌面端运行。")
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
        setMessage(error instanceof Error ? error.message : String(error))
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
      setMessage("当前是浏览器预览模式；保存设置需要在 Tauri 桌面端运行。")
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
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleSaveEmbedding() {
    if (!isTauriRuntime()) {
      setEmbeddingMessage("当前是浏览器预览模式；保存设置需要在 Tauri 桌面端运行。")
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
      setEmbeddingMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleSaveMineru() {
    if (!isTauriRuntime()) {
      setMineruMessage("当前是浏览器预览模式；保存 MinerU 设置需要在 Tauri 桌面端运行。")
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
      setMineruMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleTest() {
    if (!isTauriRuntime()) {
      setMessage("当前是浏览器预览模式；测试连接需要在 Tauri 桌面端运行。")
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
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleTestEmbedding() {
    if (!isTauriRuntime()) {
      setEmbeddingMessage("当前是浏览器预览模式；测试连接需要在 Tauri 桌面端运行。")
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
      setEmbeddingMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleProductSelfCheck() {
    if (!isTauriRuntime()) {
      setSelfCheckStatus("error")
      setSelfCheckMessage("当前是浏览器预览模式；产品自检需要在 Tauri 桌面端运行。")
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
      setSelfCheckMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleSaveAll() {
    if (!isTauriRuntime()) {
      setMessage("当前是浏览器预览模式；保存设置需要在 Tauri 桌面端运行。")
      setMineruMessage("当前是浏览器预览模式；保存 MinerU 设置需要在 Tauri 桌面端运行。")
      setEmbeddingMessage("当前是浏览器预览模式；保存设置需要在 Tauri 桌面端运行。")
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
    Boolean(embeddingBaseUrl.trim()) &&
    Boolean(embeddingModel.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 p-4"
      data-testid="settings-panel"
    >
      <div className="max-h-[calc(100vh-2rem)] w-[560px] overflow-auto rounded-lg border bg-card text-card-foreground shadow-xl">
        <div className="border-b p-4">
          <div className="text-base font-semibold">设置</div>
          <div className="mt-1 text-xs text-muted-foreground">
            每个分区都可以单独保存；底部“保存全部”会一次性写入 LLM、MinerU 和 Embedding 配置。密钥只保存到后端 .env。
          </div>
        </div>
        <div className="space-y-4 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">LLM</div>
              <div className="mt-1 text-xs text-muted-foreground">用于解读、追问和引用生成。</div>
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
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Provider</span>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              value={provider}
              onChange={(event) => handleProviderChange(event.target.value as LlmProviderKind)}
            >
              <option value="deep_seek">DeepSeek</option>
              <option value="open_ai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Base URL</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Model</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
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
                主导入会统一走 MinerU，保留 Markdown 结构、图片、表格和公式资源；token 只保存到后端 .env。
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
            <span className="text-xs font-medium text-muted-foreground">Base URL</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              value={mineruBaseUrl}
              onChange={(event) => setMineruBaseUrl(event.target.value)}
            />
          </label>
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
          {mineruMessage ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {mineruStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {mineruStatus === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : null}
              <span>{mineruMessage}</span>
            </div>
          ) : null}
        </div>
        <div className="space-y-3 border-b p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">产品自检</div>
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
        <div className="space-y-4 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Embedding</div>
              <div className="mt-1 text-xs text-muted-foreground">用于整本书向量检索；关闭后保留 FTS 文本检索。</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={embeddingEnabled}
                  onChange={(event) => setEmbeddingEnabled(event.target.checked)}
                />
                启用
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={embeddingBusy || !embeddingEnabled}
                onClick={handleTestEmbedding}
              >
                {embeddingStatus === "testing" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                测试
              </Button>
              <Button
                size="sm"
                disabled={embeddingBusy || !embeddingBaseUrl.trim() || !embeddingModel.trim()}
                onClick={handleSaveEmbedding}
              >
                {embeddingStatus === "saving" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                保存 Embedding
              </Button>
            </div>
          </div>
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
            <span className="text-xs font-medium text-muted-foreground">
              API Key {embeddingApiKeyConfigured ? "· 已配置" : "· 未配置"}
            </span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              type="password"
              value={embeddingApiKey}
              placeholder={embeddingApiKeyConfigured ? "留空则沿用已保存密钥" : "输入密钥后保存"}
              onChange={(event) => setEmbeddingApiKey(event.target.value)}
            />
          </label>
          {embeddingMessage ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {embeddingStatus === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {embeddingStatus === "error" ? <XCircle className="h-4 w-4 text-red-600" /> : null}
              <span>{embeddingMessage}</span>
            </div>
          ) : null}
        </div>
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

function selfCheckDisplayText(value: string) {
  return sanitizeInternalReferenceText(replaceInternalCitationsWithReadableLabels(value))
    .replace(/\/chunks\b/gi, "")
    .replace(/\bchunks\b/gi, "相关段落")
    .replace(/(\d+)\s*个\s*chunk\b/gi, "$1 段正文")
    .replace(/\bchunk\b/gi, "正文段落")
}

function parseOptionalPositiveInt(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === trimmed ? parsed : null
}
