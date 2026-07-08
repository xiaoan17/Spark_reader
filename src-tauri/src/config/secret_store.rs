//! 敏感项的存储后端抽象。
//!
//! 真实现走系统钥匙串(macOS Keychain / Windows Credential Manager),测试注入内存
//! mock——**单测绝不能碰真实系统钥匙串**。所有敏感项挂在同一 service 下,以环境变量名
//! 作为 account/username。

#[cfg(test)]
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// 钥匙串 service 名。与应用配置目录同名,便于用户在系统钥匙串里辨认。
const KEYRING_SERVICE: &str = "com.anbc.focused-reading";

/// 敏感项的读写抽象。`get` 找不到返回 `None`(而非错误),便于读取顺序回退。
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Option<String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    /// 仅测试 / live-smoke 清理需要。
    #[cfg(test)]
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// 真实现:系统钥匙串。macOS 走 Keychain,Windows 走 Credential Manager(由 keyring
/// crate 天然支持)。
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

    #[cfg(test)]
    fn delete(&self, name: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, name).map_err(|err| err.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }
}

/// 内存实现,仅供测试注入,永不触碰系统钥匙串。
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
    static KEYRING: OnceLock<Arc<dyn SecretStore>> = OnceLock::new();
    KEYRING
        .get_or_init(|| Arc::new(KeyringSecretStore))
        .clone()
}

/// 测试构建下的默认后端是进程级内存 store——即使某个测试忘了显式注入,也绝不会
/// 落到真实系统钥匙串上。
#[cfg(test)]
fn default_secret_store() -> Arc<dyn SecretStore> {
    static FALLBACK: OnceLock<Arc<dyn SecretStore>> = OnceLock::new();
    FALLBACK
        .get_or_init(|| Arc::new(MemorySecretStore::default()))
        .clone()
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
