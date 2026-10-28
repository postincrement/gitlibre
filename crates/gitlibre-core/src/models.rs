use crate::ids::{RepositoryId, WorkspaceId};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const CONFIG_VERSION: u32 = 1;

/// Top-level persisted application configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppConfig {
    pub version: u32,
    pub active_workspace_id: Option<WorkspaceId>,
    pub workspaces: Vec<Workspace>,
    /// Global repository registry. Workspaces reference entries by ID.
    pub repositories: Vec<Repository>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            active_workspace_id: None,
            workspaces: Vec::new(),
            repositories: Vec::new(),
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
}
