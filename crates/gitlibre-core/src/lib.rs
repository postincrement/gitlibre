//! GitLibre core library — workspace management, config persistence, and Git operations.
//!
//! This crate is intentionally independent of Tauri so it can be unit-tested and reused.

pub mod auth;
pub mod error;
pub mod fetch;
pub mod git;
pub mod ids;
pub mod models;
pub mod secrets;
pub mod store;

pub use auth::GitAuth;
pub use error::{CoreError, CoreResult, ErrorCode};
pub use fetch::{FetchCoordinator, FetchOutcome, FetchProgress, WorkspaceFetchSummary};
pub use git::{
    inspect_repository, GitExecutor, RemoteInfo, RepoInspection, WorkingTreeStatus,
};
pub use ids::{AccountId, RepositoryId, WorkspaceId};
pub use models::{
    Account, AppConfig, AuthKind, HostingProvider, Repository, Workspace, CONFIG_VERSION,
};
pub use secrets::{KeyringSecretStore, MemorySecretStore, SecretStore};
pub use store::ConfigStore;
