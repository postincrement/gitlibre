use crate::error::{CoreError, CoreResult};
use crate::git::executor::GitExecutor;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeStatus {
    pub modified: u32,
    pub added: u32,
    pub deleted: u32,
    pub untracked: u32,
    pub renamed: u32,
    pub conflicted: u32,
}

impl WorkingTreeStatus {
    pub fn is_clean(&self) -> bool {
        self.modified == 0
            && self.added == 0
            && self.deleted == 0
            && self.untracked == 0
            && self.renamed == 0
            && self.conflicted == 0
    }

    pub fn changed_file_count(&self) -> u32 {
        self.modified + self.added + self.deleted + self.untracked + self.renamed + self.conflicted
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoInspection {
    pub current_branch: Option<String>,
    pub detached_head: bool,
    pub remotes: Vec<RemoteInfo>,
    pub working_tree: WorkingTreeStatus,
    pub upstream: Option<String>,
}

/// Inspect a local Git repository using porcelain v2 status and related commands.
pub async fn inspect_repository(
    executor: &GitExecutor,
    repo_path: &Path,
) -> CoreResult<RepoInspection> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }

    let git_meta = repo_path.join(".git");
    if !git_meta.exists() {
        return Err(CoreError::not_a_git_repository(repo_path.display()));
    }

    let status_out = executor
        .run(repo_path, &["status", "--porcelain=v2", "--branch", "-z"])
        .await?;
    if !status_out.success() {
        return Err(CoreError::process_failed(format!(
            "git status failed: {}",
            status_out.stderr_lossy()
        )));
    }

    let parsed = parse_porcelain_v2(&status_out.stdout);

    let branch_out = executor
        .run(repo_path, &["branch", "--show-current"])
        .await?;
    let current_branch = if branch_out.success() {
        let name = branch_out.stdout_lossy().trim().to_string();
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    } else {
        parsed.branch.clone()
    };

    let detached_head = current_branch.is_none() && parsed.head_oid.is_some();

    let remotes = list_remotes(executor, repo_path).await?;

    Ok(RepoInspection {
        current_branch: current_branch.or(parsed.branch),
        detached_head,
        remotes,
        working_tree: parsed.working_tree,
        upstream: parsed.upstream,
    })
}

#[derive(Debug, Default)]
pub struct PorcelainParse {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub head_oid: Option<String>,
    pub working_tree: WorkingTreeStatus,
}

/// Parse `git status --porcelain=v2 -z` output.
///
/// Entries are NUL-separated. Branch headers start with `#`.
pub fn parse_porcelain_v2(bytes: &[u8]) -> PorcelainParse {
    let mut result = PorcelainParse::default();
    for entry in bytes.split(|b| *b == 0) {
        if entry.is_empty() {
            continue;
        }
        let line = String::from_utf8_lossy(entry);
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            if rest != "(detached)" {
                result.branch = Some(rest.to_string());
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("# branch.oid ") {
            result.head_oid = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            result.upstream = Some(rest.to_string());
            continue;
        }
        if line.starts_with('#') {
            continue;
        }

        // Ordinary changed entries: "1 XY ..." or "2 XY ..." (rename) or "u ..." (unmerged)
        // Untracked: "? <path>"
        let bytes_line = entry;
        if bytes_line.first() == Some(&b'?') {
            result.working_tree.untracked += 1;
            continue;
        }
        if bytes_line.first() == Some(&b'u') {
            result.working_tree.conflicted += 1;
            continue;
        }
        if bytes_line.first() == Some(&b'2') {
            result.working_tree.renamed += 1;
            // Renames may also imply add/delete; count as renamed for M1.
            continue;
        }
        if bytes_line.first() == Some(&b'1') {
            // Format: "1 <XY> <sub> ..." — XY is exactly two bytes and may contain spaces.
            // Do not use split_whitespace for XY or a leading space is lost.
            if bytes_line.len() >= 4 && bytes_line[1] == b' ' {
                classify_xy(bytes_line[2], bytes_line[3], &mut result.working_tree);
            }
        }
    }
    result
}

fn classify_xy(x: u8, y: u8, wt: &mut WorkingTreeStatus) {
    let ch = if y != b'.' { y } else { x };
    match ch {
        b'M' => wt.modified += 1,
        b'A' => wt.added += 1,
        b'D' => wt.deleted += 1,
        b'R' => wt.renamed += 1,
        b'C' => wt.added += 1,
        b'U' => wt.conflicted += 1,
        _ => {
            if x != b'.' {
                match x {
                    b'M' => wt.modified += 1,
                    b'A' => wt.added += 1,
                    b'D' => wt.deleted += 1,
                    _ => wt.modified += 1,
                }
            }
        }
    }
}

async fn list_remotes(executor: &GitExecutor, repo_path: &Path) -> CoreResult<Vec<RemoteInfo>> {
    let out = executor.run(repo_path, &["remote", "-v"]).await?;
    if !out.success() {
        return Err(CoreError::process_failed(format!(
            "git remote failed: {}",
            out.stderr_lossy()
        )));
    }
    Ok(parse_remotes(&out.stdout_lossy()))
}

fn parse_remotes(text: &str) -> Vec<RemoteInfo> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, (Option<String>, Option<String>)> = BTreeMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].to_string();
        let url = parts[1].to_string();
        let kind = parts[2];
        let entry = map.entry(name).or_insert((None, None));
        if kind.contains("fetch") {
            entry.0 = Some(url);
        } else if kind.contains("push") {
            entry.1 = Some(url);
        }
    }
    map.into_iter()
        .map(|(name, (fetch, push))| {
            let fetch_url = fetch.clone().unwrap_or_default();
            let push_url = push.unwrap_or_else(|| fetch.unwrap_or_default());
            RemoteInfo {
                name,
                fetch_url,
                push_url,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn parse_clean_and_dirty_porcelain() {
        let clean = b"# branch.head main\0# branch.oid abc\0";
        let p = parse_porcelain_v2(clean);
        assert_eq!(p.branch.as_deref(), Some("main"));
        assert!(p.working_tree.is_clean());

        let dirty = b"# branch.head main\01 M N... 100644 100644 100644 abc def file.txt\0? untracked.txt\0";
        let p = parse_porcelain_v2(dirty);
        assert_eq!(p.working_tree.modified, 1);
        assert_eq!(p.working_tree.untracked, 1);
    }

    #[test]
    fn parse_detached() {
        let detached = b"# branch.head (detached)\0# branch.oid abc\0";
        let p = parse_porcelain_v2(detached);
        assert!(p.branch.is_none());
        assert_eq!(p.head_oid.as_deref(), Some("abc"));
    }

    #[tokio::test]
    async fn inspect_temp_repo() {
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
        fs::write(repo.join("dirty.txt"), "x").unwrap();

        let executor = GitExecutor::from_path().unwrap();
        let info = inspect_repository(&executor, &repo).await.unwrap();
        assert_eq!(info.current_branch.as_deref(), Some("main"));
        assert!(!info.detached_head);
        assert!(info.working_tree.untracked >= 1);
    }
}
