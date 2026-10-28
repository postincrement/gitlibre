use crate::error::CoreResult;
use crate::git::executor::GitExecutor;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
    /// At least one of name/email is set in this repository's local `.git/config`.
    pub is_local: bool,
}

/// Read commit author identity for a repo: prefer `--local`, else effective config.
pub async fn read_commit_identity(
    executor: &GitExecutor,
    repo_path: &Path,
) -> CoreResult<CommitIdentity> {
    let local_name = git_config_get(executor, repo_path, true, "user.name").await?;
    let local_email = git_config_get(executor, repo_path, true, "user.email").await?;
    let is_local = local_name.is_some() || local_email.is_some();

    let name = if local_name.is_some() {
        local_name
    } else {
        git_config_get(executor, repo_path, false, "user.name").await?
    };
    let email = if local_email.is_some() {
        local_email
    } else {
        git_config_get(executor, repo_path, false, "user.email").await?
    };

    Ok(CommitIdentity {
        name,
        email,
        is_local,
    })
}

async fn git_config_get(
    executor: &GitExecutor,
    repo_path: &Path,
    local_only: bool,
    key: &str,
) -> CoreResult<Option<String>> {
    let args: Vec<&str> = if local_only {
        vec!["config", "--local", "--get", key]
    } else {
        // Effective value for this working tree (local → global → system).
        vec!["config", "--get", key]
    };
    let out = executor.run(repo_path, &args).await?;
    if !out.success() {
        return Ok(None);
    }
    let value = out.stdout_lossy().trim().to_string();
    Ok(if value.is_empty() {
        None
    } else {
        Some(value)
    })
}
