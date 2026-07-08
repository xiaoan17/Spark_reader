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
            batch_size: Some(DEFAULT_EMBEDDING_BATCH_SIZE),
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
        assert_dotenv_permissions_are_private(&env_path);
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
            batch_size: Some(DEFAULT_EMBEDDING_BATCH_SIZE),
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
        restore_writable_permissions(&cwd);
        let _ = fs::remove_dir_all(&dir);
        restore_home(previous_home);
        clear_config_path_env();
        env::remove_var("EMBEDDING_API_KEY");
    }

    #[cfg(unix)]
    fn restore_writable_permissions(path: &Path) {
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).expect("restore writable");
    }

    #[cfg(not(unix))]
    fn restore_writable_permissions(path: &Path) {
        let mut writable_permissions = fs::metadata(path).expect("metadata").permissions();
        writable_permissions.set_readonly(false);
        fs::set_permissions(path, writable_permissions).expect("restore writable");
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
        assert_dotenv_permissions_are_private(&env_path);
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
    fn llm_settings_roundtrip_custom_openai_compatible_provider() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("llm-openai-compatible");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("OPENAI_API_KEY");
        env::remove_var("OPENAI_BASE_URL");
        env::remove_var("OPENAI_MODEL");
        let env_path = isolated_env_path(&dir);

        let saved = save_llm_settings(SaveLlmSettingsRequest {
            provider: LlmProviderKind::OpenAi,
            api_key: Some("openai-compatible-key".to_string()),
            base_url: " https://gateway.example.com/openai/v1/ ".to_string(),
            model: " custom-openai-model ".to_string(),
        })
        .expect("settings should save");

        assert_eq!(saved.provider, LlmProviderKind::OpenAi);
        assert_eq!(saved.base_url, "https://gateway.example.com/openai/v1");
        assert_eq!(saved.model, "custom-openai-model");
        assert!(saved.api_key_configured);
        assert_eq!(
            saved
                .providers
                .get("open_ai")
                .expect("openai provider settings")
                .base_url,
            "https://gateway.example.com/openai/v1"
        );
        assert_eq!(
            saved
                .providers
                .get("anthropic")
                .expect("anthropic provider settings")
                .base_url,
            "https://api.anthropic.com"
        );

        let config = llm_config().expect("LLM config should load");
        assert_eq!(config.provider, LlmProviderKind::OpenAi);
        assert_eq!(config.api_key, "openai-compatible-key");
        assert_eq!(config.base_url, "https://gateway.example.com/openai/v1");
        assert_eq!(config.model, "custom-openai-model");
        let dotenv = fs::read_to_string(&env_path).expect("dotenv should exist");
        assert!(dotenv.contains("OPENAI_API_KEY=openai-compatible-key"));
        let json = fs::read_to_string(dir.join("llm-settings.json")).expect("settings JSON");
        assert!(json.contains("https://gateway.example.com/openai/v1"));
        assert!(!json.contains("openai-compatible-key"));

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("OPENAI_API_KEY");
    }

    #[test]
    fn llm_config_from_request_uses_unsaved_anthropic_draft() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("llm-unsaved-anthropic-draft");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("ANTHROPIC_API_KEY");
        env::remove_var("ANTHROPIC_BASE_URL");
        env::remove_var("ANTHROPIC_MODEL");
        let _ = isolated_env_path(&dir);

        let config = llm_config_from_request(&SaveLlmSettingsRequest {
            provider: LlmProviderKind::Anthropic,
            api_key: Some("unsaved-anthropic-key".to_string()),
            base_url: " https://gateway.example.com/anthropic/ ".to_string(),
            model: " custom-anthropic-model ".to_string(),
        })
        .expect("draft config should load");

        assert_eq!(config.provider, LlmProviderKind::Anthropic);
        assert_eq!(config.api_key, "unsaved-anthropic-key");
        assert_eq!(config.base_url, "https://gateway.example.com/anthropic");
        assert_eq!(config.model, "custom-anthropic-model");
        assert!(
            !dir.join(".env").exists(),
            "testing a draft config must not persist the draft key"
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("ANTHROPIC_API_KEY");
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
        assert_dotenv_permissions_are_private(&env_path);
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
    fn mineru_config_from_request_uses_unsaved_draft_without_persisting() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("mineru-draft-config");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("MINERU_API_TOKEN");
        env::remove_var("MINERU_BASE_URL");
        let env_path = isolated_env_path(&dir);

        let config = mineru_config_from_request(&SaveMinerUSettingsRequest {
            api_token: Some("mineru-draft-token".to_string()),
            base_url: " https://mineru.net/ ".to_string(),
        })
        .expect("draft MinerU config should load");

        assert_eq!(config.api_token, "mineru-draft-token");
        assert_eq!(config.base_url, "https://mineru.net");
        assert!(
            !env_path.exists(),
            "testing a draft MinerU token must not persist it"
        );

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
        assert_dotenv_permissions_are_private(&env_path);
        let json = fs::read_to_string(dir.join("llm-settings.json")).expect("settings JSON");
        assert!(!json.contains("legacy-deepseek-key"));
        assert!(!json.contains("legacy-embedding-key"));

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("DEEPSEEK_API_KEY");
        env::remove_var("EMBEDDING_API_KEY");
    }

    #[cfg(unix)]
    fn assert_dotenv_permissions_are_private(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(path)
            .expect("dotenv metadata should exist")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[cfg(not(unix))]
    fn assert_dotenv_permissions_are_private(_path: &Path) {}
