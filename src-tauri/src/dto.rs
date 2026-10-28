use gitlibre_core::{
    Account, AccountId, AuthKind, CoreError, DetectedRepoAccount, HostingProvider, RemoteInfo,
    Repository, RepositoryId, WorkingTreeStatus, Workspace, WorkspaceId,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
}

impl From<CoreError> for AppErrorDto {
    fn from(value: CoreError) -> Self {
        Self {
            code: serde_json::to_value(value.code)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "internal".into()),
            message: value.message,
        }
    }
}

pub type CmdResult<T> = Result<T, AppErrorDto>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: WorkspaceId,
    pub name: String,
    pub repository_ids: Vec<RepositoryId>,
}

impl From<Workspace> for WorkspaceDto {
    fn from(w: Workspace) -> Self {
        Self {
            id: w.id,
            name: w.name,
            repository_ids: w.repositories,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDto {
    pub id: RepositoryId,
    pub path: PathBuf,
    pub display_name: String,
    pub account_id: Option<AccountId>,
}

impl From<Repository> for RepositoryDto {
    fn from(r: Repository) -> Self {
        Self {
            id: r.id,
            path: r.path,
            display_name: r.display_name,
            account_id: r.account_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDto {
    pub id: AccountId,
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    pub username: String,
    pub display_name: String,
    pub commit_name: Option<String>,
    pub commit_email: Option<String>,
    pub ssh_private_key_path: Option<PathBuf>,
    pub has_token: bool,
}

impl AccountDto {
    pub fn from_account(account: Account, has_token: bool) -> Self {
        Self {
            id: account.id,
            provider: account.provider,
            auth_kind: account.auth_kind,
            username: account.username,
            display_name: account.display_name,
            commit_name: account.commit_name,
            commit_email: account.commit_email,
            ssh_private_key_path: account.ssh_private_key_path,
            has_token,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountRequest {
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    pub username: String,
    pub display_name: String,
    pub commit_name: Option<String>,
    pub commit_email: Option<String>,
    pub ssh_private_key_path: Option<PathBuf>,
    /// HTTPS token — stored only in the OS keychain, never in config.json.
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountRequest {
    pub id: AccountId,
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    pub username: String,
    pub display_name: String,
    pub commit_name: Option<String>,
    pub commit_email: Option<String>,
    pub ssh_private_key_path: Option<PathBuf>,
    /// When set and non-empty, replaces the keychain token. Empty/omitted keeps the existing token.
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAccountDto {
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    pub suggested_username: Option<String>,
    pub remote_host: Option<String>,
    pub resolved_host: Option<String>,
    pub ssh_host_alias: Option<String>,
    pub suggested_ssh_key_path: Option<PathBuf>,
    pub remote_owner: Option<String>,
    pub primary_remote_name: Option<String>,
    pub primary_remote_url: Option<String>,
    pub commit_name: Option<String>,
    pub commit_email: Option<String>,
    pub commit_identity_is_local: bool,
    pub matched_account_id: Option<AccountId>,
}

impl From<DetectedRepoAccount> for DetectedAccountDto {
    fn from(d: DetectedRepoAccount) -> Self {
        Self {
            provider: d.provider,
            auth_kind: d.auth_kind,
            suggested_username: d.suggested_username,
            remote_host: d.remote_host,
            resolved_host: d.resolved_host,
            ssh_host_alias: d.ssh_host_alias,
            suggested_ssh_key_path: d.suggested_ssh_key_path,
            remote_owner: d.remote_owner,
            primary_remote_name: d.primary_remote_name,
            primary_remote_url: d.primary_remote_url,
            commit_name: d.commit_name,
            commit_email: d.commit_email,
            commit_identity_is_local: d.commit_identity_is_local,
            matched_account_id: d.matched_account_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRepositoryResult {
    pub repository: RepositoryDto,
    pub detection: Option<DetectedAccountDto>,
    pub auto_assigned_account_id: Option<AccountId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub workspaces: Vec<WorkspaceDto>,
    pub active_workspace_id: Option<WorkspaceId>,
    pub repositories: Vec<RepositoryDto>,
    pub accounts: Vec<AccountDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatusDto {
    pub repository_id: RepositoryId,
    pub display_name: String,
    pub path: PathBuf,
    pub available: bool,
    pub current_branch: Option<String>,
    pub detached_head: bool,
    pub remotes: Vec<RemoteInfo>,
    pub working_tree: Option<WorkingTreeStatus>,
    pub is_fetching: bool,
    pub last_error: Option<String>,
    pub last_fetch_summary: Option<String>,
    pub account_id: Option<AccountId>,
    /// Effective `user.name` for this repo (local preferred over global).
    pub commit_name: Option<String>,
    /// Effective `user.email` for this repo (local preferred over global).
    pub commit_email: Option<String>,
    /// True when name and/or email are set in this repo's local `.git/config`.
    pub commit_identity_is_local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProgressEvent {
    pub repository_id: RepositoryId,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchFinishedEvent {
    pub repository_id: RepositoryId,
    pub success: bool,
    pub summary: String,
    pub error: Option<AppErrorDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFetchFinishedEvent {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
}
