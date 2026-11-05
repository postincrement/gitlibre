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

/// Account bound to one named remote.
///
/// `account_id: None` is an explicit "no account" and does not inherit the
/// repository account.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccount {
    pub remote: String,
    pub account_id: Option<AccountId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Repository {
    pub id: RepositoryId,
    pub path: PathBuf,
    pub display_name: String,
    /// Fallback authentication identity when a remote has no explicit binding.
    /// Commit author identity is configured on the account, not here.
    #[serde(default)]
    pub account_id: Option<AccountId>,
    /// Per-remote account bindings. Remotes absent from this list inherit
    /// [`Self::account_id`].
    #[serde(default)]
    pub remote_accounts: Vec<RemoteAccount>,
}

impl Repository {
    /// Account that authenticates `remote`. An explicit binding wins, including
    /// an explicit unassignment.
    pub fn account_for_remote(&self, remote: &str) -> Option<AccountId> {
        if let Some(binding) = self.remote_accounts.iter().find(|b| b.remote == remote) {
            return binding.account_id;
        }
        self.account_id
    }
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
