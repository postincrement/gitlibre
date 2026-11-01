use crate::auth::GitAuth;
use crate::error::{CoreError, ErrorCode};
use crate::fetch::FetchCoordinator;
use crate::git::session::blocking;
use crate::git::transport;
use crate::ids::RepositoryId;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullOutcome {
    pub repository_id: RepositoryId,
    pub success: bool,
    pub summary: String,
    pub has_conflicts: bool,
    pub conflicted_paths: Vec<String>,
    pub error: Option<CoreError>,
}

impl FetchCoordinator {
    pub async fn pull_one_with_auth<F>(
        &self,
        repository_id: RepositoryId,
        repo_path: &Path,
        auth: Option<GitAuth>,
        mut on_progress: F,
    ) -> PullOutcome
    where
        F: FnMut(crate::fetch::FetchProgress) + Send,
    {
        if !repo_path.exists() {
            return PullOutcome {
                repository_id,
                success: false,
                summary: format!("Path no longer exists: {}", repo_path.display()),
                has_conflicts: false,
                conflicted_paths: Vec::new(),
                error: Some(CoreError::path_not_found(repo_path.display())),
            };
        }

        self.with_repo_lock(repo_path, || async {
            let progress_id = repository_id;
            let path = repo_path.to_path_buf();
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            let pull_auth = auth.clone();
            let handle = tokio::task::spawn_blocking(move || {
                transport::pull_current_branch(&path, pull_auth.as_ref(), |message| {
                    let _ = tx.send(message);
                })
            });
            while let Some(message) = rx.recv().await {
                on_progress(crate::fetch::FetchProgress {
                    repository_id: progress_id,
                    message,
                });
            }
            let result = match handle.await {
                Ok(result) => result,
                Err(err) => Err(CoreError::process_failed(format!("Pull task failed: {err}"))),
            };

            match result {
                Ok(run) if run.conflicted_paths.is_empty() => PullOutcome {
                    repository_id,
                    success: true,
                    summary: run.summary,
                    has_conflicts: false,
                    conflicted_paths: Vec::new(),
                    error: None,
                },
                Ok(run) => PullOutcome {
                    repository_id,
                    success: false,
                    summary: format!("Pull finished with {} conflict(s)", run.conflicted_paths.len()),
                    has_conflicts: true,
                    conflicted_paths: run.conflicted_paths,
                    error: Some(CoreError::new(
                        ErrorCode::FetchFailed,
                        "Pull completed with merge conflicts. Resolve them before continuing.",
                    )),
                },
                Err(err) => PullOutcome {
                    repository_id,
                    success: false,
                    summary: err.message.clone(),
                    has_conflicts: false,
                    conflicted_paths: Vec::new(),
                    error: Some(err),
                },
            }
        })
        .await
    }
}

/// Paths with unmerged (conflict) index entries.
pub async fn list_conflicted_paths(repo_path: &Path) -> Result<Vec<String>, CoreError> {
    let path = repo_path.to_path_buf();
    blocking(move || transport::conflicted_paths(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::FetchCoordinator;
    use crate::testutil;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn pull_ff_success() {
        let dir = tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        let local_path = dir.path().join("local");
        let other_path = dir.path().join("other");
        testutil::init_bare(&bare);
        let local = testutil::init_repo(&local_path);
        testutil::set_identity(&local, "A", "a@example.com");
        testutil::commit_file(&local, "f.txt", "one\n", "one");
        let url = bare.to_string_lossy().into_owned();
        testutil::add_remote(&local, "origin", &url);
        testutil::push_branch(&local, "origin", "main");

        let other = testutil::clone_repo(&url, &other_path);
        testutil::set_identity(&other, "B", "b@example.com");
        testutil::commit_file(&other, "f.txt", "two\n", "two");
        testutil::push_branch(&other, "origin", "main");

        let coordinator = FetchCoordinator::new();
        let outcome = coordinator
            .pull_one_with_auth(RepositoryId::new(), &local_path, None, |_| {})
            .await;
        assert!(outcome.success, "{outcome:?}");
        assert!(!outcome.has_conflicts);
        let contents = fs::read_to_string(local_path.join("f.txt")).unwrap();
        assert_eq!(contents, "two\n");
    }

    #[tokio::test]
    async fn pull_detects_conflicts() {
        let dir = tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        let local_path = dir.path().join("local");
        let other_path = dir.path().join("other");
        testutil::init_bare(&bare);
        let local = testutil::init_repo(&local_path);
        testutil::set_identity(&local, "A", "a@example.com");
        testutil::commit_file(&local, "f.txt", "base\n", "base");
        let url = bare.to_string_lossy().into_owned();
        testutil::add_remote(&local, "origin", &url);
        testutil::push_branch(&local, "origin", "main");

        let other = testutil::clone_repo(&url, &other_path);
        testutil::set_identity(&other, "B", "b@example.com");

        testutil::commit_file(&local, "f.txt", "local change\n", "local");
        testutil::commit_file(&other, "f.txt", "remote change\n", "remote");
        testutil::push_branch(&other, "origin", "main");

        let coordinator = FetchCoordinator::new();
        let outcome = coordinator
            .pull_one_with_auth(RepositoryId::new(), &local_path, None, |_| {})
            .await;
        assert!(outcome.has_conflicts, "{outcome:?}");
        assert!(
            outcome
                .conflicted_paths
                .iter()
                .any(|p| p == "f.txt" || p.ends_with("f.txt")),
            "{outcome:?}"
        );
        let repo = git2::Repository::open(&local_path).unwrap();
        let _ = repo.cleanup_state();
    }
}
