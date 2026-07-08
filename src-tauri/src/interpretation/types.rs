use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretRequest {
    pub book_id: String,
    pub selection_text: String,
    pub page_indexes: Vec<u32>,
    #[serde(default)]
    pub selection_rects: Vec<storage::NormalizedRectInput>,
    #[serde(default)]
    pub focus_chunk_ids: Vec<String>,
    pub question: Option<String>,
    #[serde(default)]
    pub prior_answer: Option<String>,
    #[serde(default)]
    pub prior_evidence_chunk_ids: Vec<String>,
    #[serde(default)]
    pub follow_up_history: Vec<FollowUpContext>,
    #[serde(default)]
    pub lightweight: bool,
    pub mode: InterpretMode,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpContext {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum InterpretMode {
    Deep,
    Plain,
    Apply,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretResponse {
    pub answer: String,
    pub answer_source: AnswerSource,
    pub evidence: Vec<EvidenceItem>,
    pub trace: Vec<AgentTraceStep>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnswerSource {
    Llm,
    LocalFallback,
}

impl From<AnswerSource> for storage::AnswerSource {
    fn from(value: AnswerSource) -> Self {
        match value {
            AnswerSource::Llm => storage::AnswerSource::Llm,
            AnswerSource::LocalFallback => storage::AnswerSource::LocalFallback,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceItem {
    pub chunk_id: String,
    pub title: String,
    pub page_index: u32,
    pub text: String,
    #[serde(skip_serializing)]
    pub score: f64,
    #[serde(skip_serializing)]
    pub rects: Vec<storage::NormalizedRectInput>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceStep {
    pub phase: AgentTracePhase,
    pub query: Option<String>,
    pub chunk_ids: Vec<String>,
    pub note: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InterpretationStreamEvent {
    pub request_id: String,
    pub stage: InterpretationStreamStage,
    pub message: String,
    pub delta: Option<String>,
    pub answer: Option<String>,
    pub answer_source: Option<AnswerSource>,
    pub evidence: Vec<EvidenceItem>,
    pub trace: Vec<AgentTraceStep>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterpretationStreamStage {
    Planning,
    Retrieving,
    Synthesizing,
    Delta,
    Done,
    Cancelled,
    Failed,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentTracePhase {
    Plan,
    Retrieve,
    Iterate,
    Synthesize,
}
