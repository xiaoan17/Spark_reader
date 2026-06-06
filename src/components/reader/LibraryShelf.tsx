import { Library, RefreshCw, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { StoredBookSummary } from "@/core/library-api"
import {
  filterLibraryBooks,
  formatLibraryBookDate,
  groupLibraryBooksByRange,
  libraryShelfRangeOptions,
  type LibraryShelfGroup,
  type LibraryShelfRange,
} from "./library-shelf"

type LibraryShelfProps = {
  open: boolean
  books: StoredBookSummary[]
  activeBookId: string
  persistenceLabel: string
  onClose: () => void
  onRefresh: () => void
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

export function LibraryShelf({
  open,
  books,
  activeBookId,
  persistenceLabel,
  onClose,
  onRefresh,
  onOpen,
  onDelete,
}: LibraryShelfProps) {
  const [query, setQuery] = useState("")
  const [range, setRange] = useState<LibraryShelfRange>("all")
  const filteredBooks = useMemo(
    () => filterLibraryBooks(books, query, range),
    [books, query, range],
  )
  const groups = useMemo(() => {
    if (range === "all") {
      return groupLibraryBooksByRange(filteredBooks)
    }
    if (filteredBooks.length === 0) {
      return []
    }
    return [
      {
        id: range,
        title: libraryShelfRangeOptions.find((option) => option.id === range)?.label ?? "书籍",
        books: filteredBooks,
      } as LibraryShelfGroup,
    ]
  }, [filteredBooks, range])
  const hasFilters = query.trim() || range !== "all"
  const visibleCountLabel =
    books.length > 0 && filteredBooks.length !== books.length
      ? `显示 ${filteredBooks.length} / ${books.length} 本`
      : books.length > 0
        ? `${books.length} 本已转换图书`
        : persistenceLabel

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background/95 text-foreground backdrop-blur">
      <div className="flex h-14 shrink-0 items-center justify-between border-b bg-card/80 px-5">
        <div>
          <div className="text-base font-semibold">书架</div>
          <div className="text-xs text-muted-foreground">{visibleCountLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {books.length > 0 ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-lg border bg-card/70 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="搜索书名、解析器或标签"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="flex shrink-0 rounded-md border bg-background p-1" aria-label="书架时间筛选">
                {libraryShelfRangeOptions.map((option) => (
                  <Button
                    key={option.id}
                    size="sm"
                    variant={range === option.id ? "secondary" : "ghost"}
                    className="h-7 px-2.5"
                    onClick={() => setRange(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            {groups.length > 0 ? (
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.id} className="space-y-3" aria-label={group.title}>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{group.title}</div>
                      <Badge variant="secondary">{group.books.length} 本</Badge>
                    </div>
                    <LibraryBookGrid
                      books={group.books}
                      allBooks={books}
                      activeBookId={activeBookId}
                      onOpen={onOpen}
                      onDelete={onDelete}
                    />
                  </section>
                ))}
              </div>
            ) : (
              <div className="mx-auto flex min-h-[48vh] max-w-md flex-col items-center justify-center text-center">
                <Search className="mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-lg font-semibold">没有匹配的图书</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {hasFilters ? "换一个关键词或时间分段试试。" : "当前书架没有可显示的图书。"}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
            <Library className="mb-4 h-10 w-10 text-muted-foreground" />
            <div className="text-lg font-semibold">还没有转换图书</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              导入 PDF、TXT 或 EPUB 后会生成 Markdown 转换稿和本地索引，之后会以封面卡片出现在这里。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type LibraryBookGridProps = {
  books: StoredBookSummary[]
  allBooks: StoredBookSummary[]
  activeBookId: string
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

function LibraryBookGrid({
  books,
  allBooks,
  activeBookId,
  onOpen,
  onDelete,
}: LibraryBookGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {books.map((book) => {
        const index = Math.max(0, allBooks.findIndex((candidate) => candidate.bookId === book.bookId))
        return (
          <article
            key={book.bookId}
            className={`group overflow-hidden rounded-lg border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              book.bookId === activeBookId ? "ring-2 ring-primary" : ""
            }`}
          >
            <button className="block w-full text-left" onClick={() => onOpen(book.bookId)}>
              <div
                className={`flex aspect-[3/4] flex-col justify-between p-4 text-primary-foreground ${coverClassName(index)}`}
              >
                <div>
                  <div className="line-clamp-4 text-lg font-semibold leading-6">
                    {book.title || "未命名图书"}
                  </div>
                  <div className="mt-2 h-1 w-10 rounded-full bg-white/70" />
                </div>
                <div className="space-y-1 text-xs text-white/85">
                  <div>{book.totalPages || 0} 页</div>
                  <div>{book.parserEngine || "unknown"}</div>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <div className="line-clamp-2 text-sm font-medium">{book.title}</div>
                <div className="truncate text-xs text-muted-foreground">{book.textCharCount} 字</div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{sourceKindLabel(book)}</Badge>
                  {book.originalPdfPath.toLowerCase().endsWith(".pdf") ? <Badge variant="secondary">可校对</Badge> : null}
                  {book.quality?.looksUsable === false ? <Badge variant="secondary">建议重解析</Badge> : null}
                  <LibraryBookDateBadge book={book} />
                </div>
              </div>
            </button>
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="truncate text-xs text-muted-foreground">
                {book.coordinateMode || "text-only"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-red-700"
                aria-label={`删除 ${book.title}`}
                onClick={() => onDelete(book.bookId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function sourceKindLabel(book: StoredBookSummary) {
  if (book.parserEngine === "text-import-epub") {
    return "EPUB"
  }
  if (book.parserEngine === "text-import-txt") {
    return "TXT"
  }
  return book.sourcePdfFingerprint ? "源 PDF" : "转换稿"
}

function LibraryBookDateBadge({ book }: { book: StoredBookSummary }) {
  const label = formatLibraryBookDate(book)
  return label ? <Badge variant="outline">{label}</Badge> : null
}

function coverClassName(index: number) {
  const classes = [
    "bg-[linear-gradient(135deg,hsl(164_48%_28%),hsl(33_72%_46%))]",
    "bg-[linear-gradient(135deg,hsl(214_46%_30%),hsl(146_38%_36%))]",
    "bg-[linear-gradient(135deg,hsl(344_42%_34%),hsl(41_74%_45%))]",
    "bg-[linear-gradient(135deg,hsl(188_48%_28%),hsl(12_58%_42%))]",
    "bg-[linear-gradient(135deg,hsl(260_30%_34%),hsl(152_42%_34%))]",
  ]
  return classes[index % classes.length]
}
