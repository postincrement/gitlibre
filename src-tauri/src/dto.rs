use gitlibre_core::{
    CoreError, RemoteInfo, Repository, RepositoryId, WorkingTreeStatus, Workspace, WorkspaceId,
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
}

impl From<Repository> for RepositoryDto {
    fn from(r: Repository) -> Self {
        Self {
            id: r.id,
            path: r.path,
            display_name: r.display_name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub workspaces: Vec<WorkspaceDto>,
    pub active_workspace_id: Option<WorkspaceId>,
    pub repositories: Vec<RepositoryDto>,
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
