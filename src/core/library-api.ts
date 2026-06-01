import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { COORDINATE_VERSION, type NormalizedPageRect } from "@/core/coordinates"
import type {
  ParsedChunk,
  ParsedPage,
  SavedHighlight,
  SavedInterpretation,
} from "@/stores/reader-store"

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
  focusChunkIds?: string[]
  question?: string
  priorAnswer?: string
  priorEvidenceChunkIds?: string[]
  followUpHistory?: Array<{
    question: string
    answer: string
  }>
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
}

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window
}

export async function productSelfCheck() {
  return invoke<ProductSelfCheckResponse>("product_self_check")
}

export async function searchZoteroItems(query: string, limit = 8) {
  return invoke<ZoteroSearchResult[]>("search_zotero_items", { query, limit })
}

export async function importZoteroItem(itemKey: string, pageCount?: number | null) {
  return invoke<SaveParsedBookResponse>("import_zotero_item", { itemKey, pageCount })
}

export async function importMineruOutput(outputDir: string, title?: string | null) {
  return invoke<SaveParsedBookResponse>("import_mineru_output", { outputDir, title })
}

export async function importPdfWithMineru(
  pdfPath: string,
  options?: MinerUParseOptions,
  pageCount?: number | null,
) {
  return invoke<SaveParsedBookResponse>("import_pdf_with_mineru", { pdfPath, options, pageCount })
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
  return invoke<number[]>("read_pdf_file", { pdfPath })
}

export async function searchBook(bookId: string, query: string, limit = 12) {
  return invoke<SearchBookHit[]>("search_book", {
    bookId,
    query,
    limit,
  })
}

export async function rebuildSearchIndex(bookId: string) {
  return invoke<SearchIndexSummary>("rebuild_search_index", { bookId })
}

export async function searchIndexSummary(bookId: string) {
  return invoke<SearchIndexSummary>("search_index_summary", { bookId })
}

export async function getChunk(bookId: string, chunkId: string) {
  return invoke<SearchBookHit | null>("get_chunk", { bookId, chunkId })
}

export async function getNeighbors(bookId: string, chunkId: string, radius = 1) {
  return invoke<SearchBookHit[]>("get_neighbors", { bookId, chunkId, radius })
}

export async function listStructure(bookId: string) {
  return invoke<SearchBookHit[]>("list_structure", { bookId })
}

export async function listBooks() {
  return invoke<StoredBookSummary[]>("list_books")
}

export async function getConvertedBook(bookId: string) {
  return invoke<ConvertedBookAsset>("get_converted_book", { bookId })
}

export async function openBookAsset(bookId: string, kind: BookAssetKind) {
  return invoke<OpenBookAssetResponse>("open_book_asset", { bookId, kind })
}

export async function revealBookAsset(bookId: string, kind: BookAssetKind) {
  return invoke<OpenBookAssetResponse>("reveal_book_asset", { bookId, kind })
}

export async function findBookBySourcePdf(pdfPath: string) {
  return invoke<StoredBookSummary | null>("find_book_by_source_pdf", { pdfPath })
}

export async function interpretSelection(request: InterpretSelectionRequest, requestId?: string) {
  return invoke<InterpretSelectionResponse>("interpret_selection", { request, requestId })
}

export async function cancelInterpretation(requestId: string) {
  return invoke<boolean>("cancel_interpretation", { requestId })
}

export async function startTranslation(bookId: string, force = false) {
  return invoke<TranslationStatus>("start_translation", {
    request: { bookId, force },
  })
}

export async function translationStatus(bookId: string) {
  return invoke<TranslationStatus>("translation_status", { bookId })
}

export async function cancelTranslation(bookId: string) {
  return invoke<boolean>("cancel_translation", { bookId })
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
  return invoke<LlmSettings>("get_llm_settings")
}

export async function saveLlmSettings(request: SaveLlmSettingsRequest) {
  return invoke<LlmSettings>("save_llm_settings", { request })
}

export async function testLlmConnection() {
  return invoke<LlmConnectionTestResponse>("test_llm_connection")
}

export async function getEmbeddingSettings() {
  return invoke<EmbeddingSettings>("get_embedding_settings")
}

export async function saveEmbeddingSettings(request: SaveEmbeddingSettingsRequest) {
  return invoke<EmbeddingSettings>("save_embedding_settings", { request })
}

export async function getMineruSettings() {
  return invoke<MinerUSettings>("get_mineru_settings")
}

export async function saveMineruSettings(request: SaveMinerUSettingsRequest) {
  return invoke<MinerUSettings>("save_mineru_settings", { request })
}

export async function testEmbeddingConnection() {
  return invoke<EmbeddingConnectionTestResponse>("test_embedding_connection")
}

export async function saveHighlight(request: SaveHighlightRequest) {
  return invoke<SavedHighlight>("save_highlight", { request })
}

export async function listHighlights(bookId: string) {
  return invoke<SavedHighlight[]>("list_highlights", { bookId })
}

export async function deleteHighlight(highlightId: string) {
  return invoke<void>("delete_highlight", { highlightId })
}

export async function deleteInterpretation(interpretationId: string) {
  return invoke<void>("delete_interpretation", { interpretationId })
}

export async function deleteBook(bookId: string) {
  return invoke<{ bookId: string; removedAssetDir: boolean }>("delete_book", { bookId })
}

export async function saveInterpretation(request: SaveInterpretationRequest) {
  return invoke<SavedInterpretation>("save_interpretation", { request })
}

export async function listInterpretations(bookId: string) {
  return invoke<SavedInterpretation[]>("list_interpretations", { bookId })
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
