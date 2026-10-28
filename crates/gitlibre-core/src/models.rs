use crate::ids::{AccountId, RepositoryId, WorkspaceId};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const CONFIG_VERSION: u32 = 2;

/// Top-level persisted application configuration.
///
/// Secrets (tokens) are never stored here — only in the OS keychain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppConfig {
    pub version: u32,
    pub active_workspace_id: Option<WorkspaceId>,
    pub workspaces: Vec<Workspace>,
    /// Global repository registry. Workspaces reference entries by ID.
    pub repositories: Vec<Repository>,
    /// Hosting accounts (GitHub first; provider field keeps this extensible).
    #[serde(default)]
    pub accounts: Vec<Account>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            active_workspace_id: None,
            workspaces: Vec::new(),
            repositories: Vec::new(),
            accounts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub repositories: Vec<RepositoryId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Repository {
    pub id: RepositoryId,
    pub path: PathBuf,
    pub display_name: String,
    /// Authentication identity for remote Git operations (not commit author).
    #[serde(default)]
    pub account_id: Option<AccountId>,
}

/// Hosting provider. Architecture is provider-independent; GitHub is first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostingProvider {
    GitHub,
    GitLab,
    Bitbucket,
    Generic,
}

impl HostingProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GitHub => "github",
            Self::GitLab => "gitlab",
            Self::Bitbucket => "bitbucket",
            Self::Generic => "generic",
        }
    }
}

/// How GitLibre authenticates as this account for remote operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthKind {
    /// HTTPS with a token from the OS keychain (PAT / OAuth token).
    HttpsToken,
    /// SSH with an explicit private key path (IdentitiesOnly).
    SshKey,
}

/// A hosting account. Tokens live in the keychain, keyed by `id`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub id: AccountId,
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    /// Login / username used for display and HTTPS username hints.
    pub username: String,
    pub display_name: String,
    /// Optional commit identity — separate from authentication identity.
    #[serde(default)]
    pub commit_name: Option<String>,
    #[serde(default)]
    pub commit_email: Option<String>,
    /// Required when `auth_kind == SshKey`.
    #[serde(default)]
    pub ssh_private_key_path: Option<PathBuf>,
}

/// Migrate older config documents forward to `CONFIG_VERSION`.
pub fn migrate_config(mut config: AppConfig) -> AppConfig {
    if config.version < 2 {
        if config.accounts.is_empty() {
            // v1 had no accounts field; serde default already empty.
        }
        for repo in &mut config.repositories {
            if repo.account_id.is_none() {
                // explicit no-op: keep unassigned
            }
        }
        config.version = 2;
    }
    if config.version < CONFIG_VERSION {
        config.version = CONFIG_VERSION;
    }
    config
}
