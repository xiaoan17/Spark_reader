use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_EMBEDDING_PROVIDER: &str = "siliconflow";
const DEFAULT_EMBEDDING_BASE_URL: &str = "https://api.siliconflow.cn/v1/embeddings";
const DEFAULT_EMBEDDING_MODEL: &str = "Qwen/Qwen3-Embedding-4B";
const DEFAULT_EMBEDDING_DIMENSION: usize = 2560;
const APP_CONFIG_DIR_NAME: &str = "com.anbc.focused-reading";
const SETTINGS_FILE_NAME: &str = "llm-settings.json";
const DOTENV_FILE_NAME: &str = ".env";

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

#[derive(Debug, Clone)]
pub struct EmbeddingConfig {
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub expected_dimension: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSettingsResponse {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub expected_dimension: Option<usize>,
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
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettingsResponse {
    pub provider: LlmProviderKind,
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
    enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMinerUSettings {
    #[serde(default, skip_serializing)]
    api_token: Option<String>,
    base_url: Option<String>,
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

    let provider = stored.provider.unwrap_or_else(|| {
        env::var("LLM_PROVIDER")
            .ok()
            .and_then(|value| parse_provider(&value).ok())
            .unwrap_or(LlmProviderKind::DeepSeek)
    });

    match provider {
        LlmProviderKind::DeepSeek => Ok(LlmConfig {
            provider: LlmProviderKind::DeepSeek,
            api_key: env_key(LlmProviderKind::DeepSeek)?,
            base_url: stored.deepseek.base_url.unwrap_or_else(|| {
                env::var("DEEPSEEK_BASE_URL")
                    .unwrap_or_else(|_| "https://api.deepseek.com".to_string())
            }),
            model: stored.deepseek.model.unwrap_or_else(|| {
                env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string())
            }),
        }),
        LlmProviderKind::OpenAi => Ok(LlmConfig {
            provider: LlmProviderKind::OpenAi,
            api_key: env_key(LlmProviderKind::OpenAi)?,
            base_url: stored.openai.base_url.unwrap_or_else(|| {
                env::var("OPENAI_BASE_URL")
                    .unwrap_or_else(|_| "https://api.openai.com/v1".to_string())
            }),
            model: stored.openai.model.unwrap_or_else(|| {
                env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5-mini".to_string())
            }),
        }),
        LlmProviderKind::Anthropic => Ok(LlmConfig {
            provider: LlmProviderKind::Anthropic,
            api_key: env_key(LlmProviderKind::Anthropic)?,
            base_url: stored.anthropic.base_url.unwrap_or_else(|| {
                env::var("ANTHROPIC_BASE_URL")
                    .unwrap_or_else(|_| "https://api.anthropic.com".to_string())
            }),
            model: stored.anthropic.model.unwrap_or_else(|| {
                env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-4-5-sonnet".to_string())
            }),
        }),
    }
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
        save_secret_to_dotenv("MINERU_API_TOKEN", &trimmed_token)?;
    }
    stored.mineru.api_token = None;
    stored.mineru.base_url = Some(request.base_url.trim().trim_end_matches('/').to_string());

    write_stored_settings(&stored)?;
    get_mineru_settings()
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

    Ok(Some(EmbeddingConfig {
        provider,
        api_key,
        base_url,
        model,
        expected_dimension,
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
        save_secret_to_dotenv("EMBEDDING_API_KEY", &trimmed_key)?;
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

    write_stored_settings(&stored)?;
    get_embedding_settings()
}

pub fn get_llm_settings() -> Result<LlmSettingsResponse, ConfigError> {
    load_dotenv();
    let stored = load_stored_settings()?;
    let provider = stored.provider.unwrap_or_else(|| {
        env::var("LLM_PROVIDER")
            .ok()
            .and_then(|value| parse_provider(&value).ok())
            .unwrap_or(LlmProviderKind::DeepSeek)
    });
    let active = provider_settings(&stored, provider);

    Ok(LlmSettingsResponse {
        provider,
        base_url: active_base_url(active, provider),
        model: active_model(active, provider),
        api_key_configured: env_key(provider).is_ok(),
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
        save_secret_to_dotenv(env_key_name(request.provider), &trimmed_key)?;
    }
    target.api_key = None;
    target.base_url = Some(request.base_url.trim().to_string());
    target.model = Some(request.model.trim().to_string());

    write_stored_settings(&stored)?;

    get_llm_settings()
}

fn required_env(name: &'static str) -> Result<String, ConfigError> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ConfigError::MissingEnv(name))
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

fn parse_provider(value: &str) -> Result<LlmProviderKind, ConfigError> {
    match value {
        "deepseek" => Ok(LlmProviderKind::DeepSeek),
        "openai" => Ok(LlmProviderKind::OpenAi),
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
    settings.base_url.clone().unwrap_or_else(|| match provider {
        LlmProviderKind::DeepSeek => {
            env::var("DEEPSEEK_BASE_URL").unwrap_or_else(|_| "https://api.deepseek.com".to_string())
        }
        LlmProviderKind::OpenAi => {
            env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string())
        }
        LlmProviderKind::Anthropic => env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
    })
}

fn active_model(settings: &StoredProviderSettings, provider: LlmProviderKind) -> String {
    settings.model.clone().unwrap_or_else(|| match provider {
        LlmProviderKind::DeepSeek => {
            env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string())
        }
        LlmProviderKind::OpenAi => {
            env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5-mini".to_string())
        }
        LlmProviderKind::Anthropic => {
            env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-4-5-sonnet".to_string())
        }
    })
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
                save_secret_to_dotenv(name, &key)?;
            }
            changed = true;
        }
    }
    Ok(changed)
}

fn save_secret_to_dotenv(name: &'static str, value: &str) -> Result<(), ConfigError> {
    let path = dotenv_path()?;
    let raw = if path.exists() {
        fs::read_to_string(&path).map_err(|err| ConfigError::ReadSettings(err.to_string()))?
    } else {
        String::new()
    };
    let mut found = false;
    let mut lines = raw
        .lines()
        .map(|line| {
            let key = line.trim_start().split_once('=').map(|(key, _)| key.trim());
            if key == Some(name) && !line.trim_start().starts_with('#') {
                found = true;
                format_dotenv_assignment(name, value)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>();
    if !found {
        lines.push(format_dotenv_assignment(name, value));
    }
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    }
    let mut output = lines.join("\n");
    output.push('\n');
    fs::write(&path, output).map_err(|err| ConfigError::WriteSettings(err.to_string()))?;
    env::set_var(name, value);
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

fn active_mineru_base_url(settings: &StoredMinerUSettings) -> String {
    settings
        .base_url
        .clone()
        .or_else(|| env::var("MINERU_BASE_URL").ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .unwrap_or_else(|| "https://mineru.net".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "focused-reading-config-{}-{}",
            name,
            std::process::id()
        ))
    }

    fn isolated_env_path(dir: &Path) -> PathBuf {
        let env_path = dir.join(".env");
        env::set_var("FOCUSED_READING_ENV_PATH", &env_path);
        env_path
    }

    fn clear_config_path_env() {
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
    }

    fn restore_home(previous_home: Option<std::ffi::OsString>) {
        if let Some(home) = previous_home {
            env::set_var("HOME", home);
        } else {
            env::remove_var("HOME");
        }
    }

    #[test]
    fn embedding_settings_roundtrip_and_config_loads() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("embedding-roundtrip");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::set_var("EMBEDDING_PROVIDER", "disabled");
        env::remove_var("EMBEDDING_API_KEY");
        let env_path = isolated_env_path(&dir);

        let saved = save_embedding_settings(SaveEmbeddingSettingsRequest {
            provider: "siliconflow".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: "https://api.siliconflow.cn/v1/embeddings".to_string(),
            model: "Qwen/Qwen3-Embedding-4B".to_string(),
            expected_dimension: Some(2560),
            enabled: true,
        })
        .expect("settings should save");

        assert!(saved.enabled);
        assert_eq!(saved.provider, "siliconflow");
        assert_eq!(saved.expected_dimension, Some(2560));
        assert!(saved.api_key_configured);

        let config = embedding_config()
            .expect("config should load")
            .expect("embedding should be enabled");
        assert_eq!(config.provider, "siliconflow");
        assert_eq!(config.base_url, "https://api.siliconflow.cn/v1/embeddings");
        assert_eq!(config.model, "Qwen/Qwen3-Embedding-4B");
        assert_eq!(config.expected_dimension, Some(2560));
        assert_eq!(config.api_key, "test-key");
        assert!(fs::read_to_string(&env_path)
            .expect("dotenv should exist")
            .contains("EMBEDDING_API_KEY=test-key"));
        assert!(
            !fs::read_to_string(dir.join("llm-settings.json"))
                .expect("settings should exist")
                .contains("test-key"),
            "settings JSON must not persist provider secrets"
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("EMBEDDING_API_KEY");
    }

    #[test]
    fn embedding_settings_are_prefilled_from_provider_defaults() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("embedding-defaults");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        let _ = isolated_env_path(&dir);
        env::remove_var("EMBEDDING_PROVIDER");
        env::remove_var("EMBEDDING_BASE_URL");
        env::remove_var("EMBEDDING_MODEL");
        env::remove_var("EMBEDDING_DIM");
        env::remove_var("EMBEDDING_EXPECTED_DIM");
        env::remove_var("EMBEDDING_API_KEY");

        let settings = get_embedding_settings().expect("settings should load");
        assert!(settings.enabled);
        assert_eq!(settings.provider, "siliconflow");
        assert_eq!(
            settings.base_url,
            "https://api.siliconflow.cn/v1/embeddings"
        );
        assert_eq!(settings.model, "Qwen/Qwen3-Embedding-4B");
        assert_eq!(settings.expected_dimension, Some(2560));
        assert!(!settings.api_key_configured);

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("EMBEDDING_EXPECTED_DIM");
    }

    #[test]
    fn embedding_dimension_accepts_expected_dim_alias() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("embedding-dimension-alias");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        let _ = isolated_env_path(&dir);
        env::remove_var("EMBEDDING_DIM");
        env::set_var("EMBEDDING_EXPECTED_DIM", "2560");
        env::remove_var("EMBEDDING_API_KEY");

        let settings = get_embedding_settings().expect("settings should load");
        assert_eq!(settings.expected_dimension, Some(2560));

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("EMBEDDING_EXPECTED_DIM");
    }

    #[test]
    fn default_settings_path_uses_user_config_dir() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let previous_home = env::var_os("HOME");
        let dir = config_dir("default-user-config-dir");
        let home = dir.join("home");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&home).expect("home dir");
        clear_config_path_env();
        env::set_var("HOME", &home);

        let path = settings_path().expect("settings path");

        assert_eq!(
            path,
            home.join("Library")
                .join("Application Support")
                .join(APP_CONFIG_DIR_NAME)
                .join(SETTINGS_FILE_NAME)
        );
        assert!(!path.starts_with(env::current_dir().expect("current dir").join("data")));

        let _ = fs::remove_dir_all(&dir);
        restore_home(previous_home);
        clear_config_path_env();
    }

    #[test]
    fn settings_save_works_when_current_dir_is_read_only() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let previous_home = env::var_os("HOME");
        let previous_dir = env::current_dir().expect("current dir");
        let dir = config_dir("readonly-cwd");
        let home = dir.join("home");
        let cwd = dir.join("readonly");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&home).expect("home dir");
        fs::create_dir_all(&cwd).expect("readonly dir");
        clear_config_path_env();
        env::set_var("HOME", &home);
        env::remove_var("EMBEDDING_PROVIDER");
        env::remove_var("EMBEDDING_API_KEY");
        let mut readonly_permissions = fs::metadata(&cwd).expect("metadata").permissions();
        readonly_permissions.set_readonly(true);
        fs::set_permissions(&cwd, readonly_permissions).expect("set readonly");
        env::set_current_dir(&cwd).expect("enter readonly dir");

        let saved = save_embedding_settings(SaveEmbeddingSettingsRequest {
            provider: "siliconflow".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: DEFAULT_EMBEDDING_BASE_URL.to_string(),
            model: DEFAULT_EMBEDDING_MODEL.to_string(),
            expected_dimension: Some(DEFAULT_EMBEDDING_DIMENSION),
            enabled: true,
        })
        .expect("settings should save outside readonly cwd");

        assert!(saved.api_key_configured);
        assert!(home
            .join("Library")
            .join("Application Support")
            .join(APP_CONFIG_DIR_NAME)
            .join(SETTINGS_FILE_NAME)
            .exists());
        assert!(!cwd.join("data").join(SETTINGS_FILE_NAME).exists());
        assert!(!cwd.join(DOTENV_FILE_NAME).exists());

        env::set_current_dir(previous_dir).expect("restore cwd");
        let mut writable_permissions = fs::metadata(&cwd).expect("metadata").permissions();
        writable_permissions.set_readonly(false);
        fs::set_permissions(&cwd, writable_permissions).expect("restore writable");
        let _ = fs::remove_dir_all(&dir);
        restore_home(previous_home);
        clear_config_path_env();
        env::remove_var("EMBEDDING_API_KEY");
    }

    #[test]
    fn old_settings_json_without_embedding_field_still_loads() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("legacy-json");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        let _ = isolated_env_path(&dir);
        fs::write(
            dir.join("llm-settings.json"),
            r#"{
              "provider": "deep_seek",
              "deepseek": {},
              "openai": {},
              "anthropic": {}
            }"#,
        )
        .expect("legacy settings file");
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::set_var("EMBEDDING_PROVIDER", "disabled");

        let settings = get_embedding_settings().expect("settings should load");
        assert!(!settings.enabled);
        assert_eq!(settings.provider, "disabled");

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("EMBEDDING_PROVIDER");
    }

    #[test]
    fn llm_settings_save_key_to_dotenv_not_json() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("llm-secret-dotenv");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("DEEPSEEK_API_KEY");
        let env_path = isolated_env_path(&dir);

        let saved = save_llm_settings(SaveLlmSettingsRequest {
            provider: LlmProviderKind::DeepSeek,
            api_key: Some("deepseek-test-key".to_string()),
            base_url: "https://api.deepseek.com".to_string(),
            model: "deepseek-v4-flash".to_string(),
        })
        .expect("settings should save");
        assert!(saved.api_key_configured);

        let dotenv = fs::read_to_string(&env_path).expect("dotenv should exist");
        assert!(dotenv.contains("DEEPSEEK_API_KEY=deepseek-test-key"));
        let json = fs::read_to_string(dir.join("llm-settings.json")).expect("settings JSON");
        assert!(!json.contains("deepseek-test-key"));
        assert!(json.contains("deepseek-v4-flash"));

        let config = llm_config().expect("LLM config should load");
        assert_eq!(config.api_key, "deepseek-test-key");
        assert_eq!(config.model, "deepseek-v4-flash");

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("DEEPSEEK_API_KEY");
    }

    #[test]
    fn mineru_settings_save_token_to_dotenv_not_json() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("mineru-token-dotenv");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("MINERU_API_TOKEN");
        env::remove_var("MINERU_BASE_URL");
        let env_path = isolated_env_path(&dir);

        let saved = save_mineru_settings(SaveMinerUSettingsRequest {
            api_token: Some("mineru-test-token".to_string()),
            base_url: "https://mineru.net/".to_string(),
        })
        .expect("settings should save");

        assert_eq!(saved.base_url, "https://mineru.net");
        assert!(saved.api_token_configured);
        let dotenv = fs::read_to_string(&env_path).expect("dotenv should exist");
        assert!(dotenv.contains("MINERU_API_TOKEN=mineru-test-token"));
        let json = fs::read_to_string(dir.join("llm-settings.json")).expect("settings JSON");
        assert!(json.contains("https://mineru.net"));
        assert!(!json.contains("mineru-test-token"));

        let config = mineru_config().expect("MinerU config should load");
        assert_eq!(config.api_token, "mineru-test-token");
        assert_eq!(config.base_url, "https://mineru.net");

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("MINERU_API_TOKEN");
    }

    #[test]
    fn legacy_json_keys_are_migrated_to_dotenv_and_scrubbed() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("legacy-secret-migration");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("DEEPSEEK_API_KEY");
        env::remove_var("EMBEDDING_API_KEY");
        let env_path = isolated_env_path(&dir);
        fs::write(
            dir.join("llm-settings.json"),
            r#"{
              "provider": "deep_seek",
              "deepseek": {"apiKey": "legacy-deepseek-key", "model": "deepseek-v4-flash"},
              "openai": {},
              "anthropic": {},
              "embedding": {"apiKey": "legacy-embedding-key", "provider": "siliconflow"}
            }"#,
        )
        .expect("legacy settings file");

        let settings = get_embedding_settings().expect("settings should load");
        assert!(settings.api_key_configured);
        let dotenv = fs::read_to_string(&env_path).expect("dotenv should exist");
        assert!(dotenv.contains("DEEPSEEK_API_KEY=legacy-deepseek-key"));
        assert!(dotenv.contains("EMBEDDING_API_KEY=legacy-embedding-key"));
        let json = fs::read_to_string(dir.join("llm-settings.json")).expect("settings JSON");
        assert!(!json.contains("legacy-deepseek-key"));
        assert!(!json.contains("legacy-embedding-key"));

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("DEEPSEEK_API_KEY");
        env::remove_var("EMBEDDING_API_KEY");
    }
}
