import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { COORDINATE_VERSION, type NormalizedPageRect } from "@/core/coordinates"
import type {
  ParsedChunk,
  ParsedPage,
  BuildKnowledgeGraphResponse,
  KnowledgeGraph,
  KnowledgeHealth,
  KnowledgeDrift,
  KnowledgeMap,
  KnowledgeCard,
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

export type SearchIndexTask = {
  taskId: string
  bookId: string
}

export type SearchIndexProgressEvent = {
  taskId: string
  bookId: string
  stage: "started" | "completed" | "failed"
  message: string
  summary?: SearchIndexSummary | null
  error?: CommandErrorPayload | null
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

export type InterpretMode = "deep" | "plain" | "apply"

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
  providers?: Partial<Record<LlmProviderKind, LlmProviderSettings>>
}

export type LlmProviderSettings = {
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
  batchSize: number
  apiKeyConfigured: boolean
  enabled: boolean
}

export type SaveEmbeddingSettingsRequest = {
  provider: string
  apiKey?: string
  baseUrl: string
  model: string
  expectedDimension?: number | null
  batchSize?: number | null
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

export type MinerUConnectionTestResponse = {
  baseUrl: string
  ok: boolean
  checked: string
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
  knowledgeCardCount: number
  knowledgeEvidenceCount: number
  knowledgeEdgeCount: number
  knowledgeExportBytes: number
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
  evidenceChunkIds?: string[]
  evidenceChunkSnapshots?: {
    chunkId: string
    chunkIdVersion: number
    contentHash?: string | null
  }[]
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
  /** 解读模式（deep/plain/apply），与 kind 正交：完整记录用户解读意图。 */
  mode?: InterpretMode
  evidenceChunkSnapshots?: {
    chunkId: string
    chunkIdVersion: number
    contentHash?: string | null
  }[]
}

export type InterpretationKind = "interpretation" | "spark" | "note"

export type ExportBookKnowledgeMarkdownResponse = {
  bookId: string
  markdown: string
  generatedAt: string
}

export type ExportBookKnowledgeJsonResponse = {
  bookId: string
  generatedAt: string
  cards: KnowledgeCard[]
  edges: KnowledgeGraph["edges"]
}

export type UpsertKnowledgeCardRequest = {
  cardId?: string | null
  bookId: string
  cardType: string
  title: string
  summary?: string
  bodyMarkdown?: string
  payloadJson?: string | null
  status?: string
  evidenceChunkIds?: string[]
}

export type ObsidianSettings = {
  vaultPath: string
  subdir: string
  configured: boolean
}

export type SaveObsidianSettingsRequest = {
  vaultPath: string
  subdir?: string | null
}

export type ObsidianSnippetKind = "highlight" | "spark" | "note"

export type ObsidianSnippet = {
  kind: ObsidianSnippetKind
  pageNumber?: number | null
  quote?: string | null
  content: string
  chunkIds: string[]
  /** Local time label rendered by the frontend, e.g. "2026-07-07 21:30". */
  timestamp: string
}

export type ExportObsidianResponse = {
  path: string
}

const OBSIDIAN_BROWSER_MESSAGE = "Obsidian 导出需要桌面版。"

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

export async function importPlainBook(filePath: string, title?: string | null) {
  return invokeCommand<SaveParsedBookResponse>("import_plain_book", { filePath, title })
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

export async function listenSearchIndexProgress(
  handler: (event: SearchIndexProgressEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null
  }
  return listen<SearchIndexProgressEvent>("search-index://progress", (event) => {
    handler(event.payload)
  })
}

/** macOS 原生菜单动作(payload 为菜单项 id,如 "menu:import")。 */
export async function listenAppMenuAction(
  handler: (actionId: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null
  }
  return listen<string>("app-menu://action", (event) => {
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

export async function rebuildSearchIndexAsync(bookId: string, taskId?: string) {
  return invokeCommand<SearchIndexTask>("rebuild_search_index_async", { bookId, taskId })
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

export async function openExternalUrl(url: string) {
  return invokeCommand<void>("open_external_url", { url })
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

export type AgentHostStatus = {
  hostUrl: string | null
  bookToolPort: number
  ready: boolean
}

/** Resolve the OpenCode sidecar status (host URL + readiness) from the backend. */
export async function getAgentHostUrl(): Promise<AgentHostStatus | null> {
  if (!isTauriRuntime()) {
    return null
  }
  try {
    return await invokeCommand<AgentHostStatus>("get_agent_host_url")
  } catch {
    return null
  }
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

export async function testLlmConnectionWithSettings(request: SaveLlmSettingsRequest) {
  return invokeCommand<LlmConnectionTestResponse>("test_llm_connection_with_settings", {
    request,
  })
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

export async function testMineruConnectionWithSettings(request: SaveMinerUSettingsRequest) {
  return invokeCommand<MinerUConnectionTestResponse>("test_mineru_connection_with_settings", {
    request,
  })
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

export async function listInterpretations(bookId: string, limit = 50, offset = 0) {
  return invokeCommand<SavedInterpretation[]>("list_interpretations", { bookId, limit, offset })
}

export async function listKnowledgeCards(bookId: string) {
  return invokeCommand<KnowledgeCard[]>("list_knowledge_cards", { bookId })
}

export async function getKnowledgeCard(bookId: string, cardId: string) {
  return invokeCommand<KnowledgeCard | null>("get_knowledge_card", { bookId, cardId })
}

export async function upsertKnowledgeCard(request: UpsertKnowledgeCardRequest) {
  return invokeCommand<KnowledgeCard>("upsert_knowledge_card", { request })
}

export async function confirmKnowledgeCard(bookId: string, cardId: string) {
  return invokeCommand<KnowledgeCard>("confirm_knowledge_card", { bookId, cardId })
}

export async function rejectKnowledgeCard(bookId: string, cardId: string) {
  return invokeCommand<KnowledgeCard>("reject_knowledge_card", { bookId, cardId })
}

export async function deleteKnowledgeCard(bookId: string, cardId: string) {
  return invokeCommand<void>("delete_knowledge_card", { bookId, cardId })
}

export async function listKnowledgeCardsByChunk(bookId: string, chunkId: string) {
  return invokeCommand<KnowledgeCard[]>("list_knowledge_cards_by_chunk", { bookId, chunkId })
}

export async function buildKnowledgeGraph(bookId: string) {
  return invokeCommand<BuildKnowledgeGraphResponse>("build_knowledge_graph", { bookId })
}

export async function getKnowledgeGraph(bookId: string) {
  return invokeCommand<KnowledgeGraph>("get_knowledge_graph", { bookId })
}

export async function getBookKnowledgeMap(bookId: string) {
  return invokeCommand<KnowledgeMap>("get_book_knowledge_map", { bookId })
}

export async function getKnowledgeHealth(bookId: string) {
  return invokeCommand<KnowledgeHealth>("knowledge_health", { bookId })
}

export async function listKnowledgeDrift(bookId: string) {
  return invokeCommand<KnowledgeDrift[]>("list_knowledge_drift", { bookId })
}

export async function exportBookKnowledgeMarkdown(bookId: string) {
  return invokeCommand<ExportBookKnowledgeMarkdownResponse>("export_book_knowledge_markdown", {
    bookId,
  })
}

export async function exportBookKnowledgeJson(bookId: string) {
  return invokeCommand<ExportBookKnowledgeJsonResponse>("export_book_knowledge_json", {
    bookId,
  })
}

export async function getObsidianSettings() {
  if (!isTauriRuntime()) {
    return { vaultPath: "", subdir: "", configured: false } satisfies ObsidianSettings
  }
  return invokeCommand<ObsidianSettings>("get_obsidian_settings")
}

export async function saveObsidianSettings(request: SaveObsidianSettingsRequest) {
  if (!isTauriRuntime()) {
    throw new CommandError({ code: "browser_mode", message: OBSIDIAN_BROWSER_MESSAGE })
  }
  return invokeCommand<ObsidianSettings>("save_obsidian_settings", { request })
}

export async function exportSnippetToObsidian(bookId: string, snippet: ObsidianSnippet) {
  if (!isTauriRuntime()) {
    throw new CommandError({ code: "browser_mode", message: OBSIDIAN_BROWSER_MESSAGE })
  }
  return invokeCommand<ExportObsidianResponse>("export_snippet_to_obsidian", { bookId, snippet })
}

export async function exportBookKnowledgeToObsidian(bookId: string) {
  if (!isTauriRuntime()) {
    throw new CommandError({ code: "browser_mode", message: OBSIDIAN_BROWSER_MESSAGE })
  }
  return invokeCommand<ExportObsidianResponse>("export_book_knowledge_to_obsidian", { bookId })
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
