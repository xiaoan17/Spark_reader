import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  getLlmSettings,
  getMineruSettings,
  isTauriRuntime,
  type LlmProviderKind,
  type LlmSettings,
} from "@/core/library-api"
import {
  formatSettingsError,
  saveThenTestLlm,
  saveThenTestMineru,
} from "@/core/settings-connectivity"
import {
  LLM_PROVIDER_DEFAULTS,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDER_ORDER,
} from "@/core/llm-providers"

type OnboardingKeyFormProps = {
  desktopAvailable: boolean
  onLlmSettingsSaved?: (settings: LlmSettings) => void
}

type CheckState = "idle" | "testing" | "ok" | "error"

const browserModeMessage = "保存密钥和连通测试请使用桌面版；示例书无需 key 也能先体验。"

export function OnboardingKeyForm({ desktopAvailable, onLlmSettingsSaved }: OnboardingKeyFormProps) {
  const [provider, setProvider] = useState<LlmProviderKind>("deep_seek")
  const [llmKey, setLlmKey] = useState("")
  const [mineruToken, setMineruToken] = useState("")
  const [llmConfigured, setLlmConfigured] = useState(false)
  const [mineruConfigured, setMineruConfigured] = useState(false)
  const [llmState, setLlmState] = useState<CheckState>("idle")
  const [llmMessage, setLlmMessage] = useState("")
  const [mineruState, setMineruState] = useState<CheckState>("idle")
  const [mineruMessage, setMineruMessage] = useState("")
  const [hint, setHint] = useState("")

  useEffect(() => {
    if (!desktopAvailable || !isTauriRuntime()) {
      return
    }
    let cancelled = false
    void Promise.all([getLlmSettings(), getMineruSettings()])
      .then(([llm, mineru]) => {
        if (cancelled) return
        setProvider(llm.provider)
        setLlmConfigured(llm.apiKeyConfigured)
        setMineruConfigured(mineru.apiTokenConfigured)
      })
      .catch(() => {
        // 加载失败不阻塞向导:用户仍可直接填 key 保存。
      })
    return () => {
      cancelled = true
    }
  }, [desktopAvailable])

  const busy = llmState === "testing" || mineruState === "testing"

  async function handleSaveAndTest() {
    if (!desktopAvailable) {
      setHint(browserModeMessage)
      return
    }

    const shouldTestLlm = Boolean(llmKey.trim()) || llmConfigured
    const shouldTestMineru = Boolean(mineruToken.trim()) || mineruConfigured
    if (!shouldTestLlm && !shouldTestMineru) {
      setHint("请至少填写 MinerU Token 或一个 LLM Key 再测试。")
      return
    }
    setHint("")

    if (shouldTestLlm) {
      setLlmState("testing")
      setLlmMessage("")
      try {
        const { settings, test } = await saveThenTestLlm({
          provider,
          baseUrl: LLM_PROVIDER_DEFAULTS[provider].baseUrl,
          model: LLM_PROVIDER_DEFAULTS[provider].model,
          apiKey: llmKey.trim() || undefined,
        })
        setLlmConfigured(settings.apiKeyConfigured)
        setLlmKey("")
        onLlmSettingsSaved?.(settings)
        setLlmState(test.ok ? "ok" : "error")
        setLlmMessage(
          test.ok
            ? `${LLM_PROVIDER_LABELS[test.provider]} ${test.model} 连通正常`
            : "连通失败，请检查 key 后重试",
        )
      } catch (error) {
        setLlmState("error")
        setLlmMessage(formatSettingsError(error))
      }
    }

    if (shouldTestMineru) {
      setMineruState("testing")
      setMineruMessage("")
      try {
        const { settings, test } = await saveThenTestMineru({
          baseUrl: "https://mineru.net",
          apiToken: mineruToken.trim() || undefined,
        })
        setMineruConfigured(settings.apiTokenConfigured)
        setMineruToken("")
        setMineruState(test.ok ? "ok" : "error")
        setMineruMessage(
          test.ok ? "MinerU 连通正常，只读测试不消耗配额" : "MinerU 连通失败，请检查 Token 后重试",
        )
      } catch (error) {
        setMineruState("error")
        setMineruMessage(formatSettingsError(error))
      }
    }
  }

  return (
    <div className="space-y-4 text-sm" data-testid="onboarding-key-form">
      <div className="grid gap-2 sm:grid-cols-3" aria-label="LLM provider 预设">
        {LLM_PROVIDER_ORDER.map((preset) => (
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
            onClick={() => setProvider(preset)}
          >
            <span className="block text-sm font-medium">{LLM_PROVIDER_LABELS[preset]}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {LLM_PROVIDER_DEFAULTS[preset].model}
            </span>
          </button>
        ))}
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {LLM_PROVIDER_LABELS[provider]} API Key {llmConfigured ? "· 已配置" : "· 未配置"}
        </span>
        <input
          className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
          type="password"
          value={llmKey}
          placeholder="用于深度解读"
          onChange={(event) => setLlmKey(event.target.value)}
        />
        <StatusLine state={llmState} message={llmMessage} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          MinerU API Token {mineruConfigured ? "· 已配置" : "· 未配置"}
        </span>
        <input
          className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
          type="password"
          value={mineruToken}
          placeholder="用于解析自己的 PDF"
          onChange={(event) => setMineruToken(event.target.value)}
        />
        <StatusLine state={mineruState} message={mineruMessage} />
      </label>
      {hint ? <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">{hint}</div> : null}
      <div className="flex justify-end">
        <Button size="sm" disabled={busy || !desktopAvailable} onClick={() => void handleSaveAndTest()}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {llmState === "error" || mineruState === "error" ? "重试" : "保存并测试"}
        </Button>
      </div>
      {!desktopAvailable ? (
        <p className="text-xs leading-5 text-muted-foreground">{browserModeMessage}</p>
      ) : null}
    </div>
  )
}

function StatusLine({ state, message }: { state: CheckState; message: string }) {
  if (state === "idle" || !message) {
    return null
  }
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {state === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : null}
      {state === "error" ? <XCircle className="h-3.5 w-3.5 text-danger" /> : null}
      {state === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      <span className={cn(state === "error" ? "text-danger" : "text-muted-foreground")}>{message}</span>
    </div>
  )
}
