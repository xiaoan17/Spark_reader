use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    path::{Path, PathBuf},
};

#[cfg(not(unix))]
use std::process::Command;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod secret_store;

use secret_store::active_secret_store;
#[cfg(test)]
use secret_store::{
    clear_override_secret_store, set_override_secret_store, KeyringSecretStore, MemorySecretStore,
    SecretStore,
};

const DEFAULT_EMBEDDING_PROVIDER: &str = "siliconflow";
const DEFAULT_EMBEDDING_BASE_URL: &str = "https://api.siliconflow.cn/v1/embeddings";
const DEFAULT_EMBEDDING_MODEL: &str = "Qwen/Qwen3-Embedding-4B";
const DEFAULT_EMBEDDING_DIMENSION: usize = 2560;
pub const DEFAULT_EMBEDDING_BATCH_SIZE: usize = 64;
const MIN_EMBEDDING_BATCH_SIZE: usize = 1;
const MAX_EMBEDDING_BATCH_SIZE: usize = 256;
const APP_CONFIG_DIR_NAME: &str = "com.anbc.focused-reading";
const SETTINGS_FILE_NAME: &str = "llm-settings.json";
const DOTENV_FILE_NAME: &str = ".env";

/// `.env` 中敏感项迁入钥匙串后留下的占位值。占位不再被迁移(幂等),读取时视为未配置。
pub const KEYCHAIN_PLACEHOLDER: &str = "moved-to-keychain";

/// 所有由后端管理、绝不进前端的敏感项(环境变量名)。非敏感配置(开关 / URL / 模型名)
/// 继续留在 `.env` / settings.json,不在此列。
const SECRET_KEYS: [&str; 5] = [
    "MINERU_API_TOKEN",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "EMBEDDING_API_KEY",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmProviderKind {
    DeepSeek,
    OpenAi,
    Anthropic,
}

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub provider: LlmProviderKind,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone)]
pub struct MinerUConfig {
    pub api_token: String,
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerUSettingsResponse {
    pub base_url: String,
    pub api_token_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMinerUSettingsRequest {
    pub api_token: Option<String>,
    pub base_url: String,
}

pub fn mineru_config_from_request(
    request: &SaveMinerUSettingsRequest,
) -> Result<MinerUConfig, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let request_token = request.api_token.as_deref().unwrap_or_default().trim();
    let api_token = if request_token.is_empty() {
        required_env("MINERU_API_TOKEN")?
    } else {
        request_token.to_string()
    };
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();
    let base_url = if base_url.is_empty() {
        active_mineru_base_url(&stored.mineru)
    } else {
        base_url
    };

    Ok(MinerUConfig {
        api_token,
        base_url,
    })
}

#[derive(Debug, Clone)]
pub struct EmbeddingConfig {
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub expected_dimension: Option<usize>,
    pub batch_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSettingsResponse {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub expected_dimension: Option<usize>,
    pub batch_size: usize,
    pub api_key_configured: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEmbeddingSettingsRequest {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
    pub expected_dimension: Option<usize>,
    pub batch_size: Option<usize>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettingsResponse {
    pub provider: LlmProviderKind,
    pub base_url: String,
    pub model: String,
    pub api_key_configured: bool,
    pub providers: BTreeMap<String, LlmProviderSettingsResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderSettingsResponse {
    pub base_url: String,
    pub model: String,
    pub api_key_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsRequest {
    pub provider: LlmProviderKind,
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmSettings {
    provider: Option<LlmProviderKind>,
    deepseek: StoredProviderSettings,
    openai: StoredProviderSettings,
    anthropic: StoredProviderSettings,
    #[serde(default)]
    embedding: StoredEmbeddingSettings,
    #[serde(default)]
    mineru: StoredMinerUSettings,
    #[serde(default)]
    obsidian: StoredObsidianSettings,
    /// 是否曾把明文 key 从 `.env` 迁入钥匙串(本次或历史)。供前端一次性提示"建议轮换
    /// 已明文落盘过的 key"。`#[serde(default)]` 保证旧 settings.json 仍能加载。
    #[serde(default)]
    had_plaintext_migration: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProviderSettings {
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEmbeddingSettings {
    provider: Option<String>,
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    expected_dimension: Option<usize>,
    batch_size: Option<usize>,
    enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMinerUSettings {
    #[serde(default, skip_serializing)]
    api_token: Option<String>,
    base_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredObsidianSettings {
    vault_path: Option<String>,
    subdir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSettingsResponse {
    pub vault_path: String,
    pub subdir: String,
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveObsidianSettingsRequest {
    pub vault_path: String,
    pub subdir: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ObsidianConfig {
    pub vault_path: PathBuf,
    pub subdir: String,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing environment variable {0}")]
    MissingEnv(&'static str),
    #[error("unsupported LLM_PROVIDER {0}")]
    UnsupportedProvider(String),
    #[error("invalid EMBEDDING_DIM {0}")]
    InvalidEmbeddingDimension(String),
    #[error("failed to resolve settings directory: {0}")]
    ResolveSettingsDir(String),
    #[error("failed to read settings: {0}")]
    ReadSettings(String),
    #[error("failed to write settings: {0}")]
    WriteSettings(String),
    #[error("secret store error: {0}")]
    SecretStore(String),
}

pub fn load_dotenv() {
    if let Ok(path) = env::var("FOCUSED_READING_ENV_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            let _ = dotenvy::from_path(path);
        }
        return;
    }
    if let Ok(path) = dotenv_path() {
        if path.exists() {
            let _ = dotenvy::from_path(path);
        }
    }
    let default_path = Path::new(".env");
    if default_path.exists() {
        let _ = dotenvy::from_path(default_path);
    }
}

pub fn llm_config() -> Result<LlmConfig, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let provider = active_llm_provider(&stored);
    llm_config_for_provider(&stored, provider)
}

pub fn llm_config_from_request(request: &SaveLlmSettingsRequest) -> Result<LlmConfig, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let saved = provider_settings(&stored, request.provider);
    let request_key = request.api_key.as_deref().unwrap_or_default().trim();
    let api_key = if request_key.is_empty() {
        env_key(request.provider)?
    } else {
        request_key.to_string()
    };
    let base_url = normalize_base_url(&request.base_url)
        .unwrap_or_else(|| active_base_url(saved, request.provider));
    let model =
        normalize_model(&request.model).unwrap_or_else(|| active_model(saved, request.provider));

    Ok(LlmConfig {
        provider: request.provider,
        api_key,
        base_url,
        model,
    })
}

pub fn mineru_config() -> Result<MinerUConfig, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    Ok(MinerUConfig {
        api_token: required_env("MINERU_API_TOKEN")?,
        base_url: active_mineru_base_url(&stored.mineru),
    })
}

pub fn get_mineru_settings() -> Result<MinerUSettingsResponse, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    Ok(MinerUSettingsResponse {
        base_url: active_mineru_base_url(&stored.mineru),
        api_token_configured: required_env("MINERU_API_TOKEN").is_ok(),
    })
}

pub fn save_mineru_settings(
    request: SaveMinerUSettingsRequest,
) -> Result<MinerUSettingsResponse, ConfigError> {
    load_dotenv();
    let mut stored = load_stored_settings()?;
    let trimmed_token = request.api_token.unwrap_or_default().trim().to_string();
    if !trimmed_token.is_empty() {
        save_secret("MINERU_API_TOKEN", &trimmed_token)?;
    }
    stored.mineru.api_token = None;
    stored.mineru.base_url = Some(request.base_url.trim().trim_end_matches('/').to_string());

    write_stored_settings(&stored)?;
    get_mineru_settings()
}

pub fn get_obsidian_settings() -> Result<ObsidianSettingsResponse, ConfigError> {
    let stored = load_stored_settings()?;
    let vault_path = stored
        .obsidian
        .vault_path
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(ObsidianSettingsResponse {
        configured: !vault_path.is_empty(),
        vault_path,
        subdir: active_obsidian_subdir(&stored.obsidian.subdir),
    })
}

pub fn save_obsidian_settings(
    request: SaveObsidianSettingsRequest,
) -> Result<ObsidianSettingsResponse, ConfigError> {
    let mut stored = load_stored_settings()?;
    let vault_path = request.vault_path.trim().to_string();
    stored.obsidian.vault_path = if vault_path.is_empty() {
        None
    } else {
        Some(vault_path)
    };
    stored.obsidian.subdir = request
        .subdir
        .map(|subdir| subdir.trim().trim_matches('/').to_string())
        .filter(|subdir| !subdir.is_empty());
    write_stored_settings(&stored)?;
    get_obsidian_settings()
}

/// 未配置 vault 时返回 None(前端应隐藏入口,后端命令报可读错误)。
pub fn obsidian_config() -> Result<Option<ObsidianConfig>, ConfigError> {
    let settings = get_obsidian_settings()?;
    if !settings.configured {
        return Ok(None);
    }
    Ok(Some(ObsidianConfig {
        vault_path: PathBuf::from(settings.vault_path),
        subdir: settings.subdir,
    }))
}

fn active_obsidian_subdir(subdir: &Option<String>) -> String {
    subdir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_matches('/').to_string())
        .unwrap_or_else(|| crate::obsidian::DEFAULT_SUBDIR.to_string())
}

pub fn embedding_config() -> Result<Option<EmbeddingConfig>, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let provider = active_embedding_provider(&stored.embedding);
    let Some(provider) = provider else {
        return Ok(None);
    };
    if provider == "disabled" || provider == "none" {
        return Ok(None);
    }
    if !active_embedding_enabled(&stored.embedding, &provider) {
        return Ok(None);
    }

    let api_key = required_env("EMBEDDING_API_KEY")?;
    let base_url = active_embedding_base_url(&stored.embedding);
    let model = active_embedding_model(&stored.embedding)?;
    let expected_dimension = active_embedding_dimension(&stored.embedding)?;
    let batch_size = active_embedding_batch_size(&stored.embedding);

    Ok(Some(EmbeddingConfig {
        provider,
        api_key,
        base_url,
        model,
        expected_dimension,
        batch_size,
    }))
}

pub fn get_embedding_settings() -> Result<EmbeddingSettingsResponse, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let provider =
        active_embedding_provider(&stored.embedding).unwrap_or_else(|| "disabled".to_string());
    let enabled = active_embedding_enabled(&stored.embedding, &provider);

    Ok(EmbeddingSettingsResponse {
        provider,
        base_url: active_embedding_base_url(&stored.embedding),
        model: active_embedding_model(&stored.embedding).unwrap_or_default(),
        expected_dimension: active_embedding_dimension(&stored.embedding)?,
        batch_size: active_embedding_batch_size(&stored.embedding),
        api_key_configured: required_env("EMBEDDING_API_KEY").is_ok(),
        enabled,
    })
}

pub fn save_embedding_settings(
    request: SaveEmbeddingSettingsRequest,
) -> Result<EmbeddingSettingsResponse, ConfigError> {
    load_dotenv();
    let mut stored = load_stored_settings()?;
    let provider = normalize_embedding_provider(&request.provider);
    let trimmed_key = request.api_key.unwrap_or_default().trim().to_string();
    if !trimmed_key.is_empty() {
        save_secret("EMBEDDING_API_KEY", &trimmed_key)?;
    }
    stored.embedding.api_key = None;
    stored.embedding.provider = Some(if request.enabled {
        provider
    } else {
        "disabled".to_string()
    });
    stored.embedding.enabled = Some(request.enabled);
    stored.embedding.base_url = Some(request.base_url.trim().to_string());
    stored.embedding.model = Some(request.model.trim().to_string());
    stored.embedding.expected_dimension = request
        .expected_dimension
        .filter(|dimension| *dimension > 0);
    stored.embedding.batch_size = Some(clamp_embedding_batch_size(
        request.batch_size.unwrap_or(DEFAULT_EMBEDDING_BATCH_SIZE),
    ));

    write_stored_settings(&stored)?;
    get_embedding_settings()
}

pub fn get_llm_settings() -> Result<LlmSettingsResponse, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let provider = active_llm_provider(&stored);
    let active = provider_settings(&stored, provider);

    Ok(LlmSettingsResponse {
        provider,
        base_url: active_base_url(active, provider),
        model: active_model(active, provider),
        api_key_configured: env_key(provider).is_ok(),
        providers: all_provider_settings(&stored),
    })
}

pub fn save_llm_settings(
    request: SaveLlmSettingsRequest,
) -> Result<LlmSettingsResponse, ConfigError> {
    load_dotenv();
    let mut stored = load_stored_settings()?;
    stored.provider = Some(request.provider);
    let target = provider_settings_mut(&mut stored, request.provider);
    let trimmed_key = request.api_key.unwrap_or_default().trim().to_string();
    if !trimmed_key.is_empty() {
        save_secret(env_key_name(request.provider), &trimmed_key)?;
    }
    let base_url = normalize_base_url(&request.base_url)
        .unwrap_or_else(|| active_base_url(target, request.provider));
    let model =
        normalize_model(&request.model).unwrap_or_else(|| active_model(target, request.provider));
    target.api_key = None;
    target.base_url = Some(base_url);
    target.model = Some(model);

    write_stored_settings(&stored)?;

    get_llm_settings()
}

fn required_env(name: &'static str) -> Result<String, ConfigError> {
    resolve_secret(name).ok_or(ConfigError::MissingEnv(name))
}

/// 敏感项读取顺序:钥匙串 → `.env` / 进程环境(兼容旧布局/源码用户) → 无。
/// `.env` 里的占位值(已迁移)视为未配置,避免占位串被当成真 key 用出去。
fn resolve_secret(name: &str) -> Option<String> {
    if let Some(value) = active_secret_store().get(name) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != KEYCHAIN_PLACEHOLDER)
}

fn load_stored_settings() -> Result<StoredLlmSettings, ConfigError> {
    let path = settings_path()?;
    let read_path = if path.exists() {
        path.clone()
    } else if let Some(legacy_path) =
        legacy_settings_path().filter(|legacy_path| legacy_path.exists())
    {
        legacy_path
    } else {
        return Ok(StoredLlmSettings::default());
    };
    let raw =
        fs::read_to_string(&read_path).map_err(|err| ConfigError::ReadSettings(err.to_string()))?;
    let mut stored: StoredLlmSettings =
        serde_json::from_str(&raw).map_err(|err| ConfigError::ReadSettings(err.to_string()))?;
    if migrate_legacy_api_keys(&mut stored)? || read_path != path {
        write_stored_settings(&stored)?;
    }
    Ok(stored)
}

fn write_stored_settings(stored: &StoredLlmSettings) -> Result<(), ConfigError> {
    let mut stored = stored.clone();
    scrub_stored_api_keys(&mut stored);
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    }
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    fs::write(&path, json).map_err(|err| ConfigError::WriteSettings(err.to_string()))
}

fn settings_path() -> Result<PathBuf, ConfigError> {
    Ok(config_dir()?.join(SETTINGS_FILE_NAME))
}

fn dotenv_path() -> Result<PathBuf, ConfigError> {
    if let Ok(path) = env::var("FOCUSED_READING_ENV_PATH") {
        return Ok(PathBuf::from(path));
    }
    Ok(config_dir()?.join(DOTENV_FILE_NAME))
}

fn config_dir() -> Result<PathBuf, ConfigError> {
    if let Ok(path) = env::var("FOCUSED_READING_CONFIG_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    default_user_config_dir()
}

fn default_user_config_dir() -> Result<PathBuf, ConfigError> {
    if cfg!(target_os = "macos") {
        return Ok(home_dir()?
            .join("Library")
            .join("Application Support")
            .join(APP_CONFIG_DIR_NAME));
    }
    if cfg!(target_os = "windows") {
        if let Some(app_data) = env::var_os("APPDATA").filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(app_data).join(APP_CONFIG_DIR_NAME));
        }
        return Ok(home_dir()?
            .join("AppData")
            .join("Roaming")
            .join(APP_CONFIG_DIR_NAME));
    }
    if let Some(xdg_config_home) = env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(xdg_config_home).join(APP_CONFIG_DIR_NAME));
    }
    Ok(home_dir()?.join(".config").join(APP_CONFIG_DIR_NAME))
}

fn home_dir() -> Result<PathBuf, ConfigError> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| ConfigError::ResolveSettingsDir("HOME is not set".to_string()))
}

fn legacy_settings_path() -> Option<PathBuf> {
    if env::var_os("FOCUSED_READING_CONFIG_DIR").is_some() {
        return None;
    }
    env::current_dir()
        .ok()
        .map(|dir| dir.join("data").join(SETTINGS_FILE_NAME))
}

fn active_llm_provider(stored: &StoredLlmSettings) -> LlmProviderKind {
    stored.provider.unwrap_or_else(|| {
        env::var("LLM_PROVIDER")
            .ok()
            .and_then(|value| parse_provider(&value).ok())
            .unwrap_or(LlmProviderKind::DeepSeek)
    })
}

fn llm_config_for_provider(
    stored: &StoredLlmSettings,
    provider: LlmProviderKind,
) -> Result<LlmConfig, ConfigError> {
    let settings = provider_settings(stored, provider);
    Ok(LlmConfig {
        provider,
        api_key: env_key(provider)?,
        base_url: active_base_url(settings, provider),
        model: active_model(settings, provider),
    })
}

fn parse_provider(value: &str) -> Result<LlmProviderKind, ConfigError> {
    match value.trim() {
        "deepseek" | "deep_seek" => Ok(LlmProviderKind::DeepSeek),
        "openai" | "open_ai" => Ok(LlmProviderKind::OpenAi),
        "anthropic" => Ok(LlmProviderKind::Anthropic),
        other => Err(ConfigError::UnsupportedProvider(other.to_string())),
    }
}

fn provider_settings(
    stored: &StoredLlmSettings,
    provider: LlmProviderKind,
) -> &StoredProviderSettings {
    match provider {
        LlmProviderKind::DeepSeek => &stored.deepseek,
        LlmProviderKind::OpenAi => &stored.openai,
        LlmProviderKind::Anthropic => &stored.anthropic,
    }
}

fn provider_settings_mut(
    stored: &mut StoredLlmSettings,
    provider: LlmProviderKind,
) -> &mut StoredProviderSettings {
    match provider {
        LlmProviderKind::DeepSeek => &mut stored.deepseek,
        LlmProviderKind::OpenAi => &mut stored.openai,
        LlmProviderKind::Anthropic => &mut stored.anthropic,
    }
}

fn active_base_url(settings: &StoredProviderSettings, provider: LlmProviderKind) -> String {
    settings
        .base_url
        .as_deref()
        .and_then(normalize_base_url)
        .unwrap_or_else(|| match provider {
            LlmProviderKind::DeepSeek => env::var("DEEPSEEK_BASE_URL")
                .unwrap_or_else(|_| "https://api.deepseek.com".to_string()),
            LlmProviderKind::OpenAi => env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| "https://api.openai.com/v1".to_string()),
            LlmProviderKind::Anthropic => env::var("ANTHROPIC_BASE_URL")
                .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
        })
}

fn active_model(settings: &StoredProviderSettings, provider: LlmProviderKind) -> String {
    settings
        .model
        .as_deref()
        .and_then(normalize_model)
        .unwrap_or_else(|| match provider {
            LlmProviderKind::DeepSeek => {
                env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string())
            }
            LlmProviderKind::OpenAi => {
                env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5-mini".to_string())
            }
            LlmProviderKind::Anthropic => {
                env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-sonnet-4-5".to_string())
            }
        })
}

fn all_provider_settings(
    stored: &StoredLlmSettings,
) -> BTreeMap<String, LlmProviderSettingsResponse> {
    [
        LlmProviderKind::DeepSeek,
        LlmProviderKind::OpenAi,
        LlmProviderKind::Anthropic,
    ]
    .into_iter()
    .map(|provider| {
        let settings = provider_settings(stored, provider);
        (
            provider_key(provider).to_string(),
            LlmProviderSettingsResponse {
                base_url: active_base_url(settings, provider),
                model: active_model(settings, provider),
                api_key_configured: env_key(provider).is_ok(),
            },
        )
    })
    .collect()
}

fn provider_key(provider: LlmProviderKind) -> &'static str {
    match provider {
        LlmProviderKind::DeepSeek => "deep_seek",
        LlmProviderKind::OpenAi => "open_ai",
        LlmProviderKind::Anthropic => "anthropic",
    }
}

fn normalize_base_url(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_model(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn env_key(provider: LlmProviderKind) -> Result<String, ConfigError> {
    required_env(env_key_name(provider))
}

fn env_key_name(provider: LlmProviderKind) -> &'static str {
    match provider {
        LlmProviderKind::DeepSeek => "DEEPSEEK_API_KEY",
        LlmProviderKind::OpenAi => "OPENAI_API_KEY",
        LlmProviderKind::Anthropic => "ANTHROPIC_API_KEY",
    }
}

fn scrub_stored_api_keys(stored: &mut StoredLlmSettings) {
    stored.deepseek.api_key = None;
    stored.openai.api_key = None;
    stored.anthropic.api_key = None;
    stored.embedding.api_key = None;
    stored.mineru.api_token = None;
}

fn migrate_legacy_api_keys(stored: &mut StoredLlmSettings) -> Result<bool, ConfigError> {
    let mut changed = false;
    for (name, key) in [
        ("DEEPSEEK_API_KEY", stored.deepseek.api_key.take()),
        ("OPENAI_API_KEY", stored.openai.api_key.take()),
        ("ANTHROPIC_API_KEY", stored.anthropic.api_key.take()),
        ("EMBEDDING_API_KEY", stored.embedding.api_key.take()),
        ("MINERU_API_TOKEN", stored.mineru.api_token.take()),
    ] {
        if let Some(key) = key.filter(|value| !value.trim().is_empty()) {
            if required_env(name).is_err() {
                save_secret(name, &key)?;
            }
            changed = true;
        }
    }
    Ok(changed)
}

/// 保存敏感项:写入钥匙串(不再写 `.env` 明文),同步进程环境使当前会话立即生效,并把
/// `.env` 里残留的同名明文替换为占位。
fn save_secret(name: &'static str, value: &str) -> Result<(), ConfigError> {
    active_secret_store()
        .set(name, value)
        .map_err(ConfigError::SecretStore)?;
    env::set_var(name, value);
    scrub_dotenv_secret_to_placeholder(name)?;
    Ok(())
}

/// 若 `.env` 里存在该敏感项的非占位赋值,原子地替换为占位串;否则不动(不新建 `.env`)。
fn scrub_dotenv_secret_to_placeholder(name: &str) -> Result<(), ConfigError> {
    let path = dotenv_path()?;
    if !path.exists() {
        return Ok(());
    }
    let raw =
        fs::read_to_string(&path).map_err(|err| ConfigError::ReadSettings(err.to_string()))?;
    let mut changed = false;
    let lines = raw
        .lines()
        .map(|line| {
            if line.trim_start().starts_with('#') {
                return line.to_string();
            }
            let Some((key, current)) = line.split_once('=') else {
                return line.to_string();
            };
            if key.trim() == name && current.trim() != KEYCHAIN_PLACEHOLDER {
                changed = true;
                format_dotenv_assignment(name, KEYCHAIN_PLACEHOLDER)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>();
    if !changed {
        return Ok(());
    }
    write_dotenv_atomic(&path, &lines)
}

/// 原子写 `.env`:写临时文件 → 收紧权限 → rename 覆盖。同目录 rename 在 unix 上是原子的,
/// 避免半截写坏配置。
fn write_dotenv_atomic(path: &Path, lines: &[String]) -> Result<(), ConfigError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    }
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| ConfigError::WriteSettings("dotenv path has no file name".to_string()))?;
    let tmp_path = path.with_file_name(format!("{file_name}.{}.tmp", std::process::id()));

    let mut output = lines.join("\n");
    output.push('\n');
    fs::write(&tmp_path, output).map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    if let Err(err) = restrict_secret_file_permissions(&tmp_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }
    if let Err(err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(ConfigError::WriteSettings(err.to_string()));
    }
    Ok(())
}

#[cfg(unix)]
fn restrict_secret_file_permissions(path: &Path) -> Result<(), ConfigError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|err| ConfigError::WriteSettings(err.to_string()))
}

#[cfg(not(unix))]
fn restrict_secret_file_permissions(path: &Path) -> Result<(), ConfigError> {
    if !cfg!(windows) {
        return Ok(());
    }
    let path_arg = path.to_string_lossy().to_string();
    let current_user = env::var("USERNAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| env::var("USER").ok())
        .unwrap_or_else(|| "%USERNAME%".to_string());
    let status = Command::new("icacls")
        .arg(&path_arg)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{current_user}:(R,W)"))
        .arg("/remove:g")
        .arg("Everyone")
        .arg("Users")
        .status()
        .map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    if !status.success() {
        return Err(ConfigError::WriteSettings(format!(
            "failed to restrict secret file ACL with icacls: {status}"
        )));
    }
    Ok(())
}

fn format_dotenv_assignment(name: &str, value: &str) -> String {
    let simple = value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/' | ':' | '+'));
    if simple {
        format!("{name}={value}")
    } else {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        format!("{name}=\"{escaped}\"")
    }
}

fn active_embedding_provider(settings: &StoredEmbeddingSettings) -> Option<String> {
    Some(
        settings
            .provider
            .clone()
            .or_else(|| env::var("EMBEDDING_PROVIDER").ok())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_EMBEDDING_PROVIDER.to_string()),
    )
    .map(|value| normalize_embedding_provider(&value))
    .filter(|value| !value.is_empty())
}

fn normalize_embedding_provider(value: &str) -> String {
    value.trim().to_lowercase()
}

fn active_embedding_enabled(settings: &StoredEmbeddingSettings, provider: &str) -> bool {
    if provider == "disabled" || provider == "none" {
        return false;
    }
    settings.enabled.unwrap_or(true)
}

fn active_embedding_base_url(settings: &StoredEmbeddingSettings) -> String {
    settings
        .base_url
        .clone()
        .or_else(|| env::var("EMBEDDING_BASE_URL").ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_EMBEDDING_BASE_URL.to_string())
}

fn active_embedding_model(settings: &StoredEmbeddingSettings) -> Result<String, ConfigError> {
    Ok(settings
        .model
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| env::var("EMBEDDING_MODEL").ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_EMBEDDING_MODEL.to_string()))
}

fn active_embedding_dimension(
    settings: &StoredEmbeddingSettings,
) -> Result<Option<usize>, ConfigError> {
    if let Some(dimension) = settings.expected_dimension {
        return Ok(Some(dimension));
    }
    env::var("EMBEDDING_DIM")
        .ok()
        .or_else(|| env::var("EMBEDDING_EXPECTED_DIM").ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| ConfigError::InvalidEmbeddingDimension(value))
        })
        .transpose()
        .map(|dimension| dimension.or(Some(DEFAULT_EMBEDDING_DIMENSION)))
}

fn active_embedding_batch_size(settings: &StoredEmbeddingSettings) -> usize {
    env::var("EMBEDDING_BATCH_SIZE")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .or(settings.batch_size)
        .map(clamp_embedding_batch_size)
        .unwrap_or(DEFAULT_EMBEDDING_BATCH_SIZE)
}

fn clamp_embedding_batch_size(value: usize) -> usize {
    value.clamp(MIN_EMBEDDING_BATCH_SIZE, MAX_EMBEDDING_BATCH_SIZE)
}

fn active_mineru_base_url(settings: &StoredMinerUSettings) -> String {
    settings
        .base_url
        .clone()
        .or_else(|| env::var("MINERU_BASE_URL").ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .unwrap_or_else(|| "https://mineru.net".to_string())
}

/// 单个敏感项当前的存放位置。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecretLocation {
    /// 已在系统钥匙串。
    Keychain,
    /// 仍以明文留在 `.env` / 进程环境。
    EnvPlaintext,
    /// `.env` 里是迁移占位(已迁走,但钥匙串当前查不到)。
    Placeholder,
    /// 三处都没有。
    Absent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretItemStatus {
    pub name: String,
    pub location: SecretLocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStorageStatus {
    pub items: Vec<SecretItemStatus>,
    /// 本次或历史上是否发生过明文迁移(供前端一次性"建议轮换 key" banner)。
    pub had_plaintext_migration: bool,
}

/// 迁移一次的结果,供启动流程记录日志。历史累计标记通过 [`secret_storage_status`] 查询。
#[derive(Debug, Clone, Copy)]
pub struct SecretMigrationOutcome {
    /// 本次调用是否实际迁移/清理了明文项。
    pub migrated_now: bool,
}

/// 用 dotenvy 解析 `.env` 的赋值(不写进程环境),便于拿到已去引号的真实值。
fn parse_dotenv_assignments(path: &Path) -> Result<HashMap<String, String>, ConfigError> {
    let mut map = HashMap::new();
    let iter = dotenvy::from_path_iter(path)
        .map_err(|err| ConfigError::ReadSettings(err.to_string()))?;
    for item in iter {
        let (key, value) = item.map_err(|err| ConfigError::ReadSettings(err.to_string()))?;
        map.insert(key, value);
    }
    Ok(map)
}

/// 启动时把 `.env` 中的明文敏感项迁入钥匙串,并把该项替换为占位。幂等:占位/空值跳过,
/// 已在钥匙串中的项不会被 `.env` 里的旧值覆盖(仅清理明文)。任一项曾明文落盘即置持久
/// 标记 `had_plaintext_migration`。
pub fn migrate_dotenv_secrets_to_keychain() -> Result<SecretMigrationOutcome, ConfigError> {
    let mut stored = load_stored_settings()?;
    let path = dotenv_path()?;
    let mut migrated_now = false;

    if path.exists() {
        let parsed = parse_dotenv_assignments(&path)?;
        let store = active_secret_store();
        for name in SECRET_KEYS {
            let Some(raw) = parsed.get(name) else {
                continue;
            };
            let value = raw.trim();
            if value.is_empty() || value == KEYCHAIN_PLACEHOLDER {
                continue;
            }
            // 真实明文:钥匙串没有才写入(不拿旧 .env 覆盖更新的钥匙串值),随后清理明文。
            if store.get(name).is_none() {
                store
                    .set(name, value)
                    .map_err(ConfigError::SecretStore)?;
            }
            scrub_dotenv_secret_to_placeholder(name)?;
            migrated_now = true;
        }
    }

    if migrated_now && stored.had_plaintext_migration != Some(true) {
        stored.had_plaintext_migration = Some(true);
        write_stored_settings(&stored)?;
    }

    Ok(SecretMigrationOutcome { migrated_now })
}

/// 返回每个敏感项的存放位置 + 历史明文迁移标记,供前端设置页展示与 banner 决策。
pub fn secret_storage_status() -> Result<SecretStorageStatus, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let path = dotenv_path()?;
    let parsed = if path.exists() {
        parse_dotenv_assignments(&path).unwrap_or_default()
    } else {
        HashMap::new()
    };
    let store = active_secret_store();

    let items = SECRET_KEYS
        .iter()
        .map(|name| {
            let location = secret_location(name, store.as_ref(), &parsed);
            SecretItemStatus {
                name: (*name).to_string(),
                location,
            }
        })
        .collect();

    Ok(SecretStorageStatus {
        items,
        had_plaintext_migration: stored.had_plaintext_migration.unwrap_or(false),
    })
}

fn secret_location(
    name: &str,
    store: &dyn secret_store::SecretStore,
    parsed_dotenv: &HashMap<String, String>,
) -> SecretLocation {
    if store.get(name).is_some() {
        return SecretLocation::Keychain;
    }
    if let Some(value) = parsed_dotenv
        .get(name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return if value == KEYCHAIN_PLACEHOLDER {
            SecretLocation::Placeholder
        } else {
            SecretLocation::EnvPlaintext
        };
    }
    // 不在 .env 文件里,但可能通过真实 shell 环境导出。
    let in_process_env = env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != KEYCHAIN_PLACEHOLDER)
        .is_some();
    if in_process_env {
        SecretLocation::EnvPlaintext
    } else {
        SecretLocation::Absent
    }
}

#[cfg(test)]
mod tests;
