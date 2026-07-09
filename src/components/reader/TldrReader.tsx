import { AlertCircle, Check, FileSearch, Loader2, RefreshCw, Sparkles, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MarkdownContent } from "@/components/markdown/MarkdownContent"
import type { TldrProgress } from "@/stores/reader-store"
import type { ReaderDisplayThemeStyle } from "./reader-display-theme"

export type TldrReaderProps = {
  text?: string
  generatedAt?: string
  model?: string
  loading?: boolean
  progress?: TldrProgress | null
  error?: string
  desktopAvailable?: boolean
  llmReady?: boolean
  displayThemeStyle?: ReaderDisplayThemeStyle
  onGenerate?: () => void
  onRegenerate?: () => void
  onCancel?: () => void
}

const TLDR_STEPS = [
  { key: "structureAnalysis", label: "结构分析" },
  { key: "sampling", label: "章节抽样" },
  { key: "synthesizing", label: "综合生成" },
] as const

export function TldrReader({
  text = "",
  generatedAt = "",
  model = "",
  loading = false,
  progress = null,
  error = "",
  desktopAvailable = true,
  llmReady = true,
  displayThemeStyle,
  onGenerate,
  onRegenerate,
  onCancel,
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
          {loading && onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <Square className="mr-1.5 h-4 w-4" />
              停止生成
            </Button>
          ) : (
            <Button size="sm" variant={hasText ? "ghost" : "secondary"} disabled={!canGenerate} onClick={action}>
              {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              {actionLabel}
            </Button>
          )}
        </div>

        <div className="mt-6">
          {loading ? (
            <TldrProgressSteps progress={progress} />
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

function TldrProgressSteps({ progress }: { progress?: TldrProgress | null }) {
  // Before the first event lands, treat the run as starting at structure analysis.
  const activeStage = progress?.stage ?? "structureAnalysis"
  const activeIndex = TLDR_STEPS.findIndex((step) => step.key === activeStage)
  const engineLabel =
    progress?.engine === "codex" ? "Codex 深读" : progress?.engine === "rust" ? "本地速览" : ""

  return (
    <div className="animate-fade-in space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">正在生成文档级速览</p>
        {engineLabel ? <Badge variant="secondary">{engineLabel}</Badge> : null}
      </div>
      <ol className="space-y-2">
        {TLDR_STEPS.map((step, index) => {
          const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending"
          const detail =
            step.key === "sampling" && state === "active" && (progress?.sampled ?? 0) > 0
              ? `已抽样 ${progress?.sampled} 处章节`
              : state === "active"
                ? progress?.message ?? ""
                : ""
          return (
            <li
              key={step.key}
              className="reader-panel-card flex items-start gap-2 rounded-md border px-3 py-2"
              style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
            >
              <StepIcon state={state} />
              <div className="min-w-0">
                <div
                  className={
                    state === "pending"
                      ? "text-sm text-muted-foreground"
                      : "text-sm font-medium"
                  }
                >
                  {step.label}
                </div>
                {detail ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return <Check className="reader-panel-accent mt-0.5 h-4 w-4 shrink-0" />
  }
  if (state === "active") {
    return <Loader2 className="reader-panel-accent mt-0.5 h-4 w-4 shrink-0 animate-spin" />
  }
  return <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
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
