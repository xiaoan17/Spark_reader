    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    /// 装一个全新的内存 store 覆盖当前后端,drop 时清除。用于不关心具体后端、只需要"某个
    /// 不碰真实钥匙串的 store"的测试。**绝不触碰真实系统钥匙串**,测试之间互不串味。
    struct SecretStoreGuard;

    impl SecretStoreGuard {
        fn install() -> Self {
            set_override_secret_store(Arc::new(MemorySecretStore::default()));
            Self
        }
    }

    impl Drop for SecretStoreGuard {
        fn drop(&mut self) {
            clear_override_secret_store();
        }
    }

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

    /// 直接读隔离 config 目录里的 `secrets.json`,断言默认文件后端真的落了盘。
    fn secret_file_value(dir: &Path, name: &str) -> Option<String> {
        let raw = fs::read_to_string(dir.join(SECRETS_FILE_NAME)).ok()?;
        let map: BTreeMap<String, String> = serde_json::from_str(&raw).ok()?;
        map.get(name).cloned()
    }

    fn location_of<'a>(status: &'a SecretStorageStatus, name: &str) -> &'a SecretLocation {
        &status
            .items
            .iter()
            .find(|item| item.name == name)
            .unwrap_or_else(|| panic!("status must include {name}"))
            .location
    }

    #[cfg(unix)]
    fn assert_secret_file_permissions_are_private(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(path)
            .expect("secret file metadata should exist")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[cfg(not(unix))]
    fn assert_secret_file_permissions_are_private(_path: &Path) {}

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
        assert_eq!(
            secret_file_value(&dir, "EMBEDDING_API_KEY").as_deref(),
            Some("test-key"),
            "key must land in the local secrets.json"
        );
        assert_secret_file_permissions_are_private(&dir.join(SECRETS_FILE_NAME));
        if let Ok(dotenv) = fs::read_to_string(&env_path) {
            assert!(
                !dotenv.contains("test-key"),
                ".env must never hold the plaintext key"
            );
        }
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
        let _secret = SecretStoreGuard::install();
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
        let _secret = SecretStoreGuard::install();
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
        let _secret = SecretStoreGuard::install();
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
        let _secret = SecretStoreGuard::install();
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
    fn llm_settings_save_key_to_local_file_not_json_or_dotenv() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("llm-secret-file");
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

        assert_eq!(
            secret_file_value(&dir, "DEEPSEEK_API_KEY").as_deref(),
            Some("deepseek-test-key"),
            "key must land in the local secrets.json"
        );
        assert_secret_file_permissions_are_private(&dir.join(SECRETS_FILE_NAME));
        if let Ok(dotenv) = fs::read_to_string(&env_path) {
            assert!(!dotenv.contains("deepseek-test-key"));
        }
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
        assert_eq!(
            secret_file_value(&dir, "OPENAI_API_KEY").as_deref(),
            Some("openai-compatible-key"),
            "key must land in the local secrets.json"
        );
        if let Ok(dotenv) = fs::read_to_string(&env_path) {
            assert!(!dotenv.contains("openai-compatible-key"));
        }
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
        let _secret = SecretStoreGuard::install();
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
            !dir.join(SECRETS_FILE_NAME).exists(),
            "testing a draft config must not persist the draft key"
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("ANTHROPIC_API_KEY");
    }

    #[test]
    fn mineru_settings_save_token_to_local_file_not_json_or_dotenv() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("mineru-token-file");
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
        assert_eq!(
            secret_file_value(&dir, "MINERU_API_TOKEN").as_deref(),
            Some("mineru-test-token"),
            "token must land in the local secrets.json"
        );
        if let Ok(dotenv) = fs::read_to_string(&env_path) {
            assert!(!dotenv.contains("mineru-test-token"));
        }
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
        let _secret = SecretStoreGuard::install();
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
        assert!(
            !dir.join(SECRETS_FILE_NAME).exists(),
            "testing a draft MinerU token must not persist it"
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("MINERU_API_TOKEN");
    }

    #[test]
    fn legacy_json_keys_are_migrated_to_local_file_and_scrubbed() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("legacy-secret-migration");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        env::remove_var("DEEPSEEK_API_KEY");
        env::remove_var("EMBEDDING_API_KEY");
        let _ = isolated_env_path(&dir);
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
        assert_eq!(
            secret_file_value(&dir, "DEEPSEEK_API_KEY").as_deref(),
            Some("legacy-deepseek-key"),
            "legacy JSON key must migrate into the local secrets.json"
        );
        assert_eq!(
            secret_file_value(&dir, "EMBEDDING_API_KEY").as_deref(),
            Some("legacy-embedding-key")
        );
        let json = fs::read_to_string(dir.join("llm-settings.json")).expect("settings JSON");
        assert!(!json.contains("legacy-deepseek-key"));
        assert!(!json.contains("legacy-embedding-key"));

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        env::remove_var("DEEPSEEK_API_KEY");
        env::remove_var("EMBEDDING_API_KEY");
    }

    #[test]
    fn keychain_import_moves_secrets_to_file_deletes_entries_and_is_idempotent() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("keychain-import");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        for key in SECRET_KEYS {
            env::remove_var(key);
        }
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        let _ = isolated_env_path(&dir);

        // 假钥匙串里有两把 key;本地文件已经有一把(证明"已本地→跳过、不碰钥匙串")。
        let keychain = MemorySecretStore::default();
        keychain.set("DEEPSEEK_API_KEY", "kc-deepseek").expect("seed");
        keychain.set("OPENAI_API_KEY", "kc-openai").expect("seed");
        file_secret_set("EMBEDDING_API_KEY", "already-local").expect("seed file");

        let outcome = migrate_keychain_secrets_to_file_with(&keychain).expect("migrate");
        assert!(outcome.migrated_now, "keychain keys must import");

        // 1) 搬进了本地文件
        assert_eq!(
            secret_file_value(&dir, "DEEPSEEK_API_KEY").as_deref(),
            Some("kc-deepseek")
        );
        assert_eq!(
            secret_file_value(&dir, "OPENAI_API_KEY").as_deref(),
            Some("kc-openai")
        );
        // 2) 钥匙串条目被删掉(从此不再弹)
        assert_eq!(keychain.get("DEEPSEEK_API_KEY"), None);
        assert_eq!(keychain.get("OPENAI_API_KEY"), None);
        // 3) 已本地的 key 原样保留
        assert_eq!(
            secret_file_value(&dir, "EMBEDDING_API_KEY").as_deref(),
            Some("already-local")
        );
        // 4) 权限 600 + 读取回本地值
        assert_secret_file_permissions_are_private(&dir.join(SECRETS_FILE_NAME));
        assert_eq!(
            resolve_secret("DEEPSEEK_API_KEY").as_deref(),
            Some("kc-deepseek")
        );
        // 5) 状态:后端 file,该项本地文件
        let status = secret_storage_status().expect("status");
        assert_eq!(status.backend, "file");
        assert_eq!(
            location_of(&status, "DEEPSEEK_API_KEY"),
            &SecretLocation::LocalFile
        );

        // 6) 幂等:done 标记短路,即便钥匙串又冒出新 key 也不再导入、不再删
        keychain.set("MINERU_API_TOKEN", "kc-mineru").expect("seed");
        let again = migrate_keychain_secrets_to_file_with(&keychain).expect("second migrate");
        assert!(!again.migrated_now, "done flag must short-circuit");
        assert_eq!(
            secret_file_value(&dir, "MINERU_API_TOKEN"),
            None,
            "short-circuit must not import late keychain keys"
        );
        assert_eq!(
            keychain.get("MINERU_API_TOKEN").as_deref(),
            Some("kc-mineru"),
            "and must not delete them"
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        for key in SECRET_KEYS {
            env::remove_var(key);
        }
    }

    #[test]
    fn resolve_secret_prefers_active_store_then_env_then_none() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("resolve-order");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        for key in SECRET_KEYS {
            env::remove_var(key);
        }

        // 本地文件(当前后端)优先于 .env / 进程环境
        file_secret_set("DEEPSEEK_API_KEY", "from-file").expect("seed file");
        env::set_var("DEEPSEEK_API_KEY", "from-env-plaintext");
        assert_eq!(
            resolve_secret("DEEPSEEK_API_KEY").as_deref(),
            Some("from-file")
        );

        // 本地文件没有、进程环境是历史占位 → 视为未配置
        file_secret_delete("DEEPSEEK_API_KEY").expect("clear file");
        env::set_var("DEEPSEEK_API_KEY", KEYCHAIN_PLACEHOLDER);
        assert_eq!(resolve_secret("DEEPSEEK_API_KEY"), None);

        // 本地文件没有、.env 是真实明文 → 回退到明文(兼容旧布局/源码用户)
        env::set_var("DEEPSEEK_API_KEY", "from-env-plaintext");
        assert_eq!(
            resolve_secret("DEEPSEEK_API_KEY").as_deref(),
            Some("from-env-plaintext")
        );

        // 三处都没有 → None
        env::remove_var("DEEPSEEK_API_KEY");
        assert_eq!(resolve_secret("DEEPSEEK_API_KEY"), None);

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
    }

    #[test]
    fn secret_storage_status_reports_each_location() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let dir = config_dir("secret-status");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        for key in SECRET_KEYS {
            env::remove_var(key);
        }
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        let env_path = isolated_env_path(&dir);
        // OPENAI 明文在 .env;ANTHROPIC 是历史占位(视为未配置)
        fs::write(
            &env_path,
            "OPENAI_API_KEY=openai-plaintext\nANTHROPIC_API_KEY=moved-to-keychain\n",
        )
        .expect("seed .env");
        file_secret_set("DEEPSEEK_API_KEY", "in-file").expect("seed file");

        let status = secret_storage_status().expect("status");
        assert_eq!(status.backend, "file");
        assert_eq!(
            location_of(&status, "DEEPSEEK_API_KEY"),
            &SecretLocation::LocalFile
        );
        assert_eq!(
            location_of(&status, "OPENAI_API_KEY"),
            &SecretLocation::EnvPlaintext
        );
        assert_eq!(
            location_of(&status, "ANTHROPIC_API_KEY"),
            &SecretLocation::Absent,
            "a .env placeholder is not a usable key"
        );
        assert_eq!(
            location_of(&status, "MINERU_API_TOKEN"),
            &SecretLocation::Absent
        );
        assert_eq!(
            location_of(&status, "EMBEDDING_API_KEY"),
            &SecretLocation::Absent
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        env::remove_var("FOCUSED_READING_ENV_PATH");
        for key in SECRET_KEYS {
            env::remove_var(key);
        }
    }

    /// 真实系统钥匙串写/读/删冒烟(仿 mcp_codex_live_smoke 惯例,默认忽略)。**用唯一的
    /// 一次性 account 名**,绝不碰生产密钥项;结束即清理。
    ///
    /// 运行:`cargo test --lib real_keychain_round_trip -- --ignored --test-threads=1`
    #[test]
    #[ignore = "touches the real system keychain; run manually"]
    fn real_keychain_round_trip() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        set_override_secret_store(Arc::new(KeyringSecretStore));
        let store = active_secret_store();
        let account = "FOCUSED_READING_KEYCHAIN_LIVE_SMOKE";
        let _ = store.delete(account);

        store.set(account, "live-smoke-value").expect("write keychain");
        assert_eq!(store.get(account).as_deref(), Some("live-smoke-value"));
        store.delete(account).expect("cleanup keychain");
        assert_eq!(store.get(account), None);

        clear_override_secret_store();
    }

    /// 真机端到端反向迁移冒烟:真实钥匙串里种一把 key → 反向迁移搬回本地文件并**删掉钥匙串
    /// 条目** → `security find-generic-password` 已查不到 → 读取从本地文件返回原值。默认忽略。
    /// (跨版本签名导致的"最后一次弹窗"是 adhoc 签名固有,单进程内种/取同签名不触发,无法单测。)
    ///
    /// 运行:`cargo test --lib live_keychain_to_file_migration -- --ignored --test-threads=1`
    #[test]
    #[ignore = "touches the real system keychain; run manually"]
    #[cfg(target_os = "macos")]
    fn live_keychain_to_file_migration() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let keychain = KeyringSecretStore;
        let _ = keychain.delete("DEEPSEEK_API_KEY");
        let secret_value = format!("live-kc-secret-{}", std::process::id());
        keychain
            .set("DEEPSEEK_API_KEY", &secret_value)
            .expect("seed real keychain");

        let dir = config_dir("live-kc-to-file");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("config dir");
        for key in SECRET_KEYS {
            env::remove_var(key);
        }
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);

        let outcome = migrate_keychain_secrets_to_file_with(&keychain).expect("migrate");
        assert!(outcome.migrated_now);

        // 搬进本地文件
        assert_eq!(
            secret_file_value(&dir, "DEEPSEEK_API_KEY").as_deref(),
            Some(secret_value.as_str())
        );
        // 真实钥匙串条目已删
        assert_eq!(keychain.get("DEEPSEEK_API_KEY"), None);
        // security CLI 已查不到
        let cli = std::process::Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "com.anbc.focused-reading",
                "-a",
                "DEEPSEEK_API_KEY",
                "-w",
            ])
            .output()
            .expect("run security");
        assert!(
            !cli.status.success(),
            "keychain entry must be gone after migration"
        );
        // 读取从本地文件返回原值
        assert_eq!(
            resolve_secret("DEEPSEEK_API_KEY").as_deref(),
            Some(secret_value.as_str())
        );

        // 清理(防御性)
        let _ = keychain.delete("DEEPSEEK_API_KEY");
        let _ = fs::remove_dir_all(&dir);
        env::remove_var("FOCUSED_READING_CONFIG_DIR");
        for key in SECRET_KEYS {
            env::remove_var(key);
        }
    }

    #[test]
    fn agent_model_source_defaults_to_app_and_roundtrips() {
        let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
        let _secret = SecretStoreGuard::install();
        clear_config_path_env();
        let dir = config_dir("agent-model-source");
        let _ = fs::remove_dir_all(&dir);
        env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
        isolated_env_path(&dir);

        // Default with no stored setting is App (app-configured model).
        assert_eq!(agent_model_source(), AgentModelSource::App);
        assert_eq!(
            get_llm_settings().expect("settings").agent_model_source,
            AgentModelSource::App
        );

        // Switch to codex-local and confirm it persists.
        let saved = save_agent_model_source(AgentModelSource::CodexLocal).expect("save");
        assert_eq!(saved.agent_model_source, AgentModelSource::CodexLocal);
        assert_eq!(agent_model_source(), AgentModelSource::CodexLocal);

        // Switch back to app.
        save_agent_model_source(AgentModelSource::App).expect("save back");
        assert_eq!(agent_model_source(), AgentModelSource::App);

        let _ = fs::remove_dir_all(&dir);
        clear_config_path_env();
    }
