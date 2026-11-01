use crate::error::CoreResult;
use crate::git::session::{blocking, open_repo};
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

/// Read commit author identity for a repo: prefer local config, else the effective value.
pub async fn read_commit_identity(repo_path: &Path) -> CoreResult<CommitIdentity> {
    let path = repo_path.to_path_buf();
    blocking(move || read_commit_identity_at(&path)).await
}

pub(crate) fn read_commit_identity_at(repo_path: &Path) -> CoreResult<CommitIdentity> {
    let repo = open_repo(repo_path)?;
    let local_name = config_value(&repo, "user.name", true);
    let local_email = config_value(&repo, "user.email", true);
    let is_local = local_name.is_some() || local_email.is_some();
    let name = local_name.or_else(|| config_value(&repo, "user.name", false));
    let email = local_email.or_else(|| config_value(&repo, "user.email", false));
    Ok(CommitIdentity {
        name,
        email,
        is_local,
    })
}

fn config_value(repo: &git2::Repository, key: &str, local_only: bool) -> Option<String> {
    let config = repo.config().ok()?;
    let entry = config.get_entry(key).ok()?;
    if local_only && entry.level() != git2::ConfigLevel::Local {
        return None;
    }
    entry.value().ok().map(str::to_string)
}

/// Signature for a commit. Account identity overrides config for this call only.
pub(crate) fn commit_signature(
    repo: &git2::Repository,
    identity: Option<&CommitIdentity>,
) -> CoreResult<git2::Signature<'static>> {
    use crate::error::CoreError;
    let from_config = read_names(repo);
    let name = identity
        .and_then(|id| id.name.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(from_config.0);
    let email = identity
        .and_then(|id| id.email.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(from_config.1);
    let (Some(name), Some(email)) = (name, email) else {
        return Err(CoreError::process_failed(
            "Set a commit name and email on the account, or in this repository's Git config.",
        ));
    };
    git2::Signature::now(&name, &email).map_err(crate::git::session::map_git2)
}

fn read_names(repo: &git2::Repository) -> (Option<String>, Option<String>) {
    (
        config_value(repo, "user.name", false),
        config_value(repo, "user.email", false),
    )
}
