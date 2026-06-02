import { BookOpen, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

type OnboardingFlowProps = {
  open: boolean
  hasSampleBook: boolean
  onClose: () => void
  onOpenSample: () => void
  onImport: () => void
}

export function OnboardingFlow({
  open,
  hasSampleBook,
  onClose,
  onOpenSample,
  onImport,
}: OnboardingFlowProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/75 px-4 py-14 text-foreground backdrop-blur">
      <section className="w-full max-w-3xl overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <div className="text-lg font-semibold">先看一次框选精读链路</div>
            <div className="mt-1 text-sm text-muted-foreground">
              不配置 key 也能先体验选区、证据和引用回跳。
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-3">
          <OnboardingStep
            index={1}
            title="框选一段"
            description="示例书会预置一段选区，让你直接看到阅读焦点如何被固定。"
          />
          <OnboardingStep
            index={2}
            title="查看证据"
            description="每个关键判断都会带上可点击引用，点一下就能回到原文核对。"
          />
          <OnboardingStep
            index={3}
            title="再导入 PDF"
            description="熟悉链路后再选择本地 PDF、Zotero 文献或已有 MinerU 输出。"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="max-w-md text-xs leading-5 text-muted-foreground">
            示例书使用本地兜底解读展示产品主流程；连接 LLM key 后，同一套选区和证据会进入完整多轮检索解读。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onImport}>
              <Upload className="mr-1.5 h-4 w-4" />
              导入自己的 PDF
            </Button>
            <Button onClick={onOpenSample} disabled={!hasSampleBook}>
              <BookOpen className="mr-1.5 h-4 w-4" />
              打开示例书
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

type OnboardingStepProps = {
  index: number
  title: string
  description: string
}

function OnboardingStep({ index, title, description }: OnboardingStepProps) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
        {index}
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  )
}
