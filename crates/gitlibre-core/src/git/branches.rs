use crate::error::{CoreError, CoreResult};
use crate::git::executor::GitExecutor;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A local branch in a repository.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    /// Commits on the selected remote's matching branch that are not in this
    /// local branch. `None` when there is no comparable remote-tracking ref.
    pub behind: Option<u32>,
    /// Commits on this local branch that are not on the remote matching branch.
    /// `None` when there is no comparable remote-tracking ref.
    pub ahead: Option<u32>,
}

/// List local branches (`refs/heads/*`), marking the checked-out branch and
/// how far each is behind `{remote}/{branch}` when that ref exists.
///
/// `remote_name` selects which remote to compare against. When `None`, prefers
/// `origin`, else the first configured remote.
pub async fn list_local_branches(
    executor: &GitExecutor,
    repo_path: &Path,
) -> CoreResult<Vec<BranchInfo>> {
    list_local_branches_for_remote(executor, repo_path, None).await
}

pub async fn list_local_branches_for_remote(
    executor: &GitExecutor,
    repo_path: &Path,
    remote_name: Option<&str>,
) -> CoreResult<Vec<BranchInfo>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }

    let out = executor
        .run(
            repo_path,
            &[
                "for-each-ref",
                "--format=%(refname:short)%09%(HEAD)",
                "refs/heads",
            ],
        )
        .await?;

    if !out.success() {
        return Err(CoreError::process_failed(format!(
            "git for-each-ref failed: {}",
            out.stderr_lossy().trim()
        )));
    }

    let mut branches = parse_for_each_ref_heads(&out.stdout_lossy());
    let remote = resolve_compare_remote(executor, repo_path, remote_name).await?;

    if let Some(remote) = remote.as_deref() {
        for branch in &mut branches {
            let (behind, ahead) =
                count_ahead_behind(executor, repo_path, &branch.name, remote).await?;
            branch.behind = behind;
            branch.ahead = ahead;
        }
    }

    Ok(branches)
}

async fn resolve_compare_remote(
    executor: &GitExecutor,
    repo_path: &Path,
    remote_name: Option<&str>,
) -> CoreResult<Option<String>> {
    let out = executor.run(repo_path, &["remote"]).await?;
    if !out.success() {
        return Ok(None);
    }
    let remotes: Vec<String> = out
        .stdout_lossy()
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if remotes.is_empty() {
        return Ok(None);
    }
    if let Some(wanted) = remote_name {
        if remotes.iter().any(|r| r == wanted) {
            return Ok(Some(wanted.to_string()));
        }
    }
    if let Some(origin) = remotes.iter().find(|r| *r == "origin") {
        return Ok(Some(origin.clone()));
    }
    Ok(remotes.into_iter().next())
}

async fn count_ahead_behind(
    executor: &GitExecutor,
    repo_path: &Path,
    branch: &str,
    remote: &str,
) -> CoreResult<(Option<u32>, Option<u32>)> {
    let remote_ref = format!("refs/remotes/{remote}/{branch}");
    let verify = executor
        .run(repo_path, &["rev-parse", "--verify", "--quiet", &remote_ref])
        .await?;
    if !verify.success() {
        return Ok((None, None));
    }

    // left = commits only on local (ahead), right = commits only on remote (behind)
    let range = format!("{branch}...{remote}/{branch}");
    let out = executor
        .run(repo_path, &["rev-list", "--left-right", "--count", &range])
        .await?;
    if !out.success() {
        return Ok((None, None));
    }
    Ok(parse_left_right_count(&out.stdout_lossy()))
}

fn parse_left_right_count(text: &str) -> (Option<u32>, Option<u32>) {
    let parts: Vec<&str> = text.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let ahead = parts[0].parse::<u32>().ok();
    let behind = parts[1].parse::<u32>().ok();
    (behind, ahead)
}

fn parse_for_each_ref_heads(text: &str) -> Vec<BranchInfo> {
    let mut branches: Vec<BranchInfo> = text
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let (name, head_mark) = match line.split_once('\t') {
                Some((n, h)) => (n, h),
                None => (line, ""),
            };
            if name.is_empty() {
                return None;
            }
            Some(BranchInfo {
                name: name.to_string(),
                is_current: head_mark.trim() == "*",
                behind: None,
                ahead: None,
            })
        })
        .collect();

    branches.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    branches
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn parse_marks_current_and_sorts_alpha() {
        let text = "zebra\t\nmain\t*\ndevelop\t\n";
        let list = parse_for_each_ref_heads(text);
        assert_eq!(list.len(), 3);
        assert_eq!(
            list.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(),
            vec!["develop", "main", "zebra"]
        );
        assert!(list.iter().find(|b| b.name == "main").unwrap().is_current);
    }

    #[tokio::test]
    async fn list_temp_repo_branches_without_remote() {
        let dir = tempdir().unwrap();
        let repo = dir.path().join("repo");
        fs::create_dir(&repo).unwrap();
        assert!(Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        fs::write(repo.join("README"), "hi").unwrap();
        assert!(Command::new("git")
            .args(["add", "README"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["branch", "develop"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());

        let executor = GitExecutor::from_path().unwrap();
        let branches = list_local_branches(&executor, &repo).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "main" && b.is_current));
        assert!(branches.iter().any(|b| b.name == "develop" && !b.is_current));
        assert!(branches.iter().all(|b| b.behind.is_none() && b.ahead.is_none()));
    }

    #[test]
    fn parse_left_right() {
        assert_eq!(parse_left_right_count("2\t5\n"), (Some(5), Some(2)));
        assert_eq!(parse_left_right_count("0 0"), (Some(0), Some(0)));
    }

    #[tokio::test]
    async fn behind_counts_against_remote_tracking_branch() {
        let dir = tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        let repo = dir.path().join("repo");
        assert!(Command::new("git")
            .args(["init", "--bare", "-b", "main"])
            .arg(&bare)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["clone", bare.to_str().unwrap(), repo.to_str().unwrap()])
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        fs::write(repo.join("a.txt"), "1").unwrap();
        assert!(Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "one"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["push", "-u", "origin", "main"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());

        // Advance origin/main without updating local tip: fetch after amending remote
        // via a second clone.
        let other = dir.path().join("other");
        assert!(Command::new("git")
            .args(["clone", bare.to_str().unwrap(), other.to_str().unwrap()])
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&other)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&other)
            .status()
            .unwrap()
            .success());
        fs::write(other.join("b.txt"), "2").unwrap();
        assert!(Command::new("git")
            .args(["add", "b.txt"])
            .current_dir(&other)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "two"])
            .current_dir(&other)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["push", "origin", "main"])
            .current_dir(&other)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["fetch", "origin"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());

        let executor = GitExecutor::from_path().unwrap();
        let branches = list_local_branches_for_remote(&executor, &repo, Some("origin"))
            .await
            .unwrap();
        let main = branches.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(main.behind, Some(1));
        assert_eq!(main.ahead, Some(0));
    }
}
