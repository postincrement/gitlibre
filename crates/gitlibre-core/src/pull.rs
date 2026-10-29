use crate::auth::GitAuth;
use crate::error::{CoreError, ErrorCode};
use crate::fetch::FetchCoordinator;
use crate::git::GitExecutor;
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
            // Ensure a remote exists.
            match self.executor().run(repo_path, &["remote"]).await {
                Ok(out) if out.success() => {
                    if out.stdout_lossy().trim().is_empty() {
                        return PullOutcome {
                            repository_id,
                            success: false,
                            summary: "No remotes configured".into(),
                            has_conflicts: false,
                            conflicted_paths: Vec::new(),
                            error: Some(CoreError::new(
                                ErrorCode::NoRemotes,
                                "No remotes configured for this repository.",
                            )),
                        };
                    }
                }
                Ok(out) => {
                    return PullOutcome {
                        repository_id,
                        success: false,
                        summary: out.stderr_lossy(),
                        has_conflicts: false,
                        conflicted_paths: Vec::new(),
                        error: Some(CoreError::process_failed(out.stderr_lossy())),
                    };
                }
                Err(e) => {
                    return PullOutcome {
                        repository_id,
                        success: false,
                        summary: e.message.clone(),
                        has_conflicts: false,
                        conflicted_paths: Vec::new(),
                        error: Some(e),
                    };
                }
            }

            let progress_id = repository_id;
            let result = self
                .executor()
                .run_with_stderr_progress_auth(
                    repo_path,
                    // Explicit merge strategy so divergent branches reconcile
                    // (and can leave conflicted paths) without relying on
                    // the user's pull.rebase config.
                    &["pull", "--no-rebase", "--progress"],
                    auth.as_ref(),
                    |msg| {
                        on_progress(crate::fetch::FetchProgress {
                            repository_id: progress_id,
                            message: msg,
                        });
                    },
                )
                .await;

            let conflicted_paths = list_conflicted_paths(self.executor(), repo_path)
                .await
                .unwrap_or_default();
            let has_conflicts = !conflicted_paths.is_empty();

            match result {
                Ok(out) if out.success() => PullOutcome {
                    repository_id,
                    success: true,
                    summary: if has_conflicts {
                        format!(
                            "Pull reported success but {} conflicted path(s) remain",
                            conflicted_paths.len()
                        )
                    } else if out.stderr_lossy().trim().is_empty() {
                        "Pull completed".into()
                    } else {
                        out.stderr_lossy()
                            .trim()
                            .lines()
                            .last()
                            .unwrap_or("Pull completed")
                            .to_string()
                    },
                    has_conflicts,
                    conflicted_paths,
                    error: None,
                },
                Ok(_out) if has_conflicts => PullOutcome {
                    repository_id,
                    // Pull ran but left the repo in a conflicted merge state.
                    success: false,
                    summary: format!(
                        "Pull finished with {} conflict(s)",
                        conflicted_paths.len()
                    ),
                    has_conflicts: true,
                    conflicted_paths,
                    error: Some(CoreError::new(
                        ErrorCode::FetchFailed,
                        "Pull completed with merge conflicts. Resolve them before continuing.",
                    )),
                },
                Ok(out) => {
                    let err = CoreError::map_git_failure(&out.stderr_lossy(), &out.stdout_lossy());
                    PullOutcome {
                        repository_id,
                        success: false,
                        summary: err.message.clone(),
                        has_conflicts: false,
                        conflicted_paths: Vec::new(),
                        error: Some(err),
                    }
                }
                Err(e) => PullOutcome {
                    repository_id,
                    success: false,
                    summary: e.message.clone(),
                    has_conflicts,
                    conflicted_paths,
                    error: Some(e),
                },
            }
        })
        .await
    }
}

/// Paths with unmerged (conflict) index entries.
pub async fn list_conflicted_paths(
    executor: &GitExecutor,
    repo_path: &Path,
) -> Result<Vec<String>, CoreError> {
    let out = executor
        .run(repo_path, &["diff", "--name-only", "--diff-filter=U"])
        .await?;
    // git diff returns 0 with conflicts listed; also accept 1.
    if !(out.success() || out.status == 1) {
        return Err(CoreError::process_failed(out.stderr_lossy()));
    }
    let mut paths: Vec<String> = out
        .stdout_lossy()
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    paths.sort();
    paths.dedup();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::FetchCoordinator;
    use crate::git::GitExecutor;
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn git_allow_fail(cwd: &Path, args: &[&str]) {
        let _ = Command::new("git").args(args).current_dir(cwd).status();
    }

    #[tokio::test]
    async fn pull_ff_success() {
        let dir = tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        let local = dir.path().join("local");
        let other = dir.path().join("other");
        fs::create_dir_all(&local).unwrap();

        git(dir.path(), &["init", "--bare", bare.to_str().unwrap()]);
        git(&local, &["init", "-b", "main"]);
        git(&local, &["config", "user.email", "a@example.com"]);
        git(&local, &["config", "user.name", "A"]);
        fs::write(local.join("f.txt"), "one\n").unwrap();
        git(&local, &["add", "f.txt"]);
        git(&local, &["commit", "-m", "one"]);
        git(
            &local,
            &["remote", "add", "origin", bare.to_str().unwrap()],
        );
        git(&local, &["push", "-u", "origin", "main"]);

        git(dir.path(), &["clone", bare.to_str().unwrap(), other.to_str().unwrap()]);
        git(&other, &["config", "user.email", "b@example.com"]);
        git(&other, &["config", "user.name", "B"]);
        fs::write(other.join("f.txt"), "two\n").unwrap();
        git(&other, &["add", "f.txt"]);
        git(&other, &["commit", "-m", "two"]);
        git(&other, &["push"]);

        let coordinator = FetchCoordinator::new(GitExecutor::from_path().unwrap());
        let outcome = coordinator
            .pull_one_with_auth(RepositoryId::new(), &local, None, |_| {})
            .await;
        assert!(outcome.success, "{outcome:?}");
        assert!(!outcome.has_conflicts);
        let contents = fs::read_to_string(local.join("f.txt")).unwrap();
        assert_eq!(contents, "two\n");
    }

    #[tokio::test]
    async fn pull_detects_conflicts() {
        let dir = tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        let local = dir.path().join("local");
        let other = dir.path().join("other");
        fs::create_dir_all(&local).unwrap();

        git(dir.path(), &["init", "--bare", bare.to_str().unwrap()]);
        git(&local, &["init", "-b", "main"]);
        git(&local, &["config", "user.email", "a@example.com"]);
        git(&local, &["config", "user.name", "A"]);
        fs::write(local.join("f.txt"), "base\n").unwrap();
        git(&local, &["add", "f.txt"]);
        git(&local, &["commit", "-m", "base"]);
        git(
            &local,
            &["remote", "add", "origin", bare.to_str().unwrap()],
        );
        git(&local, &["push", "-u", "origin", "main"]);

        git(dir.path(), &["clone", bare.to_str().unwrap(), other.to_str().unwrap()]);
        git(&other, &["config", "user.email", "b@example.com"]);
        git(&other, &["config", "user.name", "B"]);

        fs::write(local.join("f.txt"), "local change\n").unwrap();
        git(&local, &["add", "f.txt"]);
        git(&local, &["commit", "-m", "local"]);

        fs::write(other.join("f.txt"), "remote change\n").unwrap();
        git(&other, &["add", "f.txt"]);
        git(&other, &["commit", "-m", "remote"]);
        git(&other, &["push"]);

        // Local is ahead and diverged; pull should conflict (or need merge).
        let coordinator = FetchCoordinator::new(GitExecutor::from_path().unwrap());
        let outcome = coordinator
            .pull_one_with_auth(RepositoryId::new(), &local, None, |_| {})
            .await;
        assert!(outcome.has_conflicts, "{outcome:?}");
        assert!(
            outcome
                .conflicted_paths
                .iter()
                .any(|p| p == "f.txt" || p.ends_with("f.txt")),
            "{outcome:?}"
        );
        // Leave the repo usable for the test process.
        git_allow_fail(&local, &["merge", "--abort"]);
    }
}
