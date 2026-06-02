import type { StoredBookSummary } from "@/core/library-api"

export type LibraryShelfRange = "all" | "today" | "week" | "older"

export type LibraryShelfGroup = {
  id: Exclude<LibraryShelfRange, "all">
  title: string
  books: StoredBookSummary[]
}

export const libraryShelfRangeOptions: Array<{ id: LibraryShelfRange; label: string }> = [
  { id: "all", label: "全部" },
  { id: "today", label: "今天" },
  { id: "week", label: "本周" },
  { id: "older", label: "本月及以前" },
]

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfLocalWeek(date: Date) {
  const start = startOfLocalDay(date)
  const day = start.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  start.setDate(start.getDate() - daysFromMonday)
  return start
}

function libraryBookTimestamp(book: Pick<StoredBookSummary, "createdAt">) {
  const timestamp = Date.parse(book.createdAt)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function libraryBookRange(
  book: Pick<StoredBookSummary, "createdAt">,
  now = new Date(),
): Exclude<LibraryShelfRange, "all"> {
  const timestamp = libraryBookTimestamp(book)
  if (timestamp <= 0) {
    return "older"
  }
  const todayStart = startOfLocalDay(now).getTime()
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const weekStart = startOfLocalWeek(now).getTime()
  if (timestamp >= todayStart && timestamp < tomorrowStart.getTime()) {
    return "today"
  }
  if (timestamp >= weekStart) {
    return "week"
  }
  return "older"
}

function searchableLibraryBookText(book: StoredBookSummary) {
  return [
    book.title,
    book.parserEngine,
    book.coordinateMode,
    book.sourcePdfFingerprint ? "源 PDF" : "转换稿",
    book.originalPdfPath ? "可校对" : "",
    book.quality?.looksUsable === false ? "建议重解析" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function filterLibraryBooks(
  books: StoredBookSummary[],
  query: string,
  range: LibraryShelfRange,
  now = new Date(),
) {
  const normalizedQuery = query.trim().toLowerCase()
  return books.filter((book) => {
    if (range !== "all" && libraryBookRange(book, now) !== range) {
      return false
    }
    return !normalizedQuery || searchableLibraryBookText(book).includes(normalizedQuery)
  })
}

export function groupLibraryBooksByRange(
  books: StoredBookSummary[],
  now = new Date(),
): LibraryShelfGroup[] {
  const groups: LibraryShelfGroup[] = [
    { id: "today", title: "今天", books: [] },
    { id: "week", title: "本周", books: [] },
    { id: "older", title: "本月及以前", books: [] },
  ]
  const groupById = new Map(groups.map((group) => [group.id, group]))
  for (const book of books) {
    groupById.get(libraryBookRange(book, now))?.books.push(book)
  }
  return groups.filter((group) => group.books.length > 0)
}

export function formatLibraryBookDate(book: Pick<StoredBookSummary, "createdAt">) {
  const timestamp = libraryBookTimestamp(book)
  if (timestamp <= 0) {
    return ""
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(timestamp))
}
