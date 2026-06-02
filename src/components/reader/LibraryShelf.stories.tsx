import type { Meta, StoryObj } from "@storybook/react"
import { LibraryShelf } from "./LibraryShelf"
import type { StoredBookSummary } from "@/core/library-api"

const books: StoredBookSummary[] = [
  {
    bookId: "book-wealth",
    title: "财富公式",
    totalPages: 163,
    chunkCount: 320,
    textCharCount: 120000,
    markdownCharCount: 135000,
    textPath: "/tmp/wealth.txt",
    markdownPath: "/tmp/wealth.md",
    originalPdfPath: "/tmp/wealth.pdf",
    sourcePdfPath: "/tmp/wealth.pdf",
    sourcePdfFingerprint: "sha256:wealth",
    parserEngine: "mineru-layout",
    coordinateMode: "normalized-page-rects",
    quality: {
      charCount: 120000,
      replacementCharRatio: 0,
      controlCharRatio: 0,
      looksUsable: true,
    },
    createdAt: "2026-06-03T01:30:00",
  },
  {
    bookId: "book-paper",
    title: "Retrieval-Augmented Generation Survey",
    totalPages: 42,
    chunkCount: 90,
    textCharCount: 48000,
    markdownCharCount: 56000,
    textPath: "/tmp/rag.txt",
    markdownPath: "/tmp/rag.md",
    originalPdfPath: "",
    sourcePdfPath: "",
    sourcePdfFingerprint: "",
    parserEngine: "pdfjs",
    coordinateMode: "text-only",
    quality: null,
    createdAt: "2026-06-02T08:00:00",
  },
]

const meta = {
  title: "Reader/LibraryShelf",
  component: LibraryShelf,
  args: {
    open: true,
    books,
    activeBookId: "book-wealth",
    persistenceLabel: "导入后保存到本机书库，下次会优先直接打开",
    onClose: () => undefined,
    onRefresh: () => undefined,
    onOpen: () => undefined,
    onDelete: () => undefined,
  },
} satisfies Meta<typeof LibraryShelf>

export default meta
type Story = StoryObj<typeof meta>

export const WithBooks: Story = {}

export const Empty: Story = {
  args: {
    books: [],
    activeBookId: "",
  },
}

export const Closed: Story = {
  args: {
    open: false,
  },
}
