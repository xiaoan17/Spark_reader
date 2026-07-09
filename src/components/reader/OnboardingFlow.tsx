import { BookOpen, Check, Upload } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { OnboardingKeyForm } from "@/components/settings/OnboardingKeyForm"
import type { LlmSettings } from "@/core/library-api"

type OnboardingFlowProps = {
  open: boolean
  hasSampleBook: boolean
  desktopAvailable: boolean
  /** 跳过或完成:持久化「已看过」并关闭(由 ReaderShell 落地存储)。 */
  onClose: () => void
  /** 载入示例书,保持向导打开,让用户随后继续到配置步骤。 */
  onOpenSample: () => void
  /** 打开导入面板(会退出向导,由 ReaderShell 标记已看过)。 */
  onImport: () => void
  onLlmSettingsSaved?: (settings: LlmSettings) => void
  /** 仅供 story/测试指定初始步骤;正常使用始终从第 1 步开始。 */
  initialStep?: number
}

const STEP_TITLES = ["先体验示例书", "配置模型 key", "开始读自己的书"]

export function OnboardingFlow({
  open,
  hasSampleBook,
  desktopAvailable,
  onClose,
  onOpenSample,
  onImport,
  onLlmSettingsSaved,
  initialStep = 0,
}: OnboardingFlowProps) {
  const [step, setStep] = useState(initialStep)

  // 每次重新打开向导都回到初始步骤,避免停在上次退出的步骤。
  useEffect(() => {
    if (open) {
      setStep(initialStep)
    }
  }, [open, initialStep])

  if (!open) {
    return null
  }

  function goNext() {
    setStep((current) => Math.min(current + 1, STEP_TITLES.length - 1))
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0))
  }

  function handleOpenSample() {
    onOpenSample()
    goNext()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/75 px-4 py-14 text-foreground backdrop-blur"
      data-testid="onboarding-wizard"
    >
      <section className="w-full max-w-3xl overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              框选精读 · 首次上手
            </div>
            <div className="mt-1 text-lg font-semibold">
              第 {step + 1} 步 · {STEP_TITLES[step]}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            跳过引导
          </Button>
        </div>

        <StepIndicator step={step} />

        <div className="px-6 py-5">
          {step === 0 ? (
            <StepExperience hasSampleBook={hasSampleBook} onOpenSample={handleOpenSample} />
          ) : null}
          {step === 1 ? (
            <StepConfigureKey
              desktopAvailable={desktopAvailable}
              onLlmSettingsSaved={onLlmSettingsSaved}
            />
          ) : null}
          {step === 2 ? <StepStartReading onImport={onImport} /> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          {step > 0 ? (
            <Button variant="ghost" onClick={goBack}>
              上一步
            </Button>
          ) : (
            <span />
          )}
          {step < STEP_TITLES.length - 1 ? (
            <Button onClick={goNext}>下一步</Button>
          ) : (
            <Button onClick={onClose}>
              <Check className="mr-1.5 h-4 w-4" />
              完成
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex gap-2 px-6" aria-label="向导进度">
      {STEP_TITLES.map((title, index) => (
        <div
          key={title}
          className={cn(
            "flex items-center gap-1.5 text-xs",
            index === step ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
              index < step
                ? "bg-primary text-primary-foreground"
                : index === step
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {index < step ? <Check className="h-3 w-3" /> : index + 1}
          </span>
          <span className="hidden sm:inline">{title}</span>
        </div>
      ))}
    </div>
  )
}

function StepExperience({
  hasSampleBook,
  onOpenSample,
}: {
  hasSampleBook: boolean
  onOpenSample: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        先不用配置任何 key。示例书已预置一段选区，打开后
        <span className="text-foreground">框选一段试试</span>
        ，就能看到「选区 → 证据 → 引用回跳」的完整链路，这也是本地兜底解读的样子。
      </p>
      <div className="rounded-md border bg-background p-4">
        <div className="text-sm font-medium">示例书 · 无需 key</div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          连接 LLM key 后，同一套选区和证据会进入完整多轮检索解读。
        </p>
        <div className="mt-3">
          <Button onClick={onOpenSample} disabled={!hasSampleBook}>
            <BookOpen className="mr-1.5 h-4 w-4" />
            打开示例书
          </Button>
        </div>
      </div>
    </div>
  )
}

function StepConfigureKey({
  desktopAvailable,
  onLlmSettingsSaved,
}: {
  desktopAvailable: boolean
  onLlmSettingsSaved?: (settings: LlmSettings) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        要解析自己的 PDF 并跑完整解读，需要一个
        <span className="text-foreground">MinerU Token</span>
        （解析）和一个
        <span className="text-foreground">LLM Key</span>
        （解读）。保存后会就地测试连通，随时可以跳过、稍后在设置里补。
      </p>
      <OnboardingKeyForm desktopAvailable={desktopAvailable} onLlmSettingsSaved={onLlmSettingsSaved} />
    </div>
  )
}

function StepStartReading({ onImport }: { onImport: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        准备好了就导入自己的书。支持本地 PDF、Zotero 文献，或已有的 MinerU 输出目录。
      </p>
      <div className="rounded-md border bg-background p-4">
        <div className="text-sm font-medium">导入自己的 PDF</div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          导入后会生成可框选的转换稿；解析结果本地缓存，不重复消耗配额。
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={onImport}>
            <Upload className="mr-1.5 h-4 w-4" />
            导入自己的 PDF
          </Button>
        </div>
      </div>
    </div>
  )
}
