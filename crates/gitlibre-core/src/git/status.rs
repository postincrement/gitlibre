use crate::error::CoreResult;
use crate::git::session::string_list;
use crate::git::identity::read_commit_identity_at;
use crate::git::session::{blocking, map_git2, open_repo};
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
    /// Effective `user.name` for this repo (local preferred over global).
    pub commit_name: Option<String>,
    /// Effective `user.email` for this repo (local preferred over global).
    pub commit_email: Option<String>,
    /// True when name and/or email are set in this repo's local `.git/config`.
    pub commit_identity_is_local: bool,
}

/// Inspect a local Git repository.
pub async fn inspect_repository(repo_path: &Path) -> CoreResult<RepoInspection> {
    let path = repo_path.to_path_buf();
    blocking(move || inspect_repository_at(&path)).await
}

fn inspect_repository_at(repo_path: &Path) -> CoreResult<RepoInspection> {
    let repo = open_repo(repo_path)?;
    let (current_branch, detached_head) = head_branch(&repo)?;
    let remotes = remote_infos(&repo)?;
    let identity = read_commit_identity_at(repo_path)?;
    Ok(RepoInspection {
        current_branch,
        detached_head,
        remotes,
        working_tree: working_tree_status(&repo)?,
        upstream: upstream_name(&repo),
        commit_name: identity.name,
        commit_email: identity.email,
        commit_identity_is_local: identity.is_local,
    })
}

fn head_branch(repo: &git2::Repository) -> CoreResult<(Option<String>, bool)> {
    match repo.head() {
        Ok(head) if head.is_branch() => Ok((head.shorthand().ok().map(str::to_string), false)),
        Ok(_) => Ok((None, true)),
        Err(err) if err.code() == git2::ErrorCode::UnbornBranch => Ok((None, false)),
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok((None, false)),
        Err(err) => Err(map_git2(err)),
    }
}

fn upstream_name(repo: &git2::Repository) -> Option<String> {
    let head = repo.head().ok()?;
    let name = head.shorthand().ok()?;
    let branch = repo.find_branch(name, git2::BranchType::Local).ok()?;
    let upstream = branch.upstream().ok()?;
    upstream.name().ok().flatten().map(str::to_string)
}

pub(crate) fn remote_infos(repo: &git2::Repository) -> CoreResult<Vec<RemoteInfo>> {
    let names = repo.remotes().map_err(map_git2)?;
    let mut remotes = Vec::new();
    for name in string_list(&names) {
        let remote = repo.find_remote(&name).map_err(map_git2)?;
        let fetch_url = remote.url().unwrap_or("").to_string();
        let push_url = remote
            .pushurl()
            .ok()
            .flatten()
            .unwrap_or(fetch_url.as_str())
            .to_string();
        remotes.push(RemoteInfo {
            name,
            fetch_url,
            push_url,
        });
    }
    Ok(remotes)
}

fn working_tree_status(repo: &git2::Repository) -> CoreResult<WorkingTreeStatus> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .exclude_submodules(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(map_git2)?;
    let mut working_tree = WorkingTreeStatus::default();
    for entry in statuses.iter() {
        let status = entry.status();
        if status.is_conflicted() {
            working_tree.conflicted += 1;
            continue;
        }
        if status.is_wt_new() {
            working_tree.untracked += 1;
            continue;
        }
        if status.is_index_renamed() || status.is_wt_renamed() {
            working_tree.renamed += 1;
            continue;
        }
        if status.is_index_new() {
            working_tree.added += 1;
        } else if status.is_index_deleted() || status.is_wt_deleted() {
            working_tree.deleted += 1;
        } else if status.is_index_modified()
            || status.is_wt_modified()
            || status.is_index_typechange()
            || status.is_wt_typechange()
        {
            working_tree.modified += 1;
        }
    }
    Ok(working_tree)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil;
    use std::fs;
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
        let git_repo = testutil::init_repo(&repo);
        testutil::commit_file(&git_repo, "README", "hi", "init");
        fs::write(repo.join("dirty.txt"), "x").unwrap();

        let info = inspect_repository(&repo).await.unwrap();
        assert_eq!(info.current_branch.as_deref(), Some("main"));
        assert!(!info.detached_head);
        assert!(info.working_tree.untracked >= 1);
    }
}
