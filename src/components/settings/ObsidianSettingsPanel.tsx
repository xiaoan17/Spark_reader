import { CheckCircle2, FolderInput, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

export type ObsidianSettingsStatus = "idle" | "loading" | "saving" | "ok" | "error"

export const OBSIDIAN_SUBDIR_PLACEHOLDER = "框选精读"

type ObsidianSettingsPanelProps = {
  open: boolean
  vaultPath: string
  subdir: string
  configured: boolean
  status?: ObsidianSettingsStatus
  message?: string
  desktopAvailable?: boolean
  onVaultPathChange: (value: string) => void
  onSubdirChange: (value: string) => void
  onSave: () => void
  onClose: () => void
}

export function ObsidianSettingsPanel({
  open,
  vaultPath,
  subdir,
  configured,
  status = "idle",
  message = "",
  desktopAvailable = true,
  onVaultPathChange,
  onSubdirChange,
  onSave,
  onClose,
}: ObsidianSettingsPanelProps) {
  if (!open) {
    return null
  }

  const loading = status === "loading"
  const saving = status === "saving"
  const busy = loading || saving

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 p-4"
      data-testid="obsidian-settings-panel"
    >
      <div className="max-h-[calc(100vh-2rem)] w-[520px] overflow-auto rounded-lg border bg-card text-card-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-base font-semibold">
              <FolderInput className="h-4 w-4 text-muted-foreground" />
              Obsidian 导出
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              高亮、Spark 解读和知识册会追加写入你的 vault。
            </p>
          </div>
          {configured ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已配置
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center rounded-md border px-2 py-1 text-xs text-muted-foreground">
              未配置
            </span>
          )}
        </div>

        <div className="space-y-4 border-b p-4 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取 Obsidian 设置…
            </div>
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Vault 路径</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              placeholder="/Users/you/Obsidian/我的库"
              value={vaultPath}
              disabled={busy}
              onChange={(event) => onVaultPathChange(event.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              留空并保存可清除配置。
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">子目录</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              placeholder={OBSIDIAN_SUBDIR_PLACEHOLDER}
              value={subdir}
              disabled={busy}
              onChange={(event) => onSubdirChange(event.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              留空则默认写入「{OBSIDIAN_SUBDIR_PLACEHOLDER}」。
            </span>
          </label>

          {message ? (
            <div className="flex gap-2 rounded-md bg-muted p-2 text-xs">
              {status === "ok" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
              {status === "error" ? <XCircle className="h-4 w-4 text-danger" /> : null}
              <span>{message}</span>
            </div>
          ) : null}

          {!desktopAvailable ? (
            <p className="text-[11px] text-muted-foreground">
              Obsidian 导出需要桌面版。
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button disabled={busy} onClick={onSave}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            保存 Obsidian
          </Button>
        </div>
      </div>
    </div>
  )
}
