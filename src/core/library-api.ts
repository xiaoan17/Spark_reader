import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { COORDINATE_VERSION, type NormalizedPageRect } from "@/core/coordinates"
import type {
  ParsedChunk,
  ParsedPage,
  SavedHighlight,
  SavedInterpretation,
} from "@/stores/reader-store"

export type CommandErrorPayload = {
  code?: string
  message: string
  suggestion?: string | null
}

export class CommandError extends Error {
  code: string
  suggestion?: string
  raw: unknown

  constructor(payload: CommandErrorPayload, raw?: unknown) {
    const message = payload.suggestion
      ? `${payload.message} ${payload.suggestion}`
      : payload.message
    super(message)
    this.name = "CommandError"
    this.code = payload.code ?? "unknown"
    this.suggestion = payload.suggestion ?? undefined
    this.raw = raw
  }
}

export function normalizeCommandError(error: unknown): CommandError {
  if (error instanceof CommandError) {
    return error
  }
  if (error instanceof Error) {
    return new CommandError(
      {
        code: "unknown",
        message: error.message || "桌面版操作失败。",
      },
      error,
    )
  }
  if (isCommandErrorPayload(error)) {
    return new CommandError(error, error)
  }
  if (typeof error === "string") {
    return new CommandError({ code: "unknown", message: error }, error)
  }
  return new CommandError(
    {
      code: "unknown",
      message: "桌面版操作失败。",
      suggestion: "请保留当前阅读内容后重试；如果问题持续，可打开开发诊断查看详情。",
    },
    error,
  )
}

function isCommandErrorPayload(error: unknown): error is CommandErrorPayload {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  )
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeCommandError(error)
  }
}

export type SaveParsedBookResponse = {
  bookId: string
  pageCount: number
  chunkCount: number
  textCharCount: number
  markdownCharCount: number
  textPath: string
  markdownPath: string
  originalPdfPath: string
  sourcePdfPath: string
  sourcePdfFingerprint: string
}

export type SearchBookHit = {
  chunkId: string
  pageIndex: number
  text: string
  markdown: string
  rects: NormalizedPageRect[]
  coordinateVersion?: number
  snippet: string
  score: number
}

export type SearchIndexSummary = {
  bookId: string
  embeddingProvider: string
  embeddingBaseUrl: string
  embeddingModel: string
  embeddingDim: number
  embeddingLastError: string
  embeddingEnabled: boolean
  embeddingKeyConfigured: boolean
  embeddingMatchesConfig: boolean
  chunkCount: number
  vectorCount: number
  ftsReady: boolean
}

export type StoredBookSummary = {
  bookId: string
  title: string
  totalPages: number
  chunkCount: number
  textCharCount: number
  markdownCharCount: number
  textPath: string
  markdownPath: string
  originalPdfPath: string
  sourcePdfPath: string
  sourcePdfFingerprint: string
  parserEngine: string
  coordinateMode: string
  quality?: TextQuality | null
  tldrText?: string | null
  tldrGeneratedAt?: string | null
  tldrModel?: string | null
  tldrSourceVersion?: number | null
  createdAt: string
}

export type ConvertedBookAsset = {
  bookId: string
  title: string
  totalPages: number
  text: string
  markdown: string
  textPath: string
  markdownPath: string
  originalPdfPath: string
  sourcePdfPath: string
  sourcePdfFingerprint: string
  parserEngine: string
  coordinateMode: string
  quality?: TextQuality | null
  tldrText?: string | null
  tldrGeneratedAt?: string | null
  tldrModel?: string | null
  tldrSourceVersion?: number | null
  pages: ParsedPage[]
  chunks: ParsedChunk[]
}

export type DocumentTldr = {
  bookId: string
  text: string
  generatedAt: string
  model: string
  sourceVersion: number
}

export type ConvertedBookManifest = StoredBookSummary

export type ConvertedBookPageWindow = {
  bookId: string
  startPage: number
  endPage: number
  totalPages: number
  text: string
  markdown: string
  pages: ParsedPage[]
  chunks: ParsedChunk[]
}

export type TextQuality = {
  charCount: number
  replacementCharRatio: number
  controlCharRatio: number
  looksUsable: boolean
}

export type MinerUParseOptions = {
  isOcr: boolean
  language: string
  modelVersion: string
  enableFormula: boolean
  enableTable: boolean
  pageRanges?: string | null
}

export type MinerUProgressStage =
  | "preparing"
  | "submitted"
  | "uploaded"
  | "polling"
  | "downloading"
  | "extracting"
  | "normalizing"
  | "parsing"
  | "indexed"
  | "failed"

export type MinerUProgressEvent = {
  stage: MinerUProgressStage
  message: string
  batchId?: string | null
  pollCount: number
  state?: string | null
  batchIndex?: number | null
  batchTotal?: number | null
  pageRange?: string | null
}

export type InterpretMode = "deep" | "plain"

export type InterpretSelectionRequest = {
  bookId: string
  selectionText: string
  pageIndexes: number[]
  selectionRects?: NormalizedPageRect[]
  focusChunkIds?: string[]
  question?: string
  priorAnswer?: string
  priorEvidenceChunkIds?: string[]
  followUpHistory?: Array<{
    question: string
    answer: string
  }>
  lightweight?: boolean
  mode: InterpretMode
}

export type InterpretEvidenceItem = {
  chunkId: string
  title: string
  pageIndex: number
  text: string
}

export type AgentTracePhase = "plan" | "retrieve" | "iterate" | "synthesize"

export type AgentTraceStep = {
  phase: AgentTracePhase
  query?: string | null
  chunkIds: string[]
  note: string
}

export type AnswerSource = "llm" | "local_fallback"

export type InterpretSelectionResponse = {
  answer: string
  answerSource: AnswerSource
  evidence: InterpretEvidenceItem[]
  trace: AgentTraceStep[]
}

export type InterpretationStreamStage =
  | "planning"
  | "retrieving"
  | "synthesizing"
  | "delta"
  | "done"
  | "cancelled"
  | "failed"

export type InterpretationStreamEvent = {
  requestId: string
  stage: InterpretationStreamStage
  message: string
  delta?: string | null
  answer?: string | null
  answerSource?: AnswerSource | null
  evidence: InterpretEvidenceItem[]
  trace: AgentTraceStep[]
}

export type LlmProviderKind = "deep_seek" | "open_ai" | "anthropic"

export type LlmSettings = {
  provider: LlmProviderKind
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
}

export type SaveLlmSettingsRequest = {
  provider: LlmProviderKind
  apiKey?: string
  baseUrl: string
  model: string
}

export type LlmConnectionTestResponse = {
  provider: LlmProviderKind
  model: string
  ok: boolean
}

export type EmbeddingSettings = {
  provider: string
  baseUrl: string
  model: string
  expectedDimension?: number | null
  apiKeyConfigured: boolean
  enabled: boolean
}

export type SaveEmbeddingSettingsRequest = {
  provider: string
  apiKey?: string
  baseUrl: string
  model: string
  expectedDimension?: number | null
  enabled: boolean
}

export type EmbeddingConnectionTestResponse = {
  provider: string
  model: string
  dimension: number
  ok: boolean
}

export type MinerUSettings = {
  baseUrl: string
  apiTokenConfigured: boolean
}

export type ZoteroSearchResult = {
  itemKey: string
  title: string
  creators: string[]
  year: string
  itemType: string
  attachmentKey?: string | null
  attachmentTitle?: string | null
  hasPdf: boolean
}

export type SaveMinerUSettingsRequest = {
  apiToken?: string
  baseUrl: string
}

export type ProductSelfCheckStep = {
  id: string
  label: string
  ok: boolean
  detail: string
}

export type ProductSelfCheckSummary = {
  bookId: string
  pageCount: number
  chunkCount: number
  textCharCount: number
  markdownCharCount: number
  searchHitCount: number
  evidenceCount: number
  citationCount: number
  highlightCount: number
  interpretationCount: number
  tempDir: string
}

export type ProductSelfCheckResponse = {
  ok: boolean
  runId: string
  checkedAt: string
  steps: ProductSelfCheckStep[]
  summary: ProductSelfCheckSummary
}

export type BookAssetKind = "text" | "markdown" | "originalPdf" | "assetDirectory"

export type TranslationPageStatus = "pending" | "translating" | "done" | "failed"

export type TranslationPage = {
  pageIndex: number
  sourceMarkdown: string
  translatedMarkdown: string
  status: TranslationPageStatus
  error: string
  provider: string
  model: string
  updatedAt: string
}

export type TranslationStatus = {
  bookId: string
  totalPages: number
  completedPages: number
  failedPages: number
  running: boolean
  provider: string
  model: string
  pages: TranslationPage[]
}

export type OpenBookAssetResponse = {
  path: string
}

export type SaveHighlightRequest = {
  bookId: string
  selectionText: string
  prefix: string
  suffix: string
  pageIndex?: number | null
  positionStart?: number | null
  positionEnd?: number | null
  rects: NormalizedPageRect[]
  coordinateVersion?: number
  interpretation?: string | null
}

export type SaveInterpretationRequest = {
  bookId: string
  selectionText: string
  sessionId?: string | null
  turnIndex?: number | null
  prefix?: string
  suffix?: string
  pageIndex?: number | null
  positionStart?: number | null
  positionEnd?: number | null
  pageIndexes: number[]
  evidenceChunkIds: string[]
  question?: string | null
  answer: string
  answerSource?: AnswerSource
  kind?: InterpretationKind
  evidenceChunkSnapshots?: {
    chunkId: string
    chunkIdVersion: number
    contentHash?: string | null
  }[]
}

export type InterpretationKind = "interpretation" | "spark" | "note"

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window
}

export async function productSelfCheck() {
  return invokeCommand<ProductSelfCheckResponse>("product_self_check")
}

export async function searchZoteroItems(query: string, limit = 8) {
  return invokeCommand<ZoteroSearchResult[]>("search_zotero_items", { query, limit })
}

export async function importZoteroItem(itemKey: string, pageCount?: number | null) {
  return invokeCommand<SaveParsedBookResponse>("import_zotero_item", { itemKey, pageCount })
}

export async function importMineruOutput(outputDir: string, title?: string | null) {
  return invokeCommand<SaveParsedBookResponse>("import_mineru_output", { outputDir, title })
}

export async function importPdfWithMineru(
  pdfPath: string,
  options?: MinerUParseOptions,
  pageCount?: number | null,
) {
  return invokeCommand<SaveParsedBookResponse>("import_pdf_with_mineru", { pdfPath, options, pageCount })
}

export async function listenMineruProgress(
  handler: (event: MinerUProgressEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null
  }
  return listen<MinerUProgressEvent>("mineru://progress", (event) => {
    handler(event.payload)
  })
}

export async function readPdfFile(pdfPath: string) {
  return invokeCommand<number[]>("read_pdf_file", { pdfPath })
}

export async function searchBook(bookId: string, query: string, limit = 12) {
  return invokeCommand<SearchBookHit[]>("search_book", {
    bookId,
    query,
    limit,
  })
}

export async function rebuildSearchIndex(bookId: string) {
  return invokeCommand<SearchIndexSummary>("rebuild_search_index", { bookId })
}

export async function searchIndexSummary(bookId: string) {
  return invokeCommand<SearchIndexSummary>("search_index_summary", { bookId })
}

export async function getChunk(bookId: string, chunkId: string) {
  return invokeCommand<SearchBookHit | null>("get_chunk", { bookId, chunkId })
}

export async function getNeighbors(bookId: string, chunkId: string, radius = 1) {
  return invokeCommand<SearchBookHit[]>("get_neighbors", { bookId, chunkId, radius })
}

export async function listStructure(bookId: string) {
  return invokeCommand<SearchBookHit[]>("list_structure", { bookId })
}

export async function listBooks() {
  return invokeCommand<StoredBookSummary[]>("list_books")
}

export async function getConvertedBook(bookId: string) {
  return invokeCommand<ConvertedBookAsset>("get_converted_book", { bookId })
}

export async function getConvertedBookManifest(bookId: string) {
  return invokeCommand<ConvertedBookManifest>("get_converted_book_manifest", { bookId })
}

export async function getDocumentTldr(bookId: string) {
  return invokeCommand<DocumentTldr>("get_or_generate_document_tldr", {
    bookId,
    forceRegenerate: false,
  })
}

export async function regenerateDocumentTldr(bookId: string) {
  return invokeCommand<DocumentTldr>("get_or_generate_document_tldr", {
    bookId,
    forceRegenerate: true,
  })
}

export async function getConvertedBookPages(bookId: string, startPage: number, pageCount: number) {
  return invokeCommand<ConvertedBookPageWindow>("get_converted_book_pages", {
    bookId,
    startPage,
    pageCount,
  })
}

export async function openBookAsset(bookId: string, kind: BookAssetKind) {
  return invokeCommand<OpenBookAssetResponse>("open_book_asset", { bookId, kind })
}

export async function revealBookAsset(bookId: string, kind: BookAssetKind) {
  return invokeCommand<OpenBookAssetResponse>("reveal_book_asset", { bookId, kind })
}

export async function findBookBySourcePdf(pdfPath: string) {
  return invokeCommand<StoredBookSummary | null>("find_book_by_source_pdf", { pdfPath })
}

export async function interpretSelection(request: InterpretSelectionRequest, requestId?: string) {
  return invokeCommand<InterpretSelectionResponse>("interpret_selection", { request, requestId })
}

export async function cancelInterpretation(requestId: string) {
  return invokeCommand<boolean>("cancel_interpretation", { requestId })
}

export async function startTranslation(bookId: string, force = false) {
  return invokeCommand<TranslationStatus>("start_translation", {
    request: { bookId, force },
  })
}

export async function translationStatus(bookId: string) {
  return invokeCommand<TranslationStatus>("translation_status", { bookId })
}

export async function cancelTranslation(bookId: string) {
  return invokeCommand<boolean>("cancel_translation", { bookId })
}

export async function listenInterpretationStream(
  handler: (event: InterpretationStreamEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null
  }
  return listen<InterpretationStreamEvent>("interpretation://stream", (event) => {
    handler(event.payload)
  })
}

export async function getLlmSettings() {
  return invokeCommand<LlmSettings>("get_llm_settings")
}

export async function saveLlmSettings(request: SaveLlmSettingsRequest) {
  return invokeCommand<LlmSettings>("save_llm_settings", { request })
}

export async function testLlmConnection() {
  return invokeCommand<LlmConnectionTestResponse>("test_llm_connection")
}

export async function getEmbeddingSettings() {
  return invokeCommand<EmbeddingSettings>("get_embedding_settings")
}

export async function saveEmbeddingSettings(request: SaveEmbeddingSettingsRequest) {
  return invokeCommand<EmbeddingSettings>("save_embedding_settings", { request })
}

export async function getMineruSettings() {
  return invokeCommand<MinerUSettings>("get_mineru_settings")
}

export async function saveMineruSettings(request: SaveMinerUSettingsRequest) {
  return invokeCommand<MinerUSettings>("save_mineru_settings", { request })
}

export async function testEmbeddingConnection() {
  return invokeCommand<EmbeddingConnectionTestResponse>("test_embedding_connection")
}

export async function saveHighlight(request: SaveHighlightRequest) {
  return invokeCommand<SavedHighlight>("save_highlight", { request })
}

export async function listHighlights(bookId: string) {
  return invokeCommand<SavedHighlight[]>("list_highlights", { bookId })
}

export async function deleteHighlight(highlightId: string) {
  return invokeCommand<void>("delete_highlight", { highlightId })
}

export async function deleteInterpretation(interpretationId: string) {
  return invokeCommand<void>("delete_interpretation", { interpretationId })
}

export async function deleteBook(bookId: string) {
  return invokeCommand<{ bookId: string; removedAssetDir: boolean }>("delete_book", { bookId })
}

export async function saveInterpretation(request: SaveInterpretationRequest) {
  return invokeCommand<SavedInterpretation>("save_interpretation", { request })
}

export async function listInterpretations(bookId: string) {
  return invokeCommand<SavedInterpretation[]>("list_interpretations", { bookId })
}

export function searchHitToChunk(hit: SearchBookHit): ParsedChunk {
  return {
    chunkId: hit.chunkId,
    pageIndex: hit.pageIndex,
    text: hit.text,
    markdown: hit.markdown,
    rects: hit.rects,
    coordinateVersion: hit.coordinateVersion ?? COORDINATE_VERSION,
  }
}
