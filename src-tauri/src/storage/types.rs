//! Public data types (book/chunk/highlight/interpretation requests &
//! responses, search hits, enums) for the storage layer.
//! Split out of storage/mod.rs (P10 architecture refactor).

use super::*;

#[derive(Debug, Deserialize)]
pub struct SaveBookRequest {
    pub title: String,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    #[serde(rename = "parserEngine", default = "default_parser_engine")]
    pub parser_engine: String,
    #[serde(rename = "coordinateMode", default = "default_coordinate_mode")]
    pub coordinate_mode: String,
    #[serde(default)]
    pub quality: Option<TextQuality>,
    #[serde(rename = "sourcePdfPath", default)]
    pub source_pdf_path: Option<String>,
    #[serde(rename = "sourceAssetDir", default)]
    pub source_asset_dir: Option<String>,
    #[serde(rename = "sourceAssetDirs", default)]
    pub source_asset_dirs: Vec<String>,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

fn default_parser_engine() -> String {
    "unknown".to_string()
}

fn default_coordinate_mode() -> String {
    "text-only".to_string()
}

fn default_coordinate_version() -> u32 {
    COORDINATE_VERSION
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextQuality {
    pub char_count: u32,
    pub replacement_char_ratio: f64,
    pub control_char_ratio: f64,
    pub looks_usable: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ParsedPageInput {
    #[serde(rename = "pageIndex")]
    pub page_index: u32,
    pub text: String,
    pub markdown: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ParsedChunkInput {
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    #[serde(rename = "pageIndex")]
    pub page_index: u32,
    pub text: String,
    pub markdown: String,
    #[serde(default)]
    pub rects: Vec<NormalizedRectInput>,
    #[serde(rename = "coordinateVersion", default = "default_coordinate_version")]
    pub coordinate_version: u32,
}

#[derive(Debug, Serialize)]
pub struct SaveBookResponse {
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(rename = "pageCount")]
    pub page_count: usize,
    #[serde(rename = "chunkCount")]
    pub chunk_count: usize,
    #[serde(rename = "textCharCount")]
    pub text_char_count: usize,
    #[serde(rename = "markdownCharCount")]
    pub markdown_char_count: usize,
    #[serde(rename = "textPath")]
    pub text_path: String,
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    #[serde(rename = "originalPdfPath")]
    pub original_pdf_path: String,
    #[serde(rename = "sourcePdfPath")]
    pub source_pdf_path: String,
    #[serde(rename = "sourcePdfFingerprint")]
    pub source_pdf_fingerprint: String,
}

impl SaveBookResponse {
    pub fn from_cached_book(book: StoredBookSummary) -> Self {
        Self {
            book_id: book.book_id,
            page_count: book.total_pages as usize,
            chunk_count: book.chunk_count as usize,
            text_char_count: book.text_char_count as usize,
            markdown_char_count: book.markdown_char_count as usize,
            text_path: book.text_path,
            markdown_path: book.markdown_path,
            original_pdf_path: book.original_pdf_path,
            source_pdf_path: book.source_pdf_path,
            source_pdf_fingerprint: book.source_pdf_fingerprint,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBookResponse {
    pub book_id: String,
    pub removed_asset_dir: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    #[serde(rename = "pageIndex")]
    pub page_index: u32,
    pub text: String,
    pub markdown: String,
    pub rects: Vec<NormalizedRectInput>,
    #[serde(rename = "coordinateVersion")]
    pub coordinate_version: u32,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct StoredBookSummary {
    #[serde(rename = "bookId")]
    pub book_id: String,
    pub title: String,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    #[serde(rename = "chunkCount")]
    pub chunk_count: u32,
    #[serde(rename = "textCharCount")]
    pub text_char_count: u32,
    #[serde(rename = "markdownCharCount")]
    pub markdown_char_count: u32,
    #[serde(rename = "textPath")]
    pub text_path: String,
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    #[serde(rename = "originalPdfPath")]
    pub original_pdf_path: String,
    #[serde(rename = "sourcePdfPath")]
    pub source_pdf_path: String,
    #[serde(rename = "sourcePdfFingerprint")]
    pub source_pdf_fingerprint: String,
    #[serde(rename = "parserEngine")]
    pub parser_engine: String,
    #[serde(rename = "coordinateMode")]
    pub coordinate_mode: String,
    pub quality: Option<TextQuality>,
    #[serde(rename = "tldrText")]
    pub tldr_text: Option<String>,
    #[serde(rename = "tldrGeneratedAt")]
    pub tldr_generated_at: Option<String>,
    #[serde(rename = "tldrModel")]
    pub tldr_model: Option<String>,
    #[serde(rename = "tldrSourceVersion")]
    pub tldr_source_version: Option<u32>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBookAsset {
    pub book_id: String,
    pub title: String,
    pub total_pages: u32,
    pub text: String,
    pub markdown: String,
    pub text_path: String,
    pub markdown_path: String,
    pub original_pdf_path: String,
    pub source_pdf_path: String,
    pub source_pdf_fingerprint: String,
    pub parser_engine: String,
    pub coordinate_mode: String,
    pub quality: Option<TextQuality>,
    pub tldr_text: Option<String>,
    pub tldr_generated_at: Option<String>,
    pub tldr_model: Option<String>,
    pub tldr_source_version: Option<u32>,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTldr {
    pub book_id: String,
    pub text: String,
    pub generated_at: String,
    pub model: String,
    pub source_version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBookPageWindow {
    pub book_id: String,
    pub start_page: u32,
    pub end_page: u32,
    pub total_pages: u32,
    pub text: String,
    pub markdown: String,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

#[derive(Debug)]
pub struct StoredBookPageSourceWindow {
    pub end_page: u32,
    pub pages: Vec<ParsedPageInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexSummary {
    pub book_id: String,
    pub embedding_provider: String,
    pub embedding_base_url: String,
    pub embedding_model: String,
    pub embedding_dim: u32,
    pub embedding_last_error: String,
    pub embedding_enabled: bool,
    pub embedding_key_configured: bool,
    pub embedding_matches_config: bool,
    pub chunk_count: u32,
    pub vector_count: u32,
    pub fts_ready: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHighlightRequest {
    pub book_id: String,
    pub selection_text: String,
    pub prefix: String,
    pub suffix: String,
    #[serde(rename = "pageIndex")]
    pub page_index: Option<u32>,
    #[serde(rename = "positionStart")]
    pub position_start: Option<u32>,
    #[serde(rename = "positionEnd")]
    pub position_end: Option<u32>,
    pub rects: Vec<NormalizedRectInput>,
    #[serde(rename = "coordinateVersion", default = "default_coordinate_version")]
    pub coordinate_version: u32,
    pub interpretation: Option<String>,
    #[serde(default)]
    pub evidence_chunk_ids: Vec<String>,
    #[serde(default)]
    pub evidence_chunk_snapshots: Vec<EvidenceChunkSnapshot>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRectInput {
    pub page_index: u32,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedHighlight {
    pub id: String,
    pub book_id: String,
    pub selection_text: String,
    pub prefix: String,
    pub suffix: String,
    pub page_index: Option<u32>,
    pub position_start: Option<u32>,
    pub position_end: Option<u32>,
    pub rects: Vec<NormalizedRectInput>,
    pub coordinate_version: u32,
    pub interpretation: Option<String>,
    pub evidence_chunk_ids: Vec<String>,
    pub evidence_chunk_snapshots: Vec<EvidenceChunkSnapshot>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInterpretationRequest {
    pub book_id: String,
    pub selection_text: String,
    pub session_id: Option<String>,
    pub turn_index: Option<u32>,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    pub page_index: Option<u32>,
    pub position_start: Option<u32>,
    pub position_end: Option<u32>,
    pub page_indexes: Vec<u32>,
    pub evidence_chunk_ids: Vec<String>,
    pub question: Option<String>,
    pub answer: String,
    #[serde(default = "default_answer_source")]
    pub answer_source: AnswerSource,
    #[serde(default)]
    pub kind: Option<InterpretationKind>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub evidence_chunk_snapshots: Vec<EvidenceChunkSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedInterpretation {
    pub id: String,
    pub book_id: String,
    pub selection_text: String,
    pub session_id: String,
    pub turn_index: u32,
    pub prefix: String,
    pub suffix: String,
    pub page_index: Option<u32>,
    pub position_start: Option<u32>,
    pub position_end: Option<u32>,
    pub page_indexes: Vec<u32>,
    pub evidence_chunk_ids: Vec<String>,
    pub question: Option<String>,
    pub answer: String,
    pub answer_source: AnswerSource,
    pub kind: InterpretationKind,
    pub mode: Option<String>,
    pub evidence_chunk_snapshots: Vec<EvidenceChunkSnapshot>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceChunkSnapshot {
    pub chunk_id: String,
    #[serde(default)]
    pub chunk_id_version: u32,
    #[serde(default)]
    pub content_hash: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AnswerSource {
    Llm,
    LocalFallback,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum InterpretationKind {
    Interpretation,
    Spark,
    Note,
}

fn default_answer_source() -> AnswerSource {
    AnswerSource::Llm
}

impl AnswerSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AnswerSource::Llm => "llm",
            AnswerSource::LocalFallback => "local_fallback",
        }
    }

    pub(crate) fn from_db(value: &str) -> Self {
        match value {
            "local_fallback" => AnswerSource::LocalFallback,
            _ => AnswerSource::Llm,
        }
    }
}

impl InterpretationKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            InterpretationKind::Interpretation => "interpretation",
            InterpretationKind::Spark => "spark",
            InterpretationKind::Note => "note",
        }
    }

    pub(crate) fn from_db(value: &str) -> Self {
        match value {
            "spark" => InterpretationKind::Spark,
            "note" => InterpretationKind::Note,
            _ => InterpretationKind::Interpretation,
        }
    }
}
