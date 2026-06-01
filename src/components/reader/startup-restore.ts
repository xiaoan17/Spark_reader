import type { LibraryStatus } from "@/stores/reader-store"
import type { StoredBookSummary } from "@/core/library-api"

export const READER_SESSION_STORAGE_KEY = "focused-reading.reader-session.v1"

export type StartupReaderView = "text" | "pdf" | "translation"

export type ReaderStartupSession = {
  bookId: string
  currentPage: number
  readerView: StartupReaderView
  zoom?: number
  updatedAt?: number
}

export type StartupRestoreTarget = {
  bookId: string
  currentPage?: number
  readerView?: StartupReaderView
  zoom?: number
  source: "last-session" | "most-recent"
}

export function nextAutoOpenBookId(
  canRestoreLibrary: boolean,
  currentBookId: string,
  libraryStatus: LibraryStatus,
  storedBooks: Pick<StoredBookSummary, "bookId">[],
) {
  return nextStartupRestoreTarget(
    canRestoreLibrary,
    currentBookId,
    libraryStatus,
    storedBooks,
    null,
  )?.bookId ?? null
}

export function nextStartupRestoreTarget(
  canRestoreLibrary: boolean,
  currentBookId: string,
  libraryStatus: LibraryStatus,
  storedBooks: Pick<StoredBookSummary, "bookId">[],
  session: ReaderStartupSession | null,
): StartupRestoreTarget | null {
  if (!canRestoreLibrary || currentBookId || libraryStatus !== "idle") {
    return null
  }
  if (session && storedBooks.some((book) => book.bookId === session.bookId)) {
    return {
      bookId: session.bookId,
      currentPage: session.currentPage,
      readerView: session.readerView,
      zoom: session.zoom,
      source: "last-session",
    }
  }
  const bookId = storedBooks[0]?.bookId
  return bookId ? { bookId, source: "most-recent" } : null
}

export function parseStartupSession(raw: string | null): ReaderStartupSession | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderStartupSession>
    if (!parsed || typeof parsed.bookId !== "string" || !parsed.bookId.trim()) {
      return null
    }
    const currentPage =
      typeof parsed.currentPage === "number" && Number.isFinite(parsed.currentPage)
        ? Math.max(1, Math.floor(parsed.currentPage))
        : 1
    const readerView =
      parsed.readerView === "pdf"
        ? "pdf"
        : parsed.readerView === "translation"
          ? "translation"
          : "text"
    const zoom =
      typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)
        ? Math.min(2.2, Math.max(0.6, parsed.zoom))
        : undefined
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : undefined

    return {
      bookId: parsed.bookId,
      currentPage,
      readerView,
      zoom,
      updatedAt,
    }
  } catch {
    return null
  }
}

export function serializeStartupSession(session: ReaderStartupSession) {
  return JSON.stringify({
    bookId: session.bookId,
    currentPage: Math.max(1, Math.floor(session.currentPage)),
    readerView:
      session.readerView === "pdf"
        ? "pdf"
        : session.readerView === "translation"
          ? "translation"
          : "text",
    zoom:
      typeof session.zoom === "number" && Number.isFinite(session.zoom)
        ? Math.min(2.2, Math.max(0.6, session.zoom))
        : undefined,
    updatedAt: session.updatedAt,
  })
}
