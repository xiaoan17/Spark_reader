import { Library, Loader2, Search, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ZoteroSearchResult } from "@/core/library-api"

const ZOTERO_QUERY_MAX_LENGTH = 300

type ZoteroImportPanelProps = {
  open: boolean
  query: string
  results: ZoteroSearchResult[]
  status: "idle" | "searching" | "importing" | "error"
  message: string
  onQueryChange: (query: string) => void
  onSearch: () => void
  onImport: (result: ZoteroSearchResult) => void
  onClose: () => void
}

export function ZoteroImportPanel({
  open,
  query,
  results,
  status,
  message,
  onQueryChange,
  onSearch,
  onImport,
  onClose,
}: ZoteroImportPanelProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-background/70 px-4 py-16 text-foreground backdrop-blur">
      <section className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <div className="text-base font-semibold">从 Zotero 导入论文</div>
            <div className="mt-1 text-xs text-muted-foreground">
              搜索本机 Zotero 条目，选择带 PDF 的文献后会进入本地转换与阅读流程。
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        <form
          className="flex shrink-0 gap-2 border-b px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch()
          }}
        >
          <input
            className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="输入论文标题或关键词"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            maxLength={ZOTERO_QUERY_MAX_LENGTH}
            autoFocus
          />
          <Button type="submit" disabled={status === "searching" || status === "importing"}>
            {status === "searching" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-4 w-4" />
            )}
            搜索
          </Button>
        </form>
        {message ? (
          <div
            className={`border-b px-5 py-2 text-sm ${
              status === "error" ? "bg-danger/10 text-danger-foreground" : "bg-muted/50 text-muted-foreground"
            }`}
          >
            {message}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {results.length > 0 ? (
            <div className="space-y-2">
              {results.map((result) => (
                <article
                  key={result.itemKey}
                  className="flex items-start justify-between gap-4 rounded-md border bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-medium">{result.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {zoteroCreatorLine(result)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="secondary">{result.itemType || "item"}</Badge>
                      {result.year ? <Badge variant="secondary">{result.year}</Badge> : null}
                      <Badge variant={result.hasPdf ? "secondary" : "outline"}>
                        {result.hasPdf ? "PDF 可导入" : "无 PDF"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!result.hasPdf || status === "importing"}
                    onClick={() => onImport(result)}
                  >
                    {status === "importing" ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-1.5 h-4 w-4" />
                    )}
                    导入
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-md border border-dashed bg-background/70 p-8 text-center">
              <Library className="mb-3 h-9 w-9 text-muted-foreground" />
              <div className="text-sm font-medium">搜索 Zotero 文献库</div>
              <div className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Zotero 桌面端需要保持打开。搜索结果只显示本地条目，导入时读取本地 PDF 路径并交给 MinerU 云端解析。
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function zoteroCreatorLine(result: ZoteroSearchResult) {
  const creators =
    result.creators.length > 0 ? result.creators.slice(0, 3).join(", ") : "未知作者"
  const extra = result.creators.length > 3 ? " 等" : ""
  return [creators + extra, result.year].filter(Boolean).join(" · ")
}
