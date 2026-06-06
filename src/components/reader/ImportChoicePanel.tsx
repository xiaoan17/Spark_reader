import { BookOpen, FileText, FolderOpen, Library, Upload } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

type ImportChoicePanelProps = {
  open: boolean
  isDesktop: boolean
  isBusy: boolean
  hasSampleBook: boolean
  onClose: () => void
  onImportPdf: () => void
  onImportTextBook: () => void
  onImportZotero: () => void
  onImportMineruOutput: () => void
  onOpenSample: () => void
}

export function ImportChoicePanel({
  open,
  isDesktop,
  isBusy,
  hasSampleBook,
  onClose,
  onImportPdf,
  onImportTextBook,
  onImportZotero,
  onImportMineruOutput,
  onOpenSample,
}: ImportChoicePanelProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-background/70 px-4 py-16 text-foreground backdrop-blur">
      <section className="w-full max-w-2xl overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <div className="text-base font-semibold">选择导入方式</div>
            <div className="mt-1 text-xs text-muted-foreground">
              先打开示例书体验框选，也可以导入本地 PDF、TXT / EPUB 电子书、Zotero 文献或 MinerU 输出目录。
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          <ImportChoiceButton
            icon={<Upload className="h-4 w-4" />}
            title="本地 PDF"
            ariaLabel="导入本地 PDF"
            description={isDesktop ? "选择文件后上传 MinerU 云端解析。" : "浏览器版会在本地抽取可检索文本。"}
            disabled={isBusy}
            onClick={onImportPdf}
          />
          <ImportChoiceButton
            icon={<FileText className="h-4 w-4" />}
            title="TXT / EPUB"
            ariaLabel="导入 TXT 或 EPUB 电子书"
            description={isDesktop ? "本地解析为可检索转换稿，不消耗 MinerU 配额。" : "桌面版可导入 TXT / EPUB 电子书。"}
            tooltip={isDesktop ? undefined : "此功能需要桌面版"}
            disabled={isBusy || !isDesktop}
            onClick={onImportTextBook}
          />
          <ImportChoiceButton
            icon={<Library className="h-4 w-4" />}
            title="Zotero 文献"
            ariaLabel="从 Zotero 导入"
            description={isDesktop ? "搜索本机 Zotero，导入带 PDF 的条目。" : "桌面版可读取本机 Zotero 库。"}
            tooltip={isDesktop ? undefined : "此功能需要桌面版"}
            disabled={isBusy || !isDesktop}
            onClick={onImportZotero}
          />
          <ImportChoiceButton
            icon={<FolderOpen className="h-4 w-4" />}
            title="MinerU 输出目录"
            ariaLabel="导入 MinerU 输出目录"
            description={isDesktop ? "直接读取已有 layout/full.md 结果。" : "桌面版可读取本地目录。"}
            tooltip={isDesktop ? undefined : "此功能需要桌面版"}
            disabled={isBusy || !isDesktop}
            onClick={onImportMineruOutput}
          />
          <ImportChoiceButton
            icon={<BookOpen className="h-4 w-4" />}
            title="示例书"
            ariaLabel="打开示例书"
            description="无需配置 key，直接体验框选、引用与本地兜底解读。"
            disabled={isBusy || !hasSampleBook}
            onClick={onOpenSample}
          />
        </div>
      </section>
    </div>
  )
}

type ImportChoiceButtonProps = {
  icon: ReactNode
  title: string
  ariaLabel: string
  description: string
  tooltip?: string
  disabled: boolean
  onClick: () => void
}

function ImportChoiceButton({
  icon,
  title,
  ariaLabel,
  description,
  tooltip,
  disabled,
  onClick,
}: ImportChoiceButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={tooltip}
      className="flex min-h-24 items-start gap-3 rounded-md border bg-background p-3 text-left transition-colors duration-200 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-background"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
