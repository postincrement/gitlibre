use crate::error::{CoreError, CoreResult};
use crate::git::executor::GitExecutor;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A path changed in a commit (or the working tree).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    /// Git status letter: A, M, D, R, C, T, etc.
    pub status: String,
    pub path: String,
    /// Present for renames/copies (status R/C).
    pub old_path: Option<String>,
}

/// Synthetic id used by the UI for the dirty working-tree row.
pub const UNCOMMITTED_COMMIT_ID: &str = "__gitlibre_uncommitted__";

/// List files changed by `commit` (`git show --name-status`), or working-tree
/// paths when `commit` is [`UNCOMMITTED_COMMIT_ID`].
pub async fn list_commit_files(
    executor: &GitExecutor,
    repo_path: &Path,
    commit: &str,
) -> CoreResult<Vec<CommitFileChange>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    if commit == UNCOMMITTED_COMMIT_ID {
        return list_working_tree_files(executor, repo_path).await;
    }
    if commit.is_empty() || commit.contains('\0') || commit.starts_with('-') {
        return Err(CoreError::new(
            crate::error::ErrorCode::Internal,
            "Invalid commit id",
        ));
    }

    let out = executor
        .run(
            repo_path,
            &[
                "show",
                "--format=",
                "--name-status",
                "--find-renames",
                commit,
            ],
        )
        .await?;

    if !out.success() {
        return Err(CoreError::process_failed(format!(
            "git show failed: {}",
            out.stderr_lossy().trim()
        )));
    }

    Ok(parse_name_status(&out.stdout_lossy()))
}

async fn list_working_tree_files(
    executor: &GitExecutor,
    repo_path: &Path,
) -> CoreResult<Vec<CommitFileChange>> {
    let out = executor
        .run(repo_path, &["status", "--porcelain=v1"])
        .await?;
    if !out.success() {
        return Err(CoreError::process_failed(format!(
            "git status failed: {}",
            out.stderr_lossy().trim()
        )));
    }
    Ok(parse_porcelain_v1_paths(&out.stdout_lossy()))
}

fn parse_porcelain_v1_paths(text: &str) -> Vec<CommitFileChange> {
    let mut files = Vec::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let xy = &line[..2];
        let rest = line[3..].trim();
        if rest.is_empty() {
            continue;
        }
        if let Some((old, new)) = rest.split_once(" -> ") {
            files.push(CommitFileChange {
                status: "R".to_string(),
                path: new.to_string(),
                old_path: Some(old.to_string()),
            });
            continue;
        }
        let status = if xy.contains('?') {
            "?".to_string()
        } else if xy.contains('A') || xy.starts_with('A') {
            "A".to_string()
        } else if xy.contains('D') {
            "D".to_string()
        } else if xy.contains('R') {
            "R".to_string()
        } else if xy.contains('U') {
            "U".to_string()
        } else {
            "M".to_string()
        };
        files.push(CommitFileChange {
            status,
            path: rest.to_string(),
            old_path: None,
        });
    }
    files
}

/// Unified diff for a single path in `commit`, or working-tree vs HEAD when
/// `commit` is [`UNCOMMITTED_COMMIT_ID`].
///
/// Uses `commit^..commit` (first parent) so merge commits still produce a
/// useful patch — plain `git show` combined diffs are often empty.
pub async fn get_commit_file_diff(
    executor: &GitExecutor,
    repo_path: &Path,
    commit: &str,
    path: &str,
) -> CoreResult<String> {
    get_commit_file_diff_with_old_path(executor, repo_path, commit, path, None).await
}

pub async fn get_commit_file_diff_with_old_path(
    executor: &GitExecutor,
    repo_path: &Path,
    commit: &str,
    path: &str,
    old_path: Option<&str>,
) -> CoreResult<String> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    validate_path_arg(path)?;
    if let Some(old) = old_path {
        validate_path_arg(old)?;
    }

    if commit == UNCOMMITTED_COMMIT_ID {
        return working_tree_file_diff(executor, repo_path, path, old_path).await;
    }
    if commit.is_empty() || commit.contains('\0') || commit.starts_with('-') {
        return Err(CoreError::new(
            crate::error::ErrorCode::Internal,
            "Invalid commit id",
        ));
    }

    let path_args = pathspec_args(path, old_path);
    let parent = format!("{commit}^");
    let has_parent = executor
        .run(repo_path, &["rev-parse", "--verify", "--quiet", &parent])
        .await?
        .success();

    let out = if has_parent {
        // First-parent diff — works for normal and merge commits.
        let mut args = vec![
            "diff".to_string(),
            "--find-renames".to_string(),
            parent,
            commit.to_string(),
            "--".to_string(),
        ];
        args.extend(path_args.iter().cloned());
        run_git_strings(executor, repo_path, &args).await?
    } else {
        // Root commit: show the patch introducing these paths.
        let mut args = vec![
            "show".to_string(),
            "--format=".to_string(),
            "--find-renames".to_string(),
            commit.to_string(),
            "--".to_string(),
        ];
        args.extend(path_args.iter().cloned());
        run_git_strings(executor, repo_path, &args).await?
    };

    if !diff_command_ok(&out) {
        return Err(CoreError::process_failed(format!(
            "git diff failed: {}",
            out.stderr_lossy().trim()
        )));
    }

    let text = out.stdout_lossy();
    if !text.trim().is_empty() {
        return Ok(text);
    }

    // Fallback: full `git show` patch (non-merge / uncommon pathspecs).
    let mut args = vec![
        "show".to_string(),
        "--format=".to_string(),
        "--find-renames".to_string(),
        "-m".to_string(),
        commit.to_string(),
        "--".to_string(),
    ];
    args.extend(path_args);
    let fallback = run_git_strings(executor, repo_path, &args).await?;
    if !diff_command_ok(&fallback) {
        return Err(CoreError::process_failed(format!(
            "git show failed: {}",
            fallback.stderr_lossy().trim()
        )));
    }
    Ok(fallback.stdout_lossy())
}

fn pathspec_args(path: &str, old_path: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(old) = old_path {
        if old != path {
            args.push(old.to_string());
        }
    }
    args.push(path.to_string());
    args
}

async fn run_git_strings(
    executor: &GitExecutor,
    repo_path: &Path,
    args: &[String],
) -> CoreResult<crate::git::executor::GitOutput> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    executor.run(repo_path, &refs).await
}

async fn working_tree_file_diff(
    executor: &GitExecutor,
    repo_path: &Path,
    path: &str,
    old_path: Option<&str>,
) -> CoreResult<String> {
    let path_args = pathspec_args(path, old_path);
    let mut vs_head_args = vec!["diff".to_string(), "HEAD".to_string(), "--".to_string()];
    vs_head_args.extend(path_args.iter().cloned());
    let vs_head = run_git_strings(executor, repo_path, &vs_head_args).await?;
    if diff_command_ok(&vs_head) && !vs_head.stdout.is_empty() {
        return Ok(vs_head.stdout_lossy());
    }

    // Staged-only (e.g. new file added to index).
    let mut cached_args = vec![
        "diff".to_string(),
        "--cached".to_string(),
        "--".to_string(),
    ];
    cached_args.extend(path_args.iter().cloned());
    let cached = run_git_strings(executor, repo_path, &cached_args).await?;
    if diff_command_ok(&cached) && !cached.stdout.is_empty() {
        return Ok(cached.stdout_lossy());
    }

    // Untracked: synthesize an add diff from the working tree file.
    let untracked = executor
        .run(
            repo_path,
            &["diff", "--no-index", "--", "/dev/null", path],
        )
        .await?;
    if diff_command_ok(&untracked) && !untracked.stdout.is_empty() {
        return Ok(untracked.stdout_lossy());
    }

    if diff_command_ok(&vs_head) {
        return Ok(vs_head.stdout_lossy());
    }

    Err(CoreError::process_failed(format!(
        "git diff failed: {}",
        vs_head.stderr_lossy().trim()
    )))
}

fn validate_path_arg(path: &str) -> CoreResult<()> {
    if path.is_empty() || path.contains('\0') || path.starts_with('-') {
        return Err(CoreError::new(
            crate::error::ErrorCode::Internal,
            "Invalid path",
        ));
    }
    Ok(())
}

fn diff_command_ok(out: &crate::git::executor::GitOutput) -> bool {
    // git diff/show exits 1 when differences are present.
    out.status == 0 || out.status == 1
}

fn parse_name_status(text: &str) -> Vec<CommitFileChange> {
    let mut files = Vec::new();
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let status_raw = parts.next().unwrap_or("").trim();
        if status_raw.is_empty() {
            continue;
        }
        let status_letter = status_raw
            .chars()
            .next()
            .map(|c| c.to_string())
            .unwrap_or_else(|| status_raw.to_string());

        if status_letter == "R" || status_letter == "C" {
            let old_path = parts.next().unwrap_or("").to_string();
            let new_path = parts.next().unwrap_or("").to_string();
            if new_path.is_empty() {
                continue;
            }
            files.push(CommitFileChange {
                status: status_raw.to_string(),
                path: new_path,
                old_path: if old_path.is_empty() {
                    None
                } else {
                    Some(old_path)
                },
            });
        } else {
            let path = parts.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            files.push(CommitFileChange {
                status: status_letter,
                path,
                old_path: None,
            });
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::GitExecutor;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn parse_modified_and_rename() {
        let text = "M\tsrc/a.rs\nA\tnew.txt\nR100\told.txt\tnewname.txt\n";
        let files = parse_name_status(text);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].path, "src/a.rs");
        assert_eq!(files[1].status, "A");
        assert_eq!(files[2].status, "R100");
        assert_eq!(files[2].old_path.as_deref(), Some("old.txt"));
        assert_eq!(files[2].path, "newname.txt");
    }

    #[tokio::test]
    async fn list_files_from_temp_repo() {
        let dir = tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]);
        git(&repo, &["config", "user.email", "dev@example.com"]);
        git(&repo, &["config", "user.name", "Dev"]);
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        git(&repo, &["add", "a.txt"]);
        git(&repo, &["commit", "-m", "first"]);
        std::fs::write(repo.join("a.txt"), "two\n").unwrap();
        std::fs::write(repo.join("b.txt"), "new\n").unwrap();
        git(&repo, &["add", "a.txt", "b.txt"]);
        git(&repo, &["commit", "-m", "second"]);

        let executor = GitExecutor::from_path().unwrap();
        let head = executor
            .run(&repo, &["rev-parse", "HEAD"])
            .await
            .unwrap()
            .stdout_lossy()
            .trim()
            .to_string();
        let files = list_commit_files(&executor, &repo, &head).await.unwrap();
        assert!(files.iter().any(|f| f.path == "a.txt" && f.status == "M"));
        assert!(files.iter().any(|f| f.path == "b.txt" && f.status == "A"));

        let diff = get_commit_file_diff(&executor, &repo, &head, "a.txt")
            .await
            .unwrap();
        assert!(diff.contains("-one") || diff.contains("-one\n"));
        assert!(diff.contains("+two") || diff.contains("+two\n"));
    }

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }
}
