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
pub mod pull;
pub mod secrets;
pub mod ssh_config;
pub mod store;

#[cfg(test)]
pub(crate) mod testutil;

pub use auth::{GitAuth, RemoteAuthSet};
pub use detect::{
    DetectedRepoAccount, ParsedRemoteUrl, detect_repo_account, detect_repo_account_from_remote,
    parse_remote_url,
};
pub use error::{CoreError, CoreResult, ErrorCode};
pub use fetch::{FetchCoordinator, FetchOutcome, FetchProgress, WorkspaceFetchSummary};
pub use git::{
    BlameLine, BranchInfo, ChangeArea, CommitFileChange, CommitIdentity, CommitInfo, CommitOptions,
    FileBytesPair, RemoteInfo, RepoInspection, StashEntry, UNCOMMITTED_COMMIT_ID,
    WorkingTreeStatus, apply_stash, blame_file, checkout_revision, commit_index, create_branch_at,
    create_tag_at, discard_paths, drop_stash, get_commit_file_bytes_pair, get_commit_file_diff,
    get_commit_file_diff_with_old_path, inspect_repository, list_commit_files, list_commits,
    list_file_commits, list_local_branches, list_local_branches_for_remote, list_remote_branches,
    list_stashes, pop_stash, push_current_branch, read_commit_identity, read_head_commit_message,
    remove_paths, resolve_repo_path, save_stash, stage_paths, stop_tracking_paths, unstage_paths,
};
pub use ids::{AccountId, RepositoryId, WorkspaceId};
pub use models::{
    Account, AppConfig, AuthKind, CONFIG_VERSION, HostingProvider, RemoteAccount, Repository,
    Workspace,
};
pub use pull::{PullOutcome, list_conflicted_paths};
pub use secrets::{KeyringSecretStore, MemorySecretStore, SecretStore};
pub use ssh_config::{ResolvedSshHost, SshConfigFile, resolve_alias};
pub use store::ConfigStore;
