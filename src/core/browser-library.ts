import type {
  ConvertedBookAsset,
  SaveHighlightRequest,
  SaveInterpretationRequest,
  SaveParsedBookResponse,
  StoredBookSummary,
} from "@/core/library-api"
import { COORDINATE_VERSION } from "@/core/coordinates"
import type { ParsedChunk, ParsedPage, SavedHighlight, SavedInterpretation, TextQuality } from "@/stores/reader-store"
import { normalizeParsedChunkIds, hashString } from "@/core/chunk-id"

type BrowserBookRecord = ConvertedBookAsset &
  Omit<StoredBookSummary, "createdAt"> & {
    createdAt: number
  }

type SaveBrowserBookRequest = {
  title: string
  totalPages: number
  parserEngine: string
  coordinateMode: string
  quality?: TextQuality | null
  sourcePdfPath?: string | null
  sourcePdfFingerprint?: string | null
  pages: ParsedPage[]
  chunks: ParsedChunk[]
}

const DB_NAME = "focused-reading.browser-library.v1"
const DB_VERSION = 2
const BOOKS_STORE = "books"
const HIGHLIGHTS_STORE = "highlights"
const INTERPRETATIONS_STORE = "interpretations"

export function browserLibraryAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window
}

export function browserPdfFingerprint(file: File) {
  return `browser-pdf:${file.name}:${file.size}:${file.lastModified}`
}

export async function saveBrowserBook(
  request: SaveBrowserBookRequest,
): Promise<SaveParsedBookResponse> {
  const text = request.pages.map((page) => page.text).join("\n\n")
  const markdown = request.pages.map((page) => page.markdown).join("\n\n")
  const bookId = stableBrowserBookId(request, text)
  const chunks = normalizeParsedChunkIds(bookId, request.chunks).map((chunk) => ({
    ...chunk,
    coordinateVersion: chunk.coordinateVersion ?? COORDINATE_VERSION,
  }))
  const now = Date.now()
  const record: BrowserBookRecord = {
    bookId,
    title: request.title.trim() || "converted-book",
    totalPages: request.totalPages,
    text,
    markdown,
    textPath: `indexeddb://${bookId}.txt`,
    markdownPath: `indexeddb://${bookId}.md`,
    originalPdfPath: "",
    sourcePdfPath: request.sourcePdfPath || "",
    sourcePdfFingerprint: request.sourcePdfFingerprint || "",
    parserEngine: request.parserEngine || "pdfjs",
    coordinateMode: request.coordinateMode || "text-only",
    quality: request.quality,
    tldrText: null,
    tldrGeneratedAt: null,
    tldrModel: null,
    tldrSourceVersion: null,
    pages: request.pages,
    chunks,
    chunkCount: chunks.length,
    textCharCount: text.length,
    markdownCharCount: markdown.length,
    createdAt: now,
  }

  const db = await openBrowserLibrary()
  await putRecord(db, record)
  return responseFromRecord(record)
}

export async function listBrowserBooks(): Promise<StoredBookSummary[]> {
  const db = await openBrowserLibrary()
  const records = await getAllRecords(db)
  return records
    .sort((left, right) => right.createdAt - left.createdAt)
    .map(summaryFromRecord)
}

export async function getBrowserBook(bookId: string): Promise<ConvertedBookAsset> {
  const db = await openBrowserLibrary()
  const record = await getRecord(db, bookId)
  if (!record) {
    throw new Error(`book not found: ${bookId}`)
  }
  return assetFromRecord(record)
}

export async function deleteBrowserBook(bookId: string) {
  const db = await openBrowserLibrary()
  await deleteBookRecord(db, bookId)
}

export async function findBrowserBookBySourceFingerprint(
  sourcePdfFingerprint: string,
): Promise<StoredBookSummary | null> {
  if (!sourcePdfFingerprint) {
    return null
  }
  const books = await listBrowserBooks()
  return books.find((book) => book.sourcePdfFingerprint === sourcePdfFingerprint) ?? null
}

export async function saveBrowserHighlight(request: SaveHighlightRequest): Promise<SavedHighlight> {
  const now = new Date().toISOString()
  const highlight: SavedHighlight = {
    id: `browser-highlight-${hashString(`${request.bookId}\u001f${request.selectionText}\u001f${Date.now()}\u001f${Math.random()}`)}`,
    bookId: request.bookId,
    selectionText: request.selectionText,
    prefix: request.prefix,
    suffix: request.suffix,
    pageIndex: request.pageIndex ?? null,
    positionStart: request.positionStart ?? null,
    positionEnd: request.positionEnd ?? null,
    rects: request.rects,
    coordinateVersion: request.coordinateVersion ?? COORDINATE_VERSION,
    interpretation: request.interpretation ?? null,
    createdAt: now,
  }
  const db = await openBrowserLibrary()
  await putStoreRecord(db, HIGHLIGHTS_STORE, highlight)
  return highlight
}

export async function listBrowserHighlights(bookId: string): Promise<SavedHighlight[]> {
  const db = await openBrowserLibrary()
  const rows = await getAllStoreRecords<SavedHighlight>(db, HIGHLIGHTS_STORE)
  return rows
    .filter((row) => row.bookId === bookId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function deleteBrowserHighlight(highlightId: string) {
  const db = await openBrowserLibrary()
  await deleteStoreRecord(db, HIGHLIGHTS_STORE, highlightId)
}

export async function saveBrowserInterpretation(
  request: SaveInterpretationRequest,
): Promise<SavedInterpretation> {
  const now = new Date().toISOString()
  const kind = request.kind ?? "interpretation"
  const id = `browser-interpretation-${hashString(`${kind}\u001f${request.bookId}\u001f${request.selectionText}\u001f${request.question ?? ""}\u001f${request.answer}\u001f${Date.now()}\u001f${Math.random()}`)}`
  const hasQuestion = Boolean(request.question?.trim())
  const interpretation: SavedInterpretation = {
    id,
    bookId: request.bookId,
    selectionText: request.selectionText,
    sessionId: request.sessionId?.trim() || id,
    turnIndex: request.turnIndex ?? (hasQuestion ? 1 : 0),
    prefix: request.prefix ?? "",
    suffix: request.suffix ?? "",
    pageIndex: request.pageIndex ?? null,
    positionStart: request.positionStart ?? null,
    positionEnd: request.positionEnd ?? null,
    pageIndexes: request.pageIndexes,
    evidenceChunkIds: request.evidenceChunkIds,
    question: request.question ?? null,
    answer: request.answer,
    answerSource: request.answerSource ?? "llm",
    kind,
    mode: request.mode ?? null,
    evidenceChunkSnapshots: request.evidenceChunkSnapshots ?? [],
    createdAt: now,
  }
  const db = await openBrowserLibrary()
  await putStoreRecord(db, INTERPRETATIONS_STORE, interpretation)
  return interpretation
}

export async function listBrowserInterpretations(bookId: string): Promise<SavedInterpretation[]> {
  const db = await openBrowserLibrary()
  const rows = await getAllStoreRecords<SavedInterpretation>(db, INTERPRETATIONS_STORE)
  return rows
    .filter((row) => row.bookId === bookId)
    .sort((left, right) =>
      right.sessionId.localeCompare(left.sessionId) ||
      left.turnIndex - right.turnIndex ||
      left.createdAt.localeCompare(right.createdAt),
    )
}

export async function deleteBrowserInterpretation(interpretationId: string) {
  const db = await openBrowserLibrary()
  const rows = await getAllStoreRecords<SavedInterpretation>(db, INTERPRETATIONS_STORE)
  const target = rows.find((row) => row.id === interpretationId)
  if (!target) {
    return
  }
  await deleteInterpretationSessionRecords(db, target.sessionId || target.id, interpretationId)
}

function openBrowserLibrary(): Promise<IDBDatabase> {
  if (!browserLibraryAvailable()) {
    return Promise.reject(new Error("当前浏览器不支持 IndexedDB"))
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: "bookId" })
      }
      if (!db.objectStoreNames.contains(HIGHLIGHTS_STORE)) {
        db.createObjectStore(HIGHLIGHTS_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(INTERPRETATIONS_STORE)) {
        db.createObjectStore(INTERPRETATIONS_STORE, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("无法打开浏览器书库"))
  })
}

function putRecord(db: IDBDatabase, record: BrowserBookRecord) {
  return putStoreRecord(db, BOOKS_STORE, record)
}

function deleteBookRecord(db: IDBDatabase, bookId: string) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      [BOOKS_STORE, HIGHLIGHTS_STORE, INTERPRETATIONS_STORE],
      "readwrite",
    )
    transaction.objectStore(BOOKS_STORE).delete(bookId)
    const highlightStore = transaction.objectStore(HIGHLIGHTS_STORE)
    const interpretationStore = transaction.objectStore(INTERPRETATIONS_STORE)
    highlightStore.getAll().onsuccess = (event) => {
      for (const row of ((event.target as IDBRequest).result as SavedHighlight[]) ?? []) {
        if (row.bookId === bookId) {
          highlightStore.delete(row.id)
        }
      }
    }
    interpretationStore.getAll().onsuccess = (event) => {
      for (const row of ((event.target as IDBRequest).result as SavedInterpretation[]) ?? []) {
        if (row.bookId === bookId) {
          interpretationStore.delete(row.id)
        }
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("浏览器书库删除失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("浏览器书库删除中止"))
  })
}

function getRecord(db: IDBDatabase, bookId: string): Promise<BrowserBookRecord | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BOOKS_STORE, "readonly")
    const request = transaction.objectStore(BOOKS_STORE).get(bookId)
    request.onsuccess = () => resolve((request.result as BrowserBookRecord | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error("无法读取浏览器书籍"))
    transaction.onerror = () => reject(transaction.error ?? new Error("无法读取浏览器书籍"))
  })
}

function getAllRecords(db: IDBDatabase): Promise<BrowserBookRecord[]> {
  return getAllStoreRecords<BrowserBookRecord>(db, BOOKS_STORE)
}

function putStoreRecord(db: IDBDatabase, storeName: string, record: unknown) {
  return transactionDone(db, storeName, "readwrite", (store) => store.put(record))
}

function deleteStoreRecord(db: IDBDatabase, storeName: string, id: string) {
  return transactionDone(db, storeName, "readwrite", (store) => store.delete(id))
}

function getAllStoreRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly")
    const request = transaction.objectStore(storeName).getAll()
    request.onsuccess = () => resolve((request.result as T[]) ?? [])
    request.onerror = () => reject(request.error ?? new Error("无法读取浏览器书库"))
    transaction.onerror = () => reject(transaction.error ?? new Error("无法读取浏览器书库"))
  })
}

function deleteInterpretationSessionRecords(
  db: IDBDatabase,
  sessionId: string,
  fallbackId: string,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(INTERPRETATIONS_STORE, "readwrite")
    const store = transaction.objectStore(INTERPRETATIONS_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      for (const row of (request.result as SavedInterpretation[]) ?? []) {
        if ((row.sessionId || row.id) === sessionId || row.id === fallbackId) {
          store.delete(row.id)
        }
      }
    }
    request.onerror = () => reject(request.error ?? new Error("无法读取浏览器解读历史"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("浏览器解读历史删除失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("浏览器解读历史删除中止"))
  })
}

function transactionDone(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    action(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("浏览器书库写入失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("浏览器书库写入中止"))
  })
}

function stableBrowserBookId(request: SaveBrowserBookRequest, text: string) {
  return `browser-book-${hashString(
    [
      request.title,
      request.totalPages,
      request.pages.length,
      request.chunks.length,
      request.sourcePdfPath || "",
      text.slice(0, 2048),
      text.slice(-2048),
    ].join("\u001f"),
  )}`
}

function responseFromRecord(record: BrowserBookRecord): SaveParsedBookResponse {
  return {
    bookId: record.bookId,
    pageCount: record.totalPages,
    chunkCount: record.chunkCount,
    textCharCount: record.textCharCount,
    markdownCharCount: record.markdownCharCount,
    textPath: record.textPath,
    markdownPath: record.markdownPath,
    originalPdfPath: record.originalPdfPath,
    sourcePdfPath: record.sourcePdfPath,
    sourcePdfFingerprint: record.sourcePdfFingerprint,
  }
}

function summaryFromRecord(record: BrowserBookRecord): StoredBookSummary {
  return {
    bookId: record.bookId,
    title: record.title,
    totalPages: record.totalPages,
    chunkCount: record.chunkCount,
    textCharCount: record.textCharCount,
    markdownCharCount: record.markdownCharCount,
    textPath: record.textPath,
    markdownPath: record.markdownPath,
    originalPdfPath: record.originalPdfPath,
    sourcePdfPath: record.sourcePdfPath,
    sourcePdfFingerprint: record.sourcePdfFingerprint,
    parserEngine: record.parserEngine,
    coordinateMode: record.coordinateMode,
    quality: record.quality,
    tldrText: record.tldrText ?? null,
    tldrGeneratedAt: record.tldrGeneratedAt ?? null,
    tldrModel: record.tldrModel ?? null,
    tldrSourceVersion: record.tldrSourceVersion ?? null,
    createdAt: new Date(record.createdAt).toISOString(),
  }
}

function assetFromRecord(record: BrowserBookRecord): ConvertedBookAsset {
  return {
    ...summaryFromRecord(record),
    text: record.text,
    markdown: record.markdown,
    pages: record.pages,
    chunks: record.chunks,
  }
}
