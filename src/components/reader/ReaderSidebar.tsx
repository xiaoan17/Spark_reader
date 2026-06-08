import { Search } from "lucide-react"
import { ReaderOutlinePanel } from "./ReaderOutlinePanel"
import type { ReaderChunkSearchResult } from "./search-results"
import type { ReaderOutlineEntry } from "./reader-outline"
import type { ConvertedTextOutlineTarget } from "./ConvertedTextReader"
import type { ParsedChunk, ParsedPage } from "@/stores/reader-store"

type SearchPageResult = { page: ParsedPage }

type ReaderSidebarProps = {
  sidebarOpen: boolean
  searchOpen: boolean
  searchQuery: string
  searchStatus: "idle" | "searching" | "fallback"
  chunkResults: ReaderChunkSearchResult[]
  pageResults: SearchPageResult[]
  showReaderOutline: boolean
  readerOutline: ReaderOutlineEntry[]
  currentPage: number
  outlineTarget: ConvertedTextOutlineTarget | null
  hasParsedPages: boolean
  onSearchQueryChange: (query: string) => void
  onSelectChunk: (chunk: ParsedChunk) => void
  onSelectPage: (pageIndex: number) => void
  onSelectOutline: (entry: ReaderOutlineEntry) => void
}

/**
 * Left reader sidebar: full-text search panel + chapter outline. Pure presentation;
 * search/outline state and handlers are owned by ReaderShell (UI-UX §7).
 */
export function ReaderSidebar({
  sidebarOpen,
  searchOpen,
  searchQuery,
  searchStatus,
  chunkResults,
  pageResults,
  showReaderOutline,
  readerOutline,
  currentPage,
  outlineTarget,
  hasParsedPages,
  onSearchQueryChange,
  onSelectChunk,
  onSelectPage,
  onSelectOutline,
}: ReaderSidebarProps) {
  return (
    <aside
      aria-hidden={!sidebarOpen}
      className={`flex min-h-0 flex-col overflow-hidden border-r bg-card/45 p-3 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
        sidebarOpen
          ? "pointer-events-auto translate-x-0 opacity-100"
          : "pointer-events-none -translate-x-3 opacity-0"
      }`}
    >
      {searchOpen ? (
        <div className="mb-3 shrink-0 rounded-md border bg-background p-2 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            全文索引
          </div>
          <input
            className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="搜索目录和正文"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
          {searchQuery.trim() ? (
            <div className="mt-2 max-h-72 space-y-1 overflow-auto pr-1">
              {searchStatus === "searching" ? (
                <div className="rounded-md bg-muted px-2 py-2 text-muted-foreground">
                  正在搜索
                </div>
              ) : null}
              {searchStatus === "fallback" ? (
                <div className="rounded-md bg-muted px-2 py-2 text-muted-foreground">
                  使用内存搜索
                </div>
              ) : null}
              {chunkResults.length > 0 ? (
                chunkResults.map(({ chunk, snippet }) => (
                  <button
                    key={chunk.chunkId}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => onSelectChunk(chunk)}
                  >
                    <span className="font-medium">相关段落</span>
                    <span className="mt-1 block line-clamp-2 text-muted-foreground">
                      {stripSearchMarkup(snippet || chunk.text).slice(0, 90)}
                    </span>
                  </button>
                ))
              ) : pageResults.length > 0 ? (
                pageResults.map(({ page }) => (
                  <button
                    key={page.pageIndex}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => onSelectPage(page.pageIndex)}
                  >
                    <span className="font-medium">正文匹配</span>
                    <span className="mt-1 block line-clamp-2 text-muted-foreground">
                      {page.text.slice(0, 90)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rounded-md bg-muted px-2 py-2 text-muted-foreground">
                  没有匹配结果
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {showReaderOutline && readerOutline.length > 0 ? (
        <ReaderOutlinePanel
          entries={readerOutline}
          currentPage={currentPage}
          activeEntryId={
            outlineTarget && outlineTarget.pageIndex + 1 === currentPage
              ? outlineTarget.entryId
              : undefined
          }
          className="flex-1"
          onSelect={onSelectOutline}
        />
      ) : null}
      {showReaderOutline && readerOutline.length === 0 ? (
        <div className="min-h-0 flex-1 rounded-md border border-dashed bg-background px-3 py-8 text-center text-xs text-muted-foreground">
          {hasParsedPages ? "未识别到章节标题目录" : "导入书籍后显示目录"}
        </div>
      ) : null}
    </aside>
  )
}

function stripSearchMarkup(value: string) {
  return value.replaceAll("<mark>", "").replaceAll("</mark>", "")
}
