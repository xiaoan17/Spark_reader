import { AlertCircle, Loader2, RefreshCw, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export type TldrBannerProps = {
  text?: string
  generatedAt?: string
  model?: string
  loading?: boolean
  error?: string
  desktopAvailable?: boolean
  llmReady?: boolean
  dismissed?: boolean
  onGenerate?: () => void
  onRegenerate?: () => void
  onDismiss?: () => void
}

export function TldrBanner({
  text = "",
  generatedAt = "",
  model = "",
  loading = false,
  error = "",
  desktopAvailable = true,
  llmReady = true,
  dismissed = false,
  onGenerate,
  onRegenerate,
  onDismiss,
}: TldrBannerProps) {
  if (dismissed) {
    return null
  }

  const hasText = text.trim().length > 0
  const canGenerate = desktopAvailable && !loading
  const actionLabel = hasText ? "重新生成" : "生成文档总结"
  const action = hasText ? onRegenerate : onGenerate

  return (
    <section className="border-b bg-card/70 px-5 py-3">
      <div className="mx-auto flex max-w-4xl items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">TLDR</div>
            {model ? <Badge variant="secondary">{model}</Badge> : null}
            {generatedAt ? (
              <span className="text-xs text-muted-foreground">{formatTldrDate(generatedAt)}</span>
            ) : null}
          </div>
          {loading ? (
            <div className="mt-2 space-y-2">
              <div className="h-3 w-full max-w-2xl rounded bg-muted reader-shimmer" />
              <div className="h-3 w-10/12 max-w-xl rounded bg-muted reader-shimmer" />
            </div>
          ) : hasText ? (
            <p className="mt-1 text-sm leading-6 text-foreground">{text}</p>
          ) : error ? (
            <div className="mt-1 flex items-start gap-2 text-sm leading-6 text-red-700">
              <AlertCircle className="mt-1 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {desktopAvailable
                ? llmReady
                  ? "这本书还没有生成文档级速览。"
                  : "配置 LLM API Key 后可生成文档级速览；点击生成会重新检测当前配置。"
                : "文档级速览需要桌面端后端生成。"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant={hasText ? "ghost" : "secondary"}
            disabled={!canGenerate}
            onClick={action}
          >
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {actionLabel}
          </Button>
          <Button size="icon" variant="ghost" aria-label="关闭 TLDR" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  )
}

function formatTldrDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
