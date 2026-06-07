//! Public data types (cards, evidence, edges, map, graph, responses)
//! for the knowledge layer. Split out of knowledge/mod.rs (P10).

use serde::{Deserialize, Serialize};

use crate::storage::EvidenceChunkSnapshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCard {
    pub card_id: String,
    pub book_id: String,
    pub card_type: String,
    pub title: String,
    pub summary: String,
    pub body_markdown: String,
    pub payload_json: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub source_version: u32,
    pub user_locked: bool,
    pub created_at: String,
    pub updated_at: String,
    pub evidence: Vec<KnowledgeEvidence>,
    pub drift_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEvidence {
    pub card_id: String,
    pub book_id: String,
    pub chunk_id: String,
    pub page_index: Option<u32>,
    pub quote: String,
    pub role: String,
    pub content_hash: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertKnowledgeCardRequest {
    pub card_id: Option<String>,
    pub book_id: String,
    pub card_type: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub body_markdown: String,
    #[serde(default)]
    pub payload_json: Option<String>,
    #[serde(default = "default_confirmed_status")]
    pub status: String,
    #[serde(default)]
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeHealth {
    pub book_id: String,
    pub card_count: usize,
    pub confirmed_count: usize,
    pub candidate_count: usize,
    pub rejected_count: usize,
    pub drift_count: usize,
    pub edge_count: usize,
    pub latest_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDrift {
    pub card_id: String,
    pub title: String,
    pub chunk_id: String,
    pub page_index: Option<u32>,
    pub stored_content_hash: Option<String>,
    pub current_content_hash: Option<String>,
    pub quote: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchHit {
    pub card_id: String,
    pub title: String,
    pub card_type: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub score: f64,
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextCard {
    pub card_id: String,
    pub title: String,
    pub card_type: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub summary: String,
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextEdge {
    pub edge_type: String,
    pub label: String,
    pub source_title: String,
    pub target_title: String,
    pub evidence_chunk_ids: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextResponse {
    pub book_id: String,
    pub query: String,
    pub cards: Vec<KnowledgeContextCard>,
    pub edges: Vec<KnowledgeContextEdge>,
    pub station_count: usize,
    pub evidence_chunk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookKnowledgeJsonResponse {
    pub book_id: String,
    pub generated_at: String,
    pub cards: Vec<KnowledgeCard>,
    pub edges: Vec<KnowledgeEdge>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapLine {
    pub line_id: String,
    pub title: String,
    pub page_start: u32,
    pub page_end: u32,
    pub station_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapStation {
    pub station_id: String,
    pub card_id: String,
    pub line_id: String,
    pub title: String,
    pub card_type: String,
    pub status: String,
    pub page_index: Option<u32>,
    pub time_raw: Option<String>,
    pub time_norm: Option<String>,
    pub time_order: u32,
    pub time_source: Option<String>,
    pub people: Vec<String>,
    pub places: Vec<String>,
    pub evidence: Vec<KnowledgeEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapTransfer {
    pub edge_id: String,
    pub source_station_id: String,
    pub target_station_id: String,
    pub edge_type: String,
    pub label: String,
    pub evidence_chunk_ids: Vec<String>,
    pub confidence: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMapResponse {
    pub book_id: String,
    pub lines: Vec<KnowledgeMapLine>,
    pub stations: Vec<KnowledgeMapStation>,
    pub transfers: Vec<KnowledgeMapTransfer>,
    pub built_at: Option<String>,
}

fn default_confirmed_status() -> String {
    "confirmed".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookKnowledgeMarkdownResponse {
    pub book_id: String,
    pub markdown: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEdge {
    pub edge_id: String,
    pub book_id: String,
    pub source_card_id: String,
    pub target_card_id: String,
    pub edge_type: String,
    pub label: String,
    pub evidence_chunk_ids: Vec<String>,
    pub source: String,
    pub confidence: f64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphNode {
    pub card_id: String,
    pub book_id: String,
    pub card_type: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub source: String,
    pub confidence: f64,
    pub evidence_count: usize,
    pub page_index: Option<u32>,
    pub evidence: Vec<KnowledgeEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphResponse {
    pub book_id: String,
    pub nodes: Vec<KnowledgeGraphNode>,
    pub edges: Vec<KnowledgeEdge>,
    pub built_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildKnowledgeGraphResponse {
    pub book_id: String,
    pub card_count: usize,
    pub edge_count: usize,
    pub candidate_count: usize,
    pub built_at: String,
}

#[derive(Debug, Clone)]
pub struct HighlightKnowledgeInput<'a> {
    pub evidence_chunk_ids: &'a [String],
    pub evidence_chunk_snapshots: &'a [EvidenceChunkSnapshot],
}
