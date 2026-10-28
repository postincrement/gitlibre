use crate::error::{CoreError, CoreResult, ErrorCode};
use crate::ids::AccountId;
use std::collections::HashMap;
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "com.gitlibre.desktop";

/// Stores account secrets outside the JSON config (OS keychain in production).
pub trait SecretStore: Send + Sync {
    fn set_token(&self, account_id: AccountId, token: &str) -> CoreResult<()>;
    fn get_token(&self, account_id: AccountId) -> CoreResult<Option<String>>;
    fn delete_token(&self, account_id: AccountId) -> CoreResult<()>;
}

/// macOS Keychain / Windows Credential Manager / Linux secret service via `keyring`.
pub struct KeyringSecretStore;

impl KeyringSecretStore {
    pub fn new() -> Self {
        Self
    }

    fn entry(account_id: AccountId) -> CoreResult<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, &account_id.to_string()).map_err(|e| {
            CoreError::new(
                ErrorCode::KeychainFailed,
                format!("Could not open keychain entry: {e}"),
            )
        })
    }
}

impl Default for KeyringSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringSecretStore {
    fn set_token(&self, account_id: AccountId, token: &str) -> CoreResult<()> {
        let entry = Self::entry(account_id)?;
        entry.set_password(token).map_err(|e| {
            CoreError::new(
                ErrorCode::KeychainFailed,
                format!("Could not store token in keychain: {e}"),
            )
        })
    }

    fn get_token(&self, account_id: AccountId) -> CoreResult<Option<String>> {
        let entry = Self::entry(account_id)?;
        match entry.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(CoreError::new(
                ErrorCode::KeychainFailed,
                format!("Could not read token from keychain: {e}"),
            )),
        }
    }

    fn delete_token(&self, account_id: AccountId) -> CoreResult<()> {
        let entry = Self::entry(account_id)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(CoreError::new(
                ErrorCode::KeychainFailed,
                format!("Could not delete token from keychain: {e}"),
            )),
        }
    }
}

/// In-memory secret store for unit tests (never used for real tokens in production).
#[derive(Debug, Default)]
pub struct MemorySecretStore {
    inner: Mutex<HashMap<AccountId, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemorySecretStore {
    fn set_token(&self, account_id: AccountId, token: &str) -> CoreResult<()> {
        self.inner
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::Internal, "secret store lock poisoned"))?
            .insert(account_id, token.to_string());
        Ok(())
    }

    fn get_token(&self, account_id: AccountId) -> CoreResult<Option<String>> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::Internal, "secret store lock poisoned"))?
            .get(&account_id)
            .cloned())
    }

    fn delete_token(&self, account_id: AccountId) -> CoreResult<()> {
        self.inner
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::Internal, "secret store lock poisoned"))?
            .remove(&account_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_round_trip() {
        let store = MemorySecretStore::new();
        let id = AccountId::new();
        assert!(store.get_token(id).unwrap().is_none());
        store.set_token(id, "secret-token").unwrap();
        assert_eq!(store.get_token(id).unwrap().as_deref(), Some("secret-token"));
        store.delete_token(id).unwrap();
        assert!(store.get_token(id).unwrap().is_none());
    }
}
