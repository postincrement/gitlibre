use crate::error::{CoreError, CoreResult, ErrorCode};
use crate::git::session::{blocking, map_git2, open_repo, string_list};
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
pub async fn list_local_branches(repo_path: &Path) -> CoreResult<Vec<BranchInfo>> {
    list_local_branches_for_remote(repo_path, None).await
}

pub async fn list_local_branches_for_remote(
    repo_path: &Path,
    remote_name: Option<&str>,
) -> CoreResult<Vec<BranchInfo>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    let path = repo_path.to_path_buf();
    let remote_name = remote_name.map(str::to_string);
    blocking(move || list_local_branches_at(&path, remote_name.as_deref())).await
}

fn list_local_branches_at(repo_path: &Path, remote_name: Option<&str>) -> CoreResult<Vec<BranchInfo>> {
    let repo = open_repo(repo_path)?;
    let head_name = repo
        .head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().ok().map(str::to_string));
    let mut branches = Vec::new();
    for branch in repo.branches(Some(git2::BranchType::Local)).map_err(map_git2)? {
        let (branch, _) = branch.map_err(map_git2)?;
        let Some(name) = branch.name().map_err(map_git2)? else {
            continue;
        };
        let name = name.to_string();
        branches.push(BranchInfo {
            is_current: head_name.as_deref() == Some(name.as_str()),
            behind: None,
            ahead: None,
            name,
        });
    }
    branches.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    if let Some(remote) = resolve_compare_remote(&repo, remote_name)? {
        for branch in &mut branches {
            let (behind, ahead) = count_ahead_behind(&repo, &branch.name, &remote)?;
            branch.behind = behind;
            branch.ahead = ahead;
        }
    }
    Ok(branches)
}

fn resolve_compare_remote(
    repo: &git2::Repository,
    remote_name: Option<&str>,
) -> CoreResult<Option<String>> {
    let names = repo.remotes().map_err(map_git2)?;
    let remotes = string_list(&names);
    if remotes.is_empty() {
        return Ok(None);
    }
    if let Some(wanted) = remote_name {
        if remotes.iter().any(|remote| remote == wanted) {
            return Ok(Some(wanted.to_string()));
        }
    }
    if let Some(origin) = remotes.iter().find(|remote| remote.as_str() == "origin") {
        return Ok(Some(origin.clone()));
    }
    Ok(remotes.into_iter().next())
}

fn count_ahead_behind(
    repo: &git2::Repository,
    branch: &str,
    remote: &str,
) -> CoreResult<(Option<u32>, Option<u32>)> {
    let remote_ref = format!("refs/remotes/{remote}/{branch}");
    let remote_oid = match repo.find_reference(&remote_ref) {
        Ok(reference) => match reference.peel_to_commit() {
            Ok(commit) => commit.id(),
            Err(_) => return Ok((None, None)),
        },
        Err(_) => return Ok((None, None)),
    };
    let local_oid = match repo.find_reference(&format!("refs/heads/{branch}")) {
        Ok(reference) => match reference.peel_to_commit() {
            Ok(commit) => commit.id(),
            Err(_) => return Ok((None, None)),
        },
        Err(_) => return Ok((None, None)),
    };
    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, remote_oid)
        .map_err(map_git2)?;
    Ok((Some(behind as u32), Some(ahead as u32)))
}

/// List remote-tracking branches for `remote`, as paths relative to that remote
/// (e.g. `main`, `feature/x` — not `origin/main`).
pub async fn list_remote_branches(repo_path: &Path, remote: &str) -> CoreResult<Vec<String>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    if remote.is_empty() || remote.contains('/') || remote.contains('\\') {
        return Err(CoreError::new(
            ErrorCode::Internal,
            format!("Invalid remote name: {remote}"),
        ));
    }
    let path = repo_path.to_path_buf();
    let remote = remote.to_string();
    blocking(move || list_remote_branches_at(&path, &remote)).await
}

fn list_remote_branches_at(repo_path: &Path, remote: &str) -> CoreResult<Vec<String>> {
    let repo = open_repo(repo_path)?;
    let prefix = format!("refs/remotes/{remote}/");
    let mut names = Vec::new();
    for reference in repo.references().map_err(map_git2)?.flatten() {
        let Ok(name) = reference.name() else {
            continue;
        };
        let Some(rest) = name.strip_prefix(&prefix) else {
            continue;
        };
        if rest.is_empty() || rest == "HEAD" {
            continue;
        }
        names.push(rest.to_string());
    }
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    names.dedup();
    Ok(names)
}

/// Check out `revision` (commit, tag, or branch). May leave HEAD detached.
pub async fn checkout_revision(repo_path: &Path, revision: &str) -> CoreResult<()> {
    validate_revision(revision)?;
    let path = repo_path.to_path_buf();
    let revision = revision.trim().to_string();
    blocking(move || {
        let repo = open_repo(&path)?;
        let (object, reference) = repo.revparse_ext(&revision).map_err(map_git2)?;
        repo.checkout_tree(&object, Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(map_git2)?;
        if let Some(reference) = reference.filter(|reference| reference.is_branch()) {
            let name = reference.name().map_err(map_git2)?;
            repo.set_head(name).map_err(map_git2)?;
        } else {
            repo.set_head_detached(object.id()).map_err(map_git2)?;
        }
        Ok(())
    })
    .await
}

/// Create and check out a new branch at `revision`.
pub async fn create_branch_at(repo_path: &Path, name: &str, revision: &str) -> CoreResult<()> {
    validate_ref_name(name, "branch")?;
    validate_revision(revision)?;
    let path = repo_path.to_path_buf();
    let name = name.trim().to_string();
    let revision = revision.trim().to_string();
    blocking(move || {
        let repo = open_repo(&path)?;
        let target = repo.revparse_single(&revision).map_err(map_git2)?;
        let commit = target.peel_to_commit().map_err(map_git2)?;
        repo.branch(&name, &commit, false).map_err(map_git2)?;
        let refname = format!("refs/heads/{name}");
        repo.set_head(&refname).map_err(map_git2)?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(map_git2)?;
        Ok(())
    })
    .await
}

/// Create a lightweight tag at `revision`.
pub async fn create_tag_at(repo_path: &Path, name: &str, revision: &str) -> CoreResult<()> {
    validate_ref_name(name, "tag")?;
    validate_revision(revision)?;
    let path = repo_path.to_path_buf();
    let name = name.trim().to_string();
    let revision = revision.trim().to_string();
    blocking(move || {
        let repo = open_repo(&path)?;
        let object = repo.revparse_single(&revision).map_err(map_git2)?;
        repo.tag_lightweight(&name, &object, false).map_err(map_git2)?;
        Ok(())
    })
    .await
}

fn validate_revision(revision: &str) -> CoreResult<()> {
    let revision = revision.trim();
    if revision.is_empty() || revision.contains('\0') || revision.starts_with('-') {
        return Err(CoreError::new(ErrorCode::Internal, "Invalid revision"));
    }
    Ok(())
}

fn validate_ref_name(name: &str, kind: &str) -> CoreResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::new(
            ErrorCode::Internal,
            format!("{kind} name must not be empty"),
        ));
    }
    if name.contains('\0')
        || name.starts_with('-')
        || name.contains("..")
        || name.contains(' ')
        || name.contains('\\')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.ends_with('.')
        || name.ends_with('/')
        || name.contains("@{")
    {
        return Err(CoreError::new(
            ErrorCode::Internal,
            format!("Invalid {kind} name"),
        ));
    }
    Ok(())
}

#[cfg(test)]
fn parse_remote_branch_names(text: &str, remote: &str) -> Vec<String> {
    let head_symlink = format!("{remote}/HEAD");
    let mut names: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| *line != head_symlink && *line != "HEAD")
        .filter_map(|line| {
            // Prefer names without the remote prefix; accept either form.
            let name = line
                .strip_prefix(&format!("{remote}/"))
                .unwrap_or(line)
                .to_string();
            if name.is_empty() || name == "HEAD" {
                None
            } else {
                Some(name)
            }
        })
        .collect();
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    names.dedup();
    names
}

#[cfg(test)]
fn parse_left_right_count(text: &str) -> (Option<u32>, Option<u32>) {
    let parts: Vec<&str> = text.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let ahead = parts[0].parse::<u32>().ok();
    let behind = parts[1].parse::<u32>().ok();
    (behind, ahead)
}

#[cfg(test)]
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
    use crate::testutil;
    use std::fs;
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
        let git_repo = testutil::init_repo(&repo);
        testutil::commit_file(&git_repo, "README", "hi", "init");
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        git_repo.branch("develop", &head, false).unwrap();

        let branches = list_local_branches(&repo).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "main" && b.is_current));
        assert!(branches.iter().any(|b| b.name == "develop" && !b.is_current));
        assert!(branches.iter().all(|b| b.behind.is_none() && b.ahead.is_none()));
    }

    #[test]
    fn parse_left_right() {
        assert_eq!(parse_left_right_count("2\t5\n"), (Some(5), Some(2)));
        assert_eq!(parse_left_right_count("0 0"), (Some(0), Some(0)));
    }

    #[test]
    fn parse_remote_names_strips_prefix_and_head() {
        let text = "origin/HEAD\norigin/main\norigin/feature/x\nmain\n";
        let names = parse_remote_branch_names(text, "origin");
        assert_eq!(names, vec!["feature/x", "main"]);
    }

    #[tokio::test]
    async fn behind_counts_against_remote_tracking_branch() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        fs::create_dir(&repo_path).unwrap();
        let repo = testutil::init_repo(&repo_path);
        let first = testutil::commit_file(&repo, "a.txt", "1", "one");
        let second = testutil::commit_file(&repo, "b.txt", "2", "two");
        let first_commit = repo.find_commit(first).unwrap();
        repo.reset(first_commit.as_object(), git2::ResetType::Hard, None)
            .unwrap();
        repo.reference(
            "refs/remotes/origin/main",
            second,
            true,
            "test upstream",
        )
        .unwrap();
        repo.remote("origin", repo_path.to_str().unwrap()).unwrap();

        let branches = list_local_branches_for_remote(&repo_path, Some("origin"))
            .await
            .unwrap();
        let main = branches.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(main.behind, Some(1));
        assert_eq!(main.ahead, Some(0));
    }
}
