//! 敏感项的存储后端抽象。
//!
//! **默认后端是本地明文文件**(`FileSecretStore`,零系统交互):这是用户明确要的"方便
//! 快速"体验——adhoc 签名下钥匙串每次发版都重新弹授权框,体验极差。钥匙串后端
//! (`KeyringSecretStore`)保留但降级为 opt-in(`FOCUSED_READING_SECRET_BACKEND=keychain`),
//! 将来有 Developer ID 正式签名、钥匙串不再弹窗时可以再抬回默认。
//!
//! 真实现里读写都委托给 `super`(config)模块,把路径/IO/权限逻辑与其它配置 IO 放一处。
//! 测试注入内存 mock——**单测绝不能碰真实系统钥匙串**。

#[cfg(test)]
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
#[cfg(not(test))]
use std::sync::OnceLock;

/// 钥匙串 service 名。与应用配置目录同名,便于用户在系统钥匙串里辨认。
const KEYRING_SERVICE: &str = "com.anbc.focused-reading";

/// 敏感项的读写抽象。`get` 找不到返回 `None`(而非错误),便于读取顺序回退。
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Option<String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// 默认后端:app data 目录下的本地明文文件(`secrets.json`,权限 600)。读写零系统交互,
/// 发版不弹任何授权框。
pub struct FileSecretStore;

impl SecretStore for FileSecretStore {
    fn get(&self, name: &str) -> Option<String> {
        super::file_secret_get(name)
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        super::file_secret_set(name, value).map_err(|err| err.to_string())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        super::file_secret_delete(name).map_err(|err| err.to_string())
    }
}

/// opt-in 后端:系统钥匙串。macOS 走 Keychain,Windows 走 Credential Manager。仅在
/// `FOCUSED_READING_SECRET_BACKEND=keychain` 时作为默认后端;此外**反向迁移**会显式构造它
/// 一次,把历史 key 从钥匙串搬回本地文件。
pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn get(&self, name: &str) -> Option<String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, name).ok()?;
        match entry.get_password() {
            Ok(value) if !value.trim().is_empty() => Some(value),
            _ => None,
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, name).map_err(|err| err.to_string())?;
        entry.set_password(value).map_err(|err| err.to_string())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, name).map_err(|err| err.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }
}

/// 内存实现,仅供测试注入(含反向迁移测试里当"假钥匙串"),永不触碰系统钥匙串。
#[cfg(test)]
#[derive(Default)]
pub struct MemorySecretStore {
    inner: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn get(&self, name: &str) -> Option<String> {
        self.inner
            .lock()
            .expect("memory secret store lock")
            .get(name)
            .cloned()
            .filter(|value| !value.trim().is_empty())
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.inner
            .lock()
            .expect("memory secret store lock")
            .insert(name.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        self.inner
            .lock()
            .expect("memory secret store lock")
            .remove(name);
        Ok(())
    }
}

/// 测试/live-smoke 注入的覆盖 store。为 `None` 时使用 [`default_secret_store`]。
static OVERRIDE_STORE: Mutex<Option<Arc<dyn SecretStore>>> = Mutex::new(None);

/// 返回当前生效的 secret store:优先测试覆盖,否则默认后端。
pub fn active_secret_store() -> Arc<dyn SecretStore> {
    if let Some(store) = OVERRIDE_STORE
        .lock()
        .expect("secret store override lock")
        .clone()
    {
        return store;
    }
    default_secret_store()
}

#[cfg(not(test))]
fn default_secret_store() -> Arc<dyn SecretStore> {
    match super::secret_backend() {
        super::SecretBackend::Keychain => {
            static KEYRING: OnceLock<Arc<dyn SecretStore>> = OnceLock::new();
            KEYRING.get_or_init(|| Arc::new(KeyringSecretStore)).clone()
        }
        super::SecretBackend::File => Arc::new(FileSecretStore),
    }
}

/// 测试构建下的默认后端**永远是文件 store**(隔离在临时 config 目录),即使
/// `FOCUSED_READING_SECRET_BACKEND=keychain` 也不例外——单测绝不会落到真实系统钥匙串上。
/// live-smoke 需要真实钥匙串时必须显式 `set_override_secret_store(KeyringSecretStore)`。
#[cfg(test)]
fn default_secret_store() -> Arc<dyn SecretStore> {
    Arc::new(FileSecretStore)
}

/// 注入覆盖 store(测试 / `#[ignore]` live-smoke 用)。
#[cfg(test)]
pub fn set_override_secret_store(store: Arc<dyn SecretStore>) {
    *OVERRIDE_STORE.lock().expect("secret store override lock") = Some(store);
}

/// 清除覆盖 store,恢复默认后端。
#[cfg(test)]
pub fn clear_override_secret_store() {
    *OVERRIDE_STORE.lock().expect("secret store override lock") = None;
}
