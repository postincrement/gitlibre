//! GitLibre core library — workspace management, config persistence, and Git operations.
//!
//! This crate is intentionally independent of Tauri so it can be unit-tested and reused.

pub mod error;
pub mod fetch;
pub mod git;
pub mod ids;
pub mod models;
pub mod store;

pub use error::{CoreError, CoreResult};
pub use fetch::{FetchCoordinator, FetchOutcome, FetchProgress, WorkspaceFetchSummary};
pub use git::{
    inspect_repository, GitExecutor, RemoteInfo, RepoInspection, WorkingTreeStatus,
};
pub use ids::{RepositoryId, WorkspaceId};
pub use models::{AppConfig, Repository, Workspace};
pub use store::ConfigStore;
