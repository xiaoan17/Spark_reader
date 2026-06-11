import { AlertCircle, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import type { ReaderDisplayThemeStyle } from "./reader-display-theme"

export type TldrReaderProps = {
  text?: string
  generatedAt?: string
  model?: string
  loading?: boolean
  error?: string
  desktopAvailable?: boolean
  llmReady?: boolean
  displayThemeStyle?: ReaderDisplayThemeStyle
  onGenerate?: () => void
  onRegenerate?: () => void
}

export function TldrReader({
  text = "",
  generatedAt = "",
  model = "",
  loading = false,
  error = "",
  desktopAvailable = true,
  llmReady = true,
  displayThemeStyle,
  onGenerate,
  onRegenerate,
}: TldrReaderProps) {
  const hasText = text.trim().length > 0
  const canGenerate = desktopAvailable && !loading
  const actionLabel = hasText ? "重新生成" : "生成文档总结"
  const action = hasText ? onRegenerate : onGenerate

  return (
    <div
      className="reader-display-theme h-full overflow-auto px-8 py-8"
      style={displayThemeStyle}
    >
      <section className="mx-auto max-w-[var(--reader-page-width)] rounded-md border border-[var(--reader-border)] bg-[var(--reader-surface-bg)] px-8 py-7 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h1 className="text-base font-semibold">TLDR</h1>
              {model ? <Badge variant="secondary">{model}</Badge> : null}
              {generatedAt ? (
                <span className="text-xs text-muted-foreground">{formatTldrDate(generatedAt)}</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">文档级速览会缓存到本地书库。</p>
          </div>
          <Button size="sm" variant={hasText ? "ghost" : "secondary"} disabled={!canGenerate} onClick={action}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {actionLabel}
          </Button>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 w-full rounded bg-muted reader-shimmer" />
              <div className="h-4 w-11/12 rounded bg-muted reader-shimmer" />
              <div className="h-4 w-8/12 rounded bg-muted reader-shimmer" />
            </div>
          ) : hasText ? (
            <MarkdownContent
              content={text}
              className="reader-markdown [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
            />
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-6 text-danger-foreground">
              <AlertCircle className="mt-1 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <p className="rounded-md border bg-background px-3 py-2 text-sm leading-6 text-muted-foreground">
              {desktopAvailable
                ? llmReady
                  ? "这本书还没有生成文档级速览。"
                  : "配置 LLM API Key 后可生成文档级速览；点击生成会重新检测当前配置。"
                : "文档级速览需要桌面端后端生成。"}
            </p>
          )}
        </div>
      </section>
    </div>
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
