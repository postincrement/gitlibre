use crate::auth::GitAuth;
use crate::error::{CoreError, ErrorCode};
use crate::git::GitExecutor;
use crate::ids::RepositoryId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

const DEFAULT_CONCURRENCY: usize = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FetchProgress {
    pub repository_id: RepositoryId,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FetchOutcome {
    pub repository_id: RepositoryId,
    pub success: bool,
    pub summary: String,
    pub error: Option<CoreError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFetchSummary {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub outcomes: Vec<FetchOutcome>,
}

struct RepoLockGate {
    locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

impl RepoLockGate {
    fn new() -> Self {
        Self {
            locks: Mutex::new(HashMap::new()),
        }
    }

    async fn lock_for(&self, path: &Path) -> Arc<Mutex<()>> {
        let mut map = self.locks.lock().await;
        map.entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

/// Coordinates individual and workspace-wide fetches with bounded concurrency
/// and per-canonical-path mutual exclusion.
pub struct FetchCoordinator {
    executor: GitExecutor,
    semaphore: Arc<Semaphore>,
    locks: Arc<RepoLockGate>,
}

impl FetchCoordinator {
    pub fn new(executor: GitExecutor) -> Self {
        Self::with_concurrency(executor, DEFAULT_CONCURRENCY)
    }

    pub fn with_concurrency(executor: GitExecutor, concurrency: usize) -> Self {
        Self {
            executor,
            semaphore: Arc::new(Semaphore::new(concurrency.max(1))),
            locks: Arc::new(RepoLockGate::new()),
        }
    }

    pub fn executor(&self) -> &GitExecutor {
        &self.executor
    }

    /// Run `f` while holding the per-repo mutex (same gate as fetch).
    pub async fn with_repo_lock<F, Fut, T>(&self, repo_path: &Path, f: F) -> T
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = T>,
    {
        let gate = self.locks.lock_for(repo_path).await;
        let _guard = gate.lock().await;
        f().await
    }

    pub async fn fetch_one<F>(
        &self,
        repository_id: RepositoryId,
        repo_path: &Path,
        on_progress: F,
    ) -> FetchOutcome
    where
        F: FnMut(FetchProgress) + Send,
    {
        self.fetch_one_with_auth(repository_id, repo_path, None, on_progress)
            .await
    }

    pub async fn fetch_one_with_auth<F>(
        &self,
        repository_id: RepositoryId,
        repo_path: &Path,
        auth: Option<GitAuth>,
        mut on_progress: F,
    ) -> FetchOutcome
    where
        F: FnMut(FetchProgress) + Send,
    {
        if !repo_path.exists() {
            return FetchOutcome {
                repository_id,
                success: false,
                summary: format!("Path no longer exists: {}", repo_path.display()),
                error: Some(CoreError::path_not_found(repo_path.display())),
            };
        }

        let gate = self.locks.lock_for(repo_path).await;
        let _path_guard = gate.lock().await;
        let _permit = match self.semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => {
                return FetchOutcome {
                    repository_id,
                    success: false,
                    summary: "Fetch coordinator shut down".into(),
                    error: Some(CoreError::new(ErrorCode::Cancelled, "Fetch cancelled")),
                };
            }
        };

        // Ensure at least one remote exists.
        match self.executor.run(repo_path, &["remote"]).await {
            Ok(out) if out.success() => {
                if out.stdout_lossy().trim().is_empty() {
                    return FetchOutcome {
                        repository_id,
                        success: false,
                        summary: "No remotes configured".into(),
                        error: Some(CoreError::new(
                            ErrorCode::NoRemotes,
                            "No remotes configured for this repository.",
                        )),
                    };
                }
            }
            Ok(out) => {
                return FetchOutcome {
                    repository_id,
                    success: false,
                    summary: out.stderr_lossy(),
                    error: Some(CoreError::process_failed(out.stderr_lossy())),
                };
            }
            Err(e) => {
                return FetchOutcome {
                    repository_id,
                    success: false,
                    summary: e.message.clone(),
                    error: Some(e),
                };
            }
        }

        let progress_id = repository_id;
        let auth_ref = auth.as_ref();
        let result = self
            .executor
            .run_with_stderr_progress_auth(
                repo_path,
                &["fetch", "--all", "--progress"],
                auth_ref,
                |msg| {
                    on_progress(FetchProgress {
                        repository_id: progress_id,
                        message: msg,
                    });
                },
            )
            .await;

        match result {
            Ok(out) if out.success() => FetchOutcome {
                repository_id,
                success: true,
                summary: if out.stderr_lossy().trim().is_empty() {
                    "Fetch completed".into()
                } else {
                    out.stderr_lossy().trim().lines().last().unwrap_or("Fetch completed").to_string()
                },
                error: None,
            },
            Ok(out) => {
                let err = CoreError::map_git_failure(&out.stderr_lossy(), &out.stdout_lossy());
                FetchOutcome {
                    repository_id,
                    success: false,
                    summary: err.message.clone(),
                    error: Some(err),
                }
            }
            Err(e) => FetchOutcome {
                repository_id,
                success: false,
                summary: e.message.clone(),
                error: Some(e),
            },
        }
    }

    /// Fetch many repositories independently. One failure does not stop others.
    pub async fn fetch_many<F>(
        &self,
        repos: Vec<(RepositoryId, PathBuf)>,
        on_progress: F,
    ) -> WorkspaceFetchSummary
    where
        F: Fn(FetchProgress) + Send + Sync + Clone + 'static,
    {
        self.fetch_many_with_auth(
            repos
                .into_iter()
                .map(|(id, path)| (id, path, None))
                .collect(),
            on_progress,
        )
        .await
    }

    pub async fn fetch_many_with_auth<F>(
        &self,
        repos: Vec<(RepositoryId, PathBuf, Option<GitAuth>)>,
        on_progress: F,
    ) -> WorkspaceFetchSummary
    where
        F: Fn(FetchProgress) + Send + Sync + Clone + 'static,
    {
        let total = repos.len();
        let mut handles = Vec::with_capacity(total);

        for (id, path, auth) in repos {
            let coordinator = self.clone_handles();
            let on_progress = on_progress.clone();
            handles.push(tokio::spawn(async move {
                coordinator
                    .fetch_one_with_auth(id, &path, auth, |p| on_progress(p))
                    .await
            }));
        }

        let mut outcomes = Vec::with_capacity(total);
        for handle in handles {
            match handle.await {
                Ok(outcome) => outcomes.push(outcome),
                Err(e) => outcomes.push(FetchOutcome {
                    repository_id: RepositoryId::new(),
                    success: false,
                    summary: format!("Fetch task failed: {e}"),
                    error: Some(CoreError::new(ErrorCode::Internal, e.to_string())),
                }),
            }
        }

        let succeeded = outcomes.iter().filter(|o| o.success).count();
        let failed = total.saturating_sub(succeeded);
        WorkspaceFetchSummary {
            total,
            succeeded,
            failed,
            outcomes,
        }
    }

    fn clone_handles(&self) -> Self {
        Self {
            executor: self.executor.clone(),
            semaphore: Arc::clone(&self.semaphore),
            locks: Arc::clone(&self.locks),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn setup_repo_with_bare_remote(root: &Path) -> (PathBuf, PathBuf) {
        let bare = root.join("remote.git");
        let local = root.join("local");
        fs::create_dir_all(&local).unwrap();
        git(root, &["init", "--bare", bare.to_str().unwrap()]);
        git(&local, &["init", "-b", "main"]);
        git(&local, &["config", "user.email", "test@example.com"]);
        git(&local, &["config", "user.name", "Test"]);
        fs::write(local.join("file.txt"), "v1").unwrap();
        git(&local, &["add", "file.txt"]);
        git(&local, &["commit", "-m", "init"]);
        git(
            &local,
            &[
                "remote",
                "add",
                "origin",
                bare.to_str().unwrap(),
            ],
        );
        git(&local, &["push", "-u", "origin", "main"]);
        (local, bare)
    }

    #[tokio::test]
    async fn fetch_success_and_no_remotes_failure() {
        let dir = tempdir().unwrap();
        let (local, _bare) = setup_repo_with_bare_remote(dir.path());
        let executor = GitExecutor::from_path().unwrap();
        let coordinator = FetchCoordinator::new(executor);

        let id = RepositoryId::new();
        let ok = coordinator
            .fetch_one(id, &local, |_| {})
            .await;
        assert!(ok.success, "{ok:?}");

        let lonely = dir.path().join("lonely");
        fs::create_dir(&lonely).unwrap();
        git(&lonely, &["init"]);
        let fail = coordinator
            .fetch_one(RepositoryId::new(), &lonely, |_| {})
            .await;
        assert!(!fail.success);
        assert_eq!(
            fail.error.as_ref().map(|e| e.code),
            Some(ErrorCode::NoRemotes)
        );
    }

    #[tokio::test]
    async fn workspace_fetch_mixed_outcomes() {
        let dir = tempdir().unwrap();
        let (good, _) = setup_repo_with_bare_remote(dir.path());
        let bad = dir.path().join("bad");
        fs::create_dir(&bad).unwrap();
        git(&bad, &["init"]);

        let coordinator = FetchCoordinator::new(GitExecutor::from_path().unwrap());
        let repos = vec![
            (RepositoryId::new(), good),
            (RepositoryId::new(), bad),
        ];
        let summary = coordinator.fetch_many(repos, |_| {}).await;
        assert_eq!(summary.total, 2);
        assert_eq!(summary.succeeded, 1);
        assert_eq!(summary.failed, 1);
    }
}
