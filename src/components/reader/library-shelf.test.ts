import { describe, expect, it } from "vitest"
import type { StoredBookSummary } from "@/core/library-api"
import { filterLibraryBooks, groupLibraryBooksByRange, libraryBookRange } from "./library-shelf"

function storedBook(overrides: Partial<StoredBookSummary> = {}): StoredBookSummary {
  return {
    bookId: "book-1",
    title: "测试图书",
    totalPages: 10,
    parserEngine: "mineru-layout",
    coordinateMode: "normalized-page-rects",
    textCharCount: 1000,
    markdownCharCount: 1200,
    chunkCount: 12,
    createdAt: "2026-06-03T08:00:00",
    textPath: "",
    markdownPath: "",
    originalPdfPath: "",
    sourcePdfPath: "",
    sourcePdfFingerprint: "",
    quality: null,
    ...overrides,
  }
}

describe("library shelf helpers", () => {
  it("groups books by local recency range", () => {
    const now = new Date("2026-06-03T12:00:00")
    const todayBook = storedBook({
      bookId: "book-today",
      title: "今日论文",
      createdAt: "2026-06-03T01:30:00",
    })
    const weekBook = storedBook({
      bookId: "book-week",
      title: "本周论文",
      createdAt: "2026-06-02T08:00:00",
    })
    const olderBook = storedBook({
      bookId: "book-older",
      title: "上月旧书",
      createdAt: "2026-05-10T08:00:00",
    })

    expect(libraryBookRange(todayBook, now)).toBe("today")
    expect(libraryBookRange(weekBook, now)).toBe("week")
    expect(libraryBookRange(olderBook, now)).toBe("older")
    expect(groupLibraryBooksByRange([todayBook, weekBook, olderBook], now).map((group) => [
      group.title,
      group.books.map((book) => book.bookId),
    ])).toEqual([
      ["今天", ["book-today"]],
      ["本周", ["book-week"]],
      ["本月及以前", ["book-older"]],
    ])
  })

  it("filters by parser metadata and recency", () => {
    const now = new Date("2026-06-03T12:00:00")
    const todayBook = storedBook({
      bookId: "book-today",
      title: "今日论文",
      createdAt: "2026-06-03T01:30:00",
      parserEngine: "mineru-layout",
    })
    const weekBook = storedBook({
      bookId: "book-week",
      title: "本周论文",
      createdAt: "2026-06-02T08:00:00",
      parserEngine: "pymupdf",
    })
    const olderBook = storedBook({
      bookId: "book-older",
      title: "上月旧书",
      createdAt: "2026-05-10T08:00:00",
      parserEngine: "unknown",
    })

    expect(filterLibraryBooks([todayBook, weekBook, olderBook], "pymupdf", "all", now)).toEqual([
      weekBook,
    ])
    expect(filterLibraryBooks([todayBook, weekBook, olderBook], "", "today", now)).toEqual([
      todayBook,
    ])
  })
})
