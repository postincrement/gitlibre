use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Stable error codes the frontend can switch on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    GitNotFound,
    NotAGitRepository,
    PathNotFound,
    PathNotDirectory,
    DuplicateRepository,
    WorkspaceNotFound,
    RepositoryNotFound,
    NoRemotes,
    NetworkUnavailable,
    AuthenticationFailed,
    FetchFailed,
    ProcessFailed,
    ConfigIo,
    ConfigParse,
    Cancelled,
    AccountNotFound,
    KeychainFailed,
    InvalidAccount,
    Internal,
}

/// Application-facing error with a machine code and human message.
#[derive(Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[error("{message}")]
pub struct CoreError {
    pub code: ErrorCode,
    pub message: String,
}

impl CoreError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn git_not_found() -> Self {
        Self::new(
            ErrorCode::GitNotFound,
            "Git executable was not found on PATH. Install Git and restart GitLibre.",
        )
    }

    pub fn not_a_git_repository(path: impl std::fmt::Display) -> Self {
        Self::new(
            ErrorCode::NotAGitRepository,
            format!("Selected directory is not a Git repository: {path}"),
        )
    }

    pub fn path_not_found(path: impl std::fmt::Display) -> Self {
        Self::new(
            ErrorCode::PathNotFound,
            format!("Repository path no longer exists: {path}"),
        )
    }

    pub fn workspace_not_found() -> Self {
        Self::new(ErrorCode::WorkspaceNotFound, "Workspace was not found.")
    }

    pub fn repository_not_found() -> Self {
        Self::new(ErrorCode::RepositoryNotFound, "Repository was not found.")
    }

    pub fn account_not_found() -> Self {
        Self::new(ErrorCode::AccountNotFound, "Account was not found.")
    }

    pub fn duplicate_repository(path: impl std::fmt::Display) -> Self {
        Self::new(
            ErrorCode::DuplicateRepository,
            format!("Repository is already in this workspace: {path}"),
        )
    }

    pub fn config_io(err: impl std::fmt::Display) -> Self {
        Self::new(
            ErrorCode::ConfigIo,
            format!("Workspace configuration could not be saved or loaded: {err}"),
        )
    }

    pub fn config_parse(err: impl std::fmt::Display) -> Self {
        Self::new(
            ErrorCode::ConfigParse,
            format!("Workspace configuration is invalid: {err}"),
        )
    }

    pub fn process_failed(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::ProcessFailed, detail)
    }

    pub fn map_git_failure(stderr: &str, stdout: &str) -> Self {
        let combined = format!("{stderr}\n{stdout}").to_lowercase();
        if combined.contains("authentication")
            || combined.contains("permission denied")
            || combined.contains("could not read username")
            || combined.contains("publickey")
            || combined.contains("403")
            || combined.contains("401")
        {
            return Self::new(
                ErrorCode::AuthenticationFailed,
                format!(
                    "Authentication failed. Configure credentials for system Git and retry. {stderr}"
                ),
            );
        }
        if combined.contains("could not resolve host")
            || combined.contains("network is unreachable")
            || combined.contains("failed to connect")
            || combined.contains("timed out")
        {
            return Self::new(
                ErrorCode::NetworkUnavailable,
                format!("Network unavailable or remote unreachable. {stderr}"),
            );
        }
        if combined.contains("no remotes") || combined.contains("does not appear to be a git repository") {
            // fall through
        }
        Self::new(
            ErrorCode::FetchFailed,
            if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            },
        )
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
