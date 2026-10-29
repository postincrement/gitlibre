//! GitLibre core library — workspace management, config persistence, and Git operations.
//!
//! This crate is intentionally independent of Tauri so it can be unit-tested and reused.

pub mod auth;
pub mod detect;
pub mod error;
pub mod fetch;
pub mod git;
pub mod ids;
pub mod models;
pub mod secrets;
pub mod ssh_config;
pub mod store;

pub use auth::GitAuth;
pub use detect::{
    detect_repo_account, detect_repo_account_from_remote, parse_remote_url, DetectedRepoAccount,
    ParsedRemoteUrl,
};
pub use error::{CoreError, CoreResult, ErrorCode};
pub use fetch::{FetchCoordinator, FetchOutcome, FetchProgress, WorkspaceFetchSummary};
pub use git::{
    blame_file, commit_index, discard_paths, get_commit_file_bytes_pair, get_commit_file_diff,
    get_commit_file_diff_with_old_path, inspect_repository, list_commit_files, list_commits,
    list_file_commits, list_local_branches, list_local_branches_for_remote,
    list_remote_branches, read_commit_identity, remove_paths, resolve_repo_path, stage_paths,
    stop_tracking_paths, unstage_paths, BlameLine, BranchInfo, ChangeArea, CommitFileChange,
    CommitIdentity, CommitInfo, FileBytesPair, GitExecutor, RemoteInfo, RepoInspection,
    WorkingTreeStatus, UNCOMMITTED_COMMIT_ID,
};
pub use ids::{AccountId, RepositoryId, WorkspaceId};
pub use models::{
    Account, AppConfig, AuthKind, HostingProvider, Repository, Workspace, CONFIG_VERSION,
};
pub use secrets::{KeyringSecretStore, MemorySecretStore, SecretStore};
pub use ssh_config::{resolve_alias, ResolvedSshHost, SshConfigFile};
pub use store::ConfigStore;
