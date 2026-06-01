use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::json;
use thiserror::Error;

use crate::config::{self, EmbeddingConfig};

const DEFAULT_EMBEDDING_REQUEST_TIMEOUT_SECS: u64 = 45;
const DEFAULT_EMBEDDING_CONNECT_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConnectionTestResponse {
    pub provider: String,
    pub model: String,
    pub dimension: usize,
    pub ok: bool,
}

#[derive(Debug)]
pub struct EmbeddingBatch {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub dimension: usize,
    pub vectors: Vec<Vec<f32>>,
}

#[derive(Debug, Error)]
pub enum EmbeddingError {
    #[error(transparent)]
    Config(#[from] config::ConfigError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("embedding provider returned {status}: {body}")]
    Provider { status: u16, body: String },
    #[error("invalid embedding auth header")]
    InvalidHeader,
    #[error("embedding provider returned {actual} vectors for {expected} inputs")]
    CountMismatch { expected: usize, actual: usize },
    #[error("embedding provider returned inconsistent dimensions")]
    DimensionMismatch,
    #[error("embedding provider returned dimension {actual}, expected {expected}")]
    ExpectedDimensionMismatch { expected: usize, actual: usize },
    #[error("embedding provider returned empty vectors")]
    EmptyVector,
    #[error("embedding provider is disabled")]
    Disabled,
}

#[derive(Debug, Deserialize)]
struct EmbeddingsResponse {
    data: Vec<EmbeddingItem>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingItem {
    index: Option<usize>,
    embedding: Vec<f32>,
}

pub fn embed_texts(texts: &[String]) -> Result<Option<EmbeddingBatch>, EmbeddingError> {
    let Some(config) = config::embedding_config()? else {
        return Ok(None);
    };
    if texts.is_empty() {
        return Ok(Some(EmbeddingBatch {
            provider: config.provider,
            base_url: config.base_url,
            model: config.model,
            dimension: 0,
            vectors: Vec::new(),
        }));
    }

    let mut vectors = Vec::with_capacity(texts.len());
    let mut dimension = None;
    for batch in texts.chunks(64) {
        let partial = embed_openai_compat(&config, batch)?;
        if let Some(expected) = dimension {
            if partial.dimension != expected {
                return Err(EmbeddingError::DimensionMismatch);
            }
        } else {
            dimension = Some(partial.dimension);
        }
        vectors.extend(partial.vectors);
    }

    Ok(Some(EmbeddingBatch {
        provider: config.provider,
        base_url: config.base_url,
        model: config.model,
        dimension: dimension.unwrap_or(0),
        vectors,
    }))
}

pub fn test_connection() -> Result<EmbeddingConnectionTestResponse, EmbeddingError> {
    let Some(config) = config::embedding_config()? else {
        return Err(EmbeddingError::Disabled);
    };
    let batch = embed_openai_compat(
        &config,
        &["框选精读 embedding connectivity probe".to_string()],
    )?;

    Ok(EmbeddingConnectionTestResponse {
        provider: config.provider,
        model: config.model,
        dimension: batch.dimension,
        ok: true,
    })
}

fn embed_openai_compat(
    config: &EmbeddingConfig,
    texts: &[String],
) -> Result<EmbeddingBatch, EmbeddingError> {
    let body = json!({
        "model": config.model,
        "input": texts,
    });
    let response = embedding_client()?
        .post(embeddings_url(&config.base_url))
        .headers(bearer_headers(&config.api_key)?)
        .json(&body)
        .send()?;

    let status = response.status();
    let text = response.text()?;
    if !status.is_success() {
        return Err(EmbeddingError::Provider {
            status: status.as_u16(),
            body: text,
        });
    }

    let mut parsed: EmbeddingsResponse =
        serde_json::from_str(&text).map_err(|_| EmbeddingError::Provider {
            status: status.as_u16(),
            body: text.clone(),
        })?;
    if parsed.data.len() != texts.len() {
        return Err(EmbeddingError::CountMismatch {
            expected: texts.len(),
            actual: parsed.data.len(),
        });
    }
    if parsed.data.iter().all(|item| item.index.is_some()) {
        parsed
            .data
            .sort_by_key(|item| item.index.expect("index checked above"));
    }

    let vectors = parsed
        .data
        .into_iter()
        .map(|item| item.embedding)
        .collect::<Vec<_>>();
    let dimension = vectors.first().map(Vec::len).unwrap_or(0);
    if dimension == 0 {
        return Err(EmbeddingError::EmptyVector);
    }
    if vectors.iter().any(|vector| vector.len() != dimension) {
        return Err(EmbeddingError::DimensionMismatch);
    }
    if let Some(expected) = config.expected_dimension {
        if dimension != expected {
            return Err(EmbeddingError::ExpectedDimensionMismatch {
                expected,
                actual: dimension,
            });
        }
    }

    Ok(EmbeddingBatch {
        provider: config.provider.clone(),
        base_url: config.base_url.clone(),
        model: config.model.clone(),
        dimension,
        vectors,
    })
}

fn embedding_client() -> Result<Client, EmbeddingError> {
    let request_timeout = env_timeout_secs(
        "EMBEDDING_REQUEST_TIMEOUT_SECS",
        DEFAULT_EMBEDDING_REQUEST_TIMEOUT_SECS,
    );
    let connect_timeout = env_timeout_secs(
        "EMBEDDING_CONNECT_TIMEOUT_SECS",
        DEFAULT_EMBEDDING_CONNECT_TIMEOUT_SECS,
    )
    .min(request_timeout);

    Client::builder()
        .connect_timeout(Duration::from_secs(connect_timeout))
        .timeout(Duration::from_secs(request_timeout))
        .build()
        .map_err(EmbeddingError::Http)
}

fn env_timeout_secs(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn embeddings_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/embeddings") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/embeddings")
    }
}

fn bearer_headers(api_key: &str) -> Result<HeaderMap, EmbeddingError> {
    let mut headers = HeaderMap::new();
    let value = format!("Bearer {api_key}");
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&value).map_err(|_| EmbeddingError::InvalidHeader)?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedding_timeouts_have_safe_defaults_and_env_overrides() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        std::env::remove_var("EMBEDDING_REQUEST_TIMEOUT_SECS");
        std::env::remove_var("EMBEDDING_CONNECT_TIMEOUT_SECS");
        assert_eq!(
            env_timeout_secs(
                "EMBEDDING_REQUEST_TIMEOUT_SECS",
                DEFAULT_EMBEDDING_REQUEST_TIMEOUT_SECS,
            ),
            45
        );
        assert_eq!(
            env_timeout_secs(
                "EMBEDDING_CONNECT_TIMEOUT_SECS",
                DEFAULT_EMBEDDING_CONNECT_TIMEOUT_SECS,
            ),
            10
        );

        std::env::set_var("EMBEDDING_REQUEST_TIMEOUT_SECS", "2");
        std::env::set_var("EMBEDDING_CONNECT_TIMEOUT_SECS", "0");
        assert_eq!(
            env_timeout_secs(
                "EMBEDDING_REQUEST_TIMEOUT_SECS",
                DEFAULT_EMBEDDING_REQUEST_TIMEOUT_SECS,
            ),
            2
        );
        assert_eq!(
            env_timeout_secs(
                "EMBEDDING_CONNECT_TIMEOUT_SECS",
                DEFAULT_EMBEDDING_CONNECT_TIMEOUT_SECS,
            ),
            10
        );
        assert!(embedding_client().is_ok());

        std::env::remove_var("EMBEDDING_REQUEST_TIMEOUT_SECS");
        std::env::remove_var("EMBEDDING_CONNECT_TIMEOUT_SECS");
    }
}
