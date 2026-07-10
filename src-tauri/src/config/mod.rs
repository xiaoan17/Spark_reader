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
// Live smokes outside this module (e.g. responses_bridge) must opt into the
// real keychain the same way config's own live tests do.
#[cfg(test)]
pub(crate) use secret_store::{
    set_override_secret_store as set_override_secret_store_for_tests,
    KeyringSecretStore as KeyringSecretStoreForTests,
};
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

/// 历史遗留:旧版本曾把明文迁入钥匙串并在 `.env` 留下这个占位。现在默认后端是本地文件,
/// 不再写占位,但读取时仍把它当作"未配置"跳过,兼容跑过旧版的开发机。
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

/// 本地明文密钥文件名(与 `llm-settings.json` 同目录)。默认后端 `FileSecretStore` 的落盘处。
const SECRETS_FILE_NAME: &str = "secrets.json";

/// 敏感项存储后端。默认本地明文文件(零系统交互、发版不弹框);
/// `FOCUSED_READING_SECRET_BACKEND=keychain` 才走系统钥匙串(opt-in)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretBackend {
    File,
    Keychain,
}

fn secret_backend() -> SecretBackend {
    match env::var("FOCUSED_READING_SECRET_BACKEND")
        .ok()
        .as_deref()
        .map(str::trim)
    {
        Some(value) if value.eq_ignore_ascii_case("keychain") => SecretBackend::Keychain,
        _ => SecretBackend::File,
    }
}

fn secret_backend_label() -> &'static str {
    match secret_backend() {
        SecretBackend::File => "file",
        SecretBackend::Keychain => "keychain",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmProviderKind {
    DeepSeek,
    OpenAi,
    Anthropic,
}

/// Which model drives the Codex agent (Spark deep reading + translation).
///
/// - `App` (default): the app's configured LLM (default DeepSeek) drives codex
///   through the local Responses bridge (`responses_bridge`); codex never sees
///   the machine's `~/.codex` login and the provider key stays in Rust.
/// - `CodexLocal`: codex uses whatever provider its own `~/.codex` config is
///   logged into (the pre-bridge behavior), for advanced users who prefer it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentModelSource {
    #[default]
    App,
    CodexLocal,
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
    /// Which model drives the Codex agent (app-configured vs machine-local codex).
    pub agent_model_source: AgentModelSource,
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
    /// 驱动 Codex agent 的模型来源(应用内配置 / 本机 Codex 登录)。缺省即"应用内"。
    #[serde(default)]
    agent_model_source: Option<AgentModelSource>,
    /// 反向迁移(钥匙串→本地文件)是否已完整跑过一趟。置真后启动直接短路,连钥匙串探测都
    /// 省掉,保证"一次弹窗后永不再弹"。`#[serde(default)]` 保证旧 settings.json 仍能加载。
    #[serde(default)]
    keychain_import_done: Option<bool>,
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
        agent_model_source: stored.agent_model_source.unwrap_or_default(),
    })
}

/// The model source that drives the Codex agent. Reads the stored setting,
/// defaulting to `App` (app-configured model via the Responses bridge).
pub fn agent_model_source() -> AgentModelSource {
    load_stored_settings()
        .map(|stored| stored.agent_model_source.unwrap_or_default())
        .unwrap_or_default()
}

/// Persist the Agent model source toggle and echo back the full LLM settings.
pub fn save_agent_model_source(
    source: AgentModelSource,
) -> Result<LlmSettingsResponse, ConfigError> {
    let mut stored = load_stored_settings()?;
    stored.agent_model_source = Some(source);
    write_stored_settings(&stored)?;
    get_llm_settings()
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

/// 保存敏感项:写入当前后端(默认本地文件),并同步进程环境使当前会话立即生效。
/// 不再触碰 `.env`——本地文件是唯一真相。
fn save_secret(name: &'static str, value: &str) -> Result<(), ConfigError> {
    active_secret_store()
        .set(name, value)
        .map_err(ConfigError::SecretStore)?;
    env::set_var(name, value);
    Ok(())
}

fn secrets_file_path() -> Result<PathBuf, ConfigError> {
    Ok(config_dir()?.join(SECRETS_FILE_NAME))
}

fn read_secrets_file(path: &Path) -> Result<BTreeMap<String, String>, ConfigError> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = fs::read_to_string(path).map_err(|err| ConfigError::ReadSettings(err.to_string()))?;
    if raw.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&raw).map_err(|err| ConfigError::ReadSettings(err.to_string()))
}

/// 原子写 `secrets.json`:写临时文件 → 收紧权限(600) → rename 覆盖。避免半截写坏。
fn write_secrets_file_atomic(
    path: &Path,
    secrets: &BTreeMap<String, String>,
) -> Result<(), ConfigError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    }
    let mut output = serde_json::to_string_pretty(secrets)
        .map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    output.push('\n');
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| ConfigError::WriteSettings("secrets path has no file name".to_string()))?;
    let tmp_path = path.with_file_name(format!("{file_name}.{}.tmp", std::process::id()));

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

/// 以下三个 `file_secret_*` 是 `FileSecretStore` 的真实现,集中放在 config 模块与其它配置
/// IO 一处;`secret_store::FileSecretStore` 只做薄委托。
fn file_secret_get(name: &str) -> Option<String> {
    let path = secrets_file_path().ok()?;
    let secrets = read_secrets_file(&path).ok()?;
    secrets
        .get(name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn file_secret_set(name: &str, value: &str) -> Result<(), ConfigError> {
    let path = secrets_file_path()?;
    let mut secrets = read_secrets_file(&path)?;
    secrets.insert(name.to_string(), value.to_string());
    write_secrets_file_atomic(&path, &secrets)
}

fn file_secret_delete(name: &str) -> Result<(), ConfigError> {
    let path = secrets_file_path()?;
    let mut secrets = read_secrets_file(&path)?;
    if secrets.remove(name).is_none() {
        return Ok(());
    }
    write_secrets_file_atomic(&path, &secrets)
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
    /// 在本地明文文件 `secrets.json`(默认后端)。
    LocalFile,
    /// 仅在系统钥匙串(旧数据未迁移,或 opt-in 钥匙串后端)。
    Keychain,
    /// 仅以明文留在 `.env` / 进程环境(旧布局 / 源码用户)。
    EnvPlaintext,
    /// 哪都没有。
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
    /// 当前生效的后端:`"file"`(默认本地明文)或 `"keychain"`(opt-in)。
    pub backend: String,
    pub items: Vec<SecretItemStatus>,
}

/// 反向迁移一次的结果,供启动流程记录日志。
#[derive(Debug, Clone, Copy)]
pub struct SecretMigrationOutcome {
    /// 本次调用是否实际把 key 从钥匙串搬回了本地文件。
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

/// 反向迁移:把历史存在系统钥匙串里的 key 搬回本地文件,再**删掉钥匙串条目**。读钥匙串里
/// 已存在的条目会触发最后一次授权弹窗(adhoc 签名下不可避免),迁移+删除后从此永不再弹。
///
/// 仅在默认文件后端下运行;钥匙串 opt-in 时钥匙串本身就是 store,无需搬运。持久标记
/// `keychain_import_done` 保证整个反向迁移至多干净跑一趟,之后启动直接短路(连不存在的
/// 条目探测都省掉)。幂等。
pub fn migrate_keychain_secrets_to_file() -> Result<SecretMigrationOutcome, ConfigError> {
    migrate_keychain_secrets_to_file_with(&secret_store::KeyringSecretStore)
}

/// 以可注入的钥匙串 store 实现反向迁移,便于测试用内存 mock 当"假钥匙串"。
fn migrate_keychain_secrets_to_file_with(
    keychain: &dyn secret_store::SecretStore,
) -> Result<SecretMigrationOutcome, ConfigError> {
    if secret_backend() != SecretBackend::File {
        return Ok(SecretMigrationOutcome { migrated_now: false });
    }
    let mut stored = load_stored_settings()?;
    if stored.keychain_import_done == Some(true) {
        return Ok(SecretMigrationOutcome { migrated_now: false });
    }

    let mut migrated_now = false;
    let mut had_error = false;
    for name in SECRET_KEYS {
        // 本地文件已有 → 跳过,连钥匙串都不碰(不弹窗)。
        if file_secret_get(name).is_some() {
            continue;
        }
        // 钥匙串没有该条目时 get 不弹窗(errSecItemNotFound);有才弹一次。
        let Some(value) = keychain.get(name) else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if let Err(err) = file_secret_set(name, value) {
            eprintln!("keychain->file import failed for {name}: {err}");
            had_error = true;
            continue;
        }
        // 搬运成功后删掉钥匙串条目,从此不再弹。
        if let Err(err) = keychain.delete(name) {
            eprintln!("failed to remove migrated keychain entry {name}: {err}");
            had_error = true;
        }
        migrated_now = true;
    }

    // 干净跑完一趟(哪怕没搬任何东西)就落标记,后续启动直接短路。
    if !had_error {
        stored.keychain_import_done = Some(true);
        write_stored_settings(&stored)?;
    }

    Ok(SecretMigrationOutcome { migrated_now })
}

/// 返回当前后端 + 每个敏感项的存放位置,供前端设置页展示。
///
/// **默认文件后端下绝不探测钥匙串**(那会重新弹框);因此钥匙串里遗留、尚未被启动反向迁移
/// 搬走的 key 会显示为 `absent` 而非 `keychain`。正常升级路径下启动即已把钥匙串搬空,用户
/// 打开设置页时都是 `local-file`。
pub fn secret_storage_status() -> Result<SecretStorageStatus, ConfigError> {
    load_dotenv();
    let path = dotenv_path()?;
    let parsed = if path.exists() {
        parse_dotenv_assignments(&path).unwrap_or_default()
    } else {
        HashMap::new()
    };
    let store = active_secret_store();
    let backend = secret_backend();

    let items = SECRET_KEYS
        .iter()
        .map(|name| SecretItemStatus {
            name: (*name).to_string(),
            location: secret_location(name, store.as_ref(), backend, &parsed),
        })
        .collect();

    Ok(SecretStorageStatus {
        backend: secret_backend_label().to_string(),
        items,
    })
}

fn secret_location(
    name: &str,
    store: &dyn secret_store::SecretStore,
    backend: SecretBackend,
    parsed_dotenv: &HashMap<String, String>,
) -> SecretLocation {
    // 只探测当前后端(文件后端下不碰钥匙串,避免弹框)。
    if store.get(name).is_some() {
        return match backend {
            SecretBackend::File => SecretLocation::LocalFile,
            SecretBackend::Keychain => SecretLocation::Keychain,
        };
    }
    let in_dotenv_plaintext = parsed_dotenv
        .get(name)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && *value != KEYCHAIN_PLACEHOLDER)
        .is_some();
    if in_dotenv_plaintext {
        return SecretLocation::EnvPlaintext;
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
