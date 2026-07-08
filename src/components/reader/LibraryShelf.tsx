import { Library, RefreshCw, Search, Trash2, TriangleAlert } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
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
  const [pendingDeleteBook, setPendingDeleteBook] = useState<StoredBookSummary | null>(null)
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

  function requestDeleteBook(bookId: string) {
    const book = books.find((candidate) => candidate.bookId === bookId) ?? null
    setPendingDeleteBook(book)
  }

  function confirmPendingDelete() {
    if (pendingDeleteBook) {
      onDelete(pendingDeleteBook.bookId)
    }
    setPendingDeleteBook(null)
  }

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
                      activeBookId={activeBookId}
                      onOpen={onOpen}
                      onDelete={requestDeleteBook}
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
      <DeleteBookDialog
        book={pendingDeleteBook}
        onCancel={() => setPendingDeleteBook(null)}
        onConfirm={confirmPendingDelete}
      />
    </div>
  )
}

type DeleteBookDialogProps = {
  book: StoredBookSummary | null
  onCancel: () => void
  onConfirm: () => void
}

function DeleteBookDialog({ book, onCancel, onConfirm }: DeleteBookDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!book) {
      return
    }
    cancelRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [book, onCancel])

  if (!book) {
    return null
  }

  const bookTitle = book.title || "未命名图书"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-book-dialog-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border bg-card p-5 text-card-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div id="delete-book-dialog-title" className="text-base font-semibold">
              删除《{bookTitle}》？
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              该书的解析结果、高亮与解读历史将一并删除，不可恢复。
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            className="bg-danger text-danger-foreground hover:bg-danger/90"
            onClick={onConfirm}
          >
            确认删除
          </Button>
        </div>
      </div>
    </div>
  )
}

type LibraryBookGridProps = {
  books: StoredBookSummary[]
  activeBookId: string
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

function LibraryBookGrid({
  books,
  activeBookId,
  onOpen,
  onDelete,
}: LibraryBookGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {books.map((book) => {
        return (
          <article
            key={book.bookId}
            className={`group overflow-hidden rounded-lg border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              book.bookId === activeBookId ? "ring-2 ring-primary" : ""
            }`}
          >
            <button className="block w-full text-left" onClick={() => onOpen(book.bookId)}>
              <div className="relative flex aspect-[3/4] flex-col justify-between overflow-hidden border-b bg-card p-4 pl-5 text-card-foreground">
                {/* Teal 书脊：克制的单色强调，替代被品牌禁止的大面积渐变 */}
                <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
                <div>
                  <div className="flex items-start gap-1.5">
                    <h3 className="line-clamp-4 font-reading text-lg font-semibold leading-7">
                      {book.title || "未命名图书"}
                    </h3>
                    {/* spark 收敛为一个点，而非整面发光 */}
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  </div>
                </div>
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div>{book.totalPages || 0} 页 · {book.textCharCount} 字</div>
                  <div className="truncate">{book.parserEngine || "unknown"}</div>
                </div>
              </div>
              <div className="space-y-2 p-3">
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
                className="h-7 w-7 text-muted-foreground hover:text-danger"
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
