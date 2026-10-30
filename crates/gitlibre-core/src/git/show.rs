use crate::error::{CoreError, CoreResult};
use crate::git::session::{blocking, map_git2, open_repo};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Where a working-tree change lives relative to the index.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeArea {
    Staged,
    Unstaged,
    Untracked,
}

/// A path changed in a commit (or the working tree).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    /// Git status letter: A, M, D, R, C, T, etc.
    pub status: String,
    pub path: String,
    /// Present for renames/copies (status R/C).
    pub old_path: Option<String>,
    /// Set for working-tree listings; omitted for historical commits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<ChangeArea>,
}

/// Synthetic id used by the UI for the dirty working-tree row.
pub const UNCOMMITTED_COMMIT_ID: &str = "__gitlibre_uncommitted__";

/// List files changed by `commit`, or working-tree paths when `commit` is
/// [`UNCOMMITTED_COMMIT_ID`].
pub async fn list_commit_files(repo_path: &Path, commit: &str) -> CoreResult<Vec<CommitFileChange>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    if commit == UNCOMMITTED_COMMIT_ID {
        let path = repo_path.to_path_buf();
        return blocking(move || list_working_tree_files(&path)).await;
    }
    if commit.is_empty() || commit.contains('\0') || commit.starts_with('-') {
        return Err(CoreError::new(
            crate::error::ErrorCode::Internal,
            "Invalid commit id",
        ));
    }
    let path = repo_path.to_path_buf();
    let commit = commit.to_string();
    blocking(move || list_commit_files_at(&path, &commit)).await
}

fn list_commit_files_at(repo_path: &Path, commit: &str) -> CoreResult<Vec<CommitFileChange>> {
    let repo = open_repo(repo_path)?;
    let commit = repo
        .revparse_single(commit)
        .map_err(map_git2)?
        .peel_to_commit()
        .map_err(map_git2)?;
    let diff = commit_diff(&repo, &commit, None)?;
    Ok(deltas_to_changes(&diff, None))
}

fn list_working_tree_files(repo_path: &Path) -> CoreResult<Vec<CommitFileChange>> {
    let repo = open_repo(repo_path)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(map_git2)?;
    let mut files = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        if path.is_empty() || path.ends_with('/') || path.ends_with('\\') {
            continue;
        }
        let status = entry.status();
        if status.is_wt_new() {
            files.push(change(&path, "?", None, Some(ChangeArea::Untracked)));
            continue;
        }
        if status.is_index_new()
            || status.is_index_modified()
            || status.is_index_deleted()
            || status.is_index_renamed()
            || status.is_index_typechange()
        {
            let (letter, old) = staged_change(entry);
            files.push(change(&path, &letter, old, Some(ChangeArea::Staged)));
        }
        if status.is_wt_modified()
            || status.is_wt_deleted()
            || status.is_wt_renamed()
            || status.is_wt_typechange()
            || status.is_conflicted()
        {
            let letter = if status.is_conflicted() {
                "U"
            } else if status.is_wt_deleted() {
                "D"
            } else if status.is_wt_renamed() {
                "R"
            } else if status.is_wt_typechange() {
                "T"
            } else {
                "M"
            };
            files.push(change(&path, letter, None, Some(ChangeArea::Unstaged)));
        }
    }
    Ok(files)
}

fn staged_change(entry: git2::StatusEntry<'_>) -> (String, Option<String>) {
    let status = entry.status();
    if status.is_index_renamed() {
        let old = entry
            .head_to_index()
            .and_then(|delta| delta.old_file().path())
            .map(|path| path.to_string_lossy().into_owned());
        return ("R".into(), old);
    }
    let letter = if status.is_index_new() {
        "A"
    } else if status.is_index_deleted() {
        "D"
    } else if status.is_index_typechange() {
        "T"
    } else {
        "M"
    };
    (letter.into(), None)
}

fn change(
    path: &str,
    status: &str,
    old_path: Option<String>,
    area: Option<ChangeArea>,
) -> CommitFileChange {
    CommitFileChange {
        status: status.to_string(),
        path: path.to_string(),
        old_path,
        area,
    }
}

/// Unified diff for a single path in `commit`, or the working tree when
/// `commit` is [`UNCOMMITTED_COMMIT_ID`].
pub async fn get_commit_file_diff(
    repo_path: &Path,
    commit: &str,
    path: &str,
) -> CoreResult<String> {
    get_commit_file_diff_with_old_path(repo_path, commit, path, None, None).await
}

pub async fn get_commit_file_diff_with_old_path(
    repo_path: &Path,
    commit: &str,
    path: &str,
    old_path: Option<&str>,
    area: Option<ChangeArea>,
) -> CoreResult<String> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    validate_path_arg(path)?;
    if let Some(old) = old_path {
        validate_path_arg(old)?;
    }
    let repo_path = repo_path.to_path_buf();
    let commit = commit.to_string();
    let path = path.to_string();
    let old_path = old_path.map(str::to_string);
    blocking(move || {
        diff_file(
            &repo_path,
            &commit,
            &path,
            old_path.as_deref(),
            area,
        )
    })
    .await
}

fn diff_file(
    repo_path: &Path,
    commit: &str,
    path: &str,
    old_path: Option<&str>,
    area: Option<ChangeArea>,
) -> CoreResult<String> {
    let repo = open_repo(repo_path)?;
    if commit == UNCOMMITTED_COMMIT_ID {
        return working_tree_diff(&repo, path, old_path, area);
    }
    let commit = repo
        .revparse_single(commit)
        .map_err(map_git2)?
        .peel_to_commit()
        .map_err(map_git2)?;
    let diff = commit_diff(&repo, &commit, Some((path, old_path)))?;
    diff_to_string(&diff)
}

fn working_tree_diff(
    repo: &git2::Repository,
    path: &str,
    old_path: Option<&str>,
    area: Option<ChangeArea>,
) -> CoreResult<String> {
    match area {
        Some(ChangeArea::Staged) => {
            let head = head_tree(repo)?;
            let diff = tree_to_index(repo, head.as_ref(), path, old_path)?;
            diff_to_string(&diff)
        }
        Some(ChangeArea::Unstaged) => {
            let diff = index_to_workdir(repo, path, old_path, false)?;
            diff_to_string(&diff)
        }
        Some(ChangeArea::Untracked) => {
            let diff = index_to_workdir(repo, path, old_path, true)?;
            diff_to_string(&diff)
        }
        None => {
            if let Some(head) = head_tree(repo)? {
                let diff = tree_to_workdir(repo, &head, path, old_path)?;
                let text = diff_to_string(&diff)?;
                if !text.trim().is_empty() {
                    return Ok(text);
                }
            }
            let staged = tree_to_index(repo, head_tree(repo)?.as_ref(), path, old_path)?;
            let text = diff_to_string(&staged)?;
            if !text.trim().is_empty() {
                return Ok(text);
            }
            let untracked = index_to_workdir(repo, path, old_path, true)?;
            diff_to_string(&untracked)
        }
    }
}

fn head_tree(repo: &git2::Repository) -> CoreResult<Option<git2::Tree<'_>>> {
    match repo.head() {
        Ok(head) => Ok(Some(head.peel_to_tree().map_err(map_git2)?)),
        Err(_) => Ok(None),
    }
}

fn commit_diff<'a>(
    repo: &'a git2::Repository,
    commit: &git2::Commit<'a>,
    pathspec: Option<(&str, Option<&str>)>,
) -> CoreResult<git2::Diff<'a>> {
    let new_tree = commit.tree().map_err(map_git2)?;
    let old_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
    let mut opts = git2::DiffOptions::new();
    if let Some((path, old)) = pathspec {
        opts.pathspec(path);
        if let Some(old) = old {
            if old != path {
                opts.pathspec(old);
            }
        }
    }
    let mut diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))
        .map_err(map_git2)?;
    diff.find_similar(None).map_err(map_git2)?;
    Ok(diff)
}

fn tree_to_index<'a>(
    repo: &'a git2::Repository,
    tree: Option<&git2::Tree<'a>>,
    path: &str,
    old_path: Option<&str>,
) -> CoreResult<git2::Diff<'a>> {
    let mut opts = path_opts(path, old_path);
    repo.diff_tree_to_index(tree, None, Some(&mut opts))
        .map_err(map_git2)
}

fn tree_to_workdir<'a>(
    repo: &'a git2::Repository,
    tree: &git2::Tree<'a>,
    path: &str,
    old_path: Option<&str>,
) -> CoreResult<git2::Diff<'a>> {
    let mut opts = path_opts(path, old_path);
    opts.include_untracked(true);
    repo.diff_tree_to_workdir(Some(tree), Some(&mut opts))
        .map_err(map_git2)
}

fn index_to_workdir<'a>(
    repo: &'a git2::Repository,
    path: &str,
    old_path: Option<&str>,
    untracked: bool,
) -> CoreResult<git2::Diff<'a>> {
    let mut opts = path_opts(path, old_path);
    if untracked {
        opts.include_untracked(true).show_untracked_content(true);
    }
    repo.diff_index_to_workdir(None, Some(&mut opts))
        .map_err(map_git2)
}

fn path_opts(path: &str, old_path: Option<&str>) -> git2::DiffOptions {
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(path);
    if let Some(old) = old_path {
        if old != path {
            opts.pathspec(old);
        }
    }
    opts
}

fn diff_to_string(diff: &git2::Diff<'_>) -> CoreResult<String> {
    let mut out = Vec::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' || origin == '\\' {
            out.push(origin as u8);
        }
        out.extend_from_slice(line.content());
        true
    })
    .map_err(map_git2)?;
    Ok(String::from_utf8_lossy(&out).into_owned())
}

fn deltas_to_changes(diff: &git2::Diff<'_>, area: Option<ChangeArea>) -> Vec<CommitFileChange> {
    let mut files = Vec::new();
    for delta in diff.deltas() {
        let status = delta_letter(delta.status());
        let new_path = delta
            .new_file()
            .path()
            .map(|path| path.to_string_lossy().into_owned())
            .filter(|path| !path.is_empty());
        let old_path = delta
            .old_file()
            .path()
            .map(|path| path.to_string_lossy().into_owned());
        let path = new_path.or_else(|| old_path.clone()).unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        let old = if matches!(delta.status(), git2::Delta::Renamed | git2::Delta::Copied) {
            old_path
        } else {
            None
        };
        files.push(change(&path, &status, old, area));
    }
    files
}

fn delta_letter(status: git2::Delta) -> String {
    match status {
        git2::Delta::Added => "A",
        git2::Delta::Deleted => "D",
        git2::Delta::Modified => "M",
        git2::Delta::Renamed => "R",
        git2::Delta::Copied => "C",
        git2::Delta::Typechange => "T",
        git2::Delta::Untracked => "?",
        git2::Delta::Conflicted => "U",
        _ => "M",
    }
    .to_string()
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

const MAX_FILE_PREVIEW_BYTES: usize = 25 * 1024 * 1024;

/// Before/after file bytes for image (or other binary) previews.
#[derive(Debug, Clone, Default)]
pub struct FileBytesPair {
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}

/// Load before and/or after bytes for `path` at `commit`.
pub async fn get_commit_file_bytes_pair(
    repo_path: &Path,
    commit: &str,
    path: &str,
    old_path: Option<&str>,
    area: Option<ChangeArea>,
    status: &str,
) -> CoreResult<FileBytesPair> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    validate_path_arg(path)?;
    if let Some(old) = old_path {
        validate_path_arg(old)?;
    }
    let repo_path = repo_path.to_path_buf();
    let commit = commit.to_string();
    let path = path.to_string();
    let old_path = old_path.map(str::to_string);
    let status = status.to_string();
    blocking(move || {
        bytes_pair(
            &repo_path,
            &commit,
            &path,
            old_path.as_deref(),
            area,
            &status,
        )
    })
    .await
}

fn bytes_pair(
    repo_path: &Path,
    commit: &str,
    path: &str,
    old_path: Option<&str>,
    area: Option<ChangeArea>,
    status: &str,
) -> CoreResult<FileBytesPair> {
    let repo = open_repo(repo_path)?;
    let status_letter = status
        .chars()
        .next()
        .map(|c| c.to_ascii_uppercase())
        .unwrap_or('M');
    let want_before = status_letter != 'A' && area != Some(ChangeArea::Untracked);
    let want_after = status_letter != 'D';
    let before_path = old_path.unwrap_or(path);
    let mut pair = FileBytesPair::default();
    if commit == UNCOMMITTED_COMMIT_ID {
        if want_before {
            pair.before = uncommitted_before(&repo, before_path, area);
        }
        if want_after {
            pair.after = uncommitted_after(&repo, repo_path, path, area);
        }
    } else {
        if want_before {
            pair.before = blob_at(&repo, &format!("{commit}^:{before_path}"));
        }
        if want_after {
            pair.after = blob_at(&repo, &format!("{commit}:{path}"));
        }
    }
    if pair.before.is_none() && pair.after.is_none() {
        return Err(CoreError::process_failed(
            "Could not load file contents for preview",
        ));
    }
    for side in [&pair.before, &pair.after].into_iter().flatten() {
        if side.len() > MAX_FILE_PREVIEW_BYTES {
            return Err(CoreError::new(
                crate::error::ErrorCode::Internal,
                format!("File is too large to preview ({} bytes)", side.len()),
            ));
        }
    }
    Ok(pair)
}

fn uncommitted_before(
    repo: &git2::Repository,
    path: &str,
    area: Option<ChangeArea>,
) -> Option<Vec<u8>> {
    match area {
        Some(ChangeArea::Unstaged) => blob_at(repo, &format!(":{path}"))
            .or_else(|| blob_at(repo, &format!("HEAD:{path}"))),
        Some(ChangeArea::Staged) | None => blob_at(repo, &format!("HEAD:{path}")),
        Some(ChangeArea::Untracked) => None,
    }
}

fn uncommitted_after(
    repo: &git2::Repository,
    repo_path: &Path,
    path: &str,
    area: Option<ChangeArea>,
) -> Option<Vec<u8>> {
    match area {
        Some(ChangeArea::Staged) => blob_at(repo, &format!(":{path}")).or_else(|| read_worktree(repo_path, path)),
        Some(ChangeArea::Unstaged) | Some(ChangeArea::Untracked) | None => {
            read_worktree(repo_path, path)
        }
    }
}

fn blob_at(repo: &git2::Repository, spec: &str) -> Option<Vec<u8>> {
    let object = repo.revparse_single(spec).ok()?;
    let blob = object.peel_to_blob().ok()?;
    Some(blob.content().to_vec())
}

fn read_worktree(repo_path: &Path, path: &str) -> Option<Vec<u8>> {
    let abs = crate::git::resolve_repo_path(repo_path, path).ok()?;
    std::fs::read(abs).ok()
}

#[cfg(test)]
fn parse_porcelain_v1_paths(text: &str) -> Vec<CommitFileChange> {
    let mut files = Vec::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let x = line.as_bytes()[0] as char;
        let y = line.as_bytes()[1] as char;
        let rest = line[3..].trim();
        if rest.is_empty() {
            continue;
        }
        let (path, old_path) = if let Some((old, new)) = rest.split_once(" -> ") {
            (
                unquote_porcelain_path(new),
                Some(unquote_porcelain_path(old)),
            )
        } else {
            (unquote_porcelain_path(rest), None)
        };
        if path.ends_with('/') || path.ends_with('\\') {
            continue;
        }
        if x == '?' && y == '?' {
            files.push(change(&path, "?", None, Some(ChangeArea::Untracked)));
            continue;
        }
        if x != ' ' && x != '?' {
            files.push(CommitFileChange {
                status: status_letter(x, old_path.is_some()),
                path: path.clone(),
                old_path: old_path.clone(),
                area: Some(ChangeArea::Staged),
            });
        }
        if y != ' ' && y != '?' {
            files.push(CommitFileChange {
                status: status_letter(y, old_path.is_some()),
                path,
                old_path,
                area: Some(ChangeArea::Unstaged),
            });
        }
    }
    files
}

#[cfg(test)]
fn unquote_porcelain_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        let inner = &trimmed[1..trimmed.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(ch) = chars.next() {
            if ch == '\\' {
                match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some('\\') => out.push('\\'),
                    Some('"') => out.push('"'),
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else {
                out.push(ch);
            }
        }
        out
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
fn status_letter(ch: char, is_rename_line: bool) -> String {
    if is_rename_line && (ch == 'R' || ch == 'C') {
        return ch.to_string();
    }
    match ch {
        'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' => ch.to_string(),
        _ => "M".to_string(),
    }
}

#[cfg(test)]
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
                area: None,
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
                area: None,
            });
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil;
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

    #[test]
    fn porcelain_skips_directory_only_entries() {
        let text = " M tracked.txt\n?? empty-looking/\n?? nested/file.txt\n";
        let files = parse_porcelain_v1_paths(text);
        assert!(files.iter().all(|f| !f.path.ends_with('/')));
        assert!(files.iter().any(|f| f.path == "tracked.txt"));
        assert!(files.iter().any(|f| f.path == "nested/file.txt"));
        assert!(!files.iter().any(|f| f.path == "empty-looking/"));
    }

    #[test]
    fn porcelain_skips_quoted_directory_entries_with_spaces() {
        let text = concat!(
            "?? \"test workspace/dir1/\"\n",
            "?? \"test workspace/dir2/\"\n",
            "?? \"test workspace/a file.txt\"\n",
        );
        let files = parse_porcelain_v1_paths(text);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "test workspace/a file.txt");
        assert!(files.iter().all(|f| !f.path.ends_with('/')));
        assert!(!files.iter().any(|f| f.path.contains('"')));
    }

    #[tokio::test]
    async fn list_files_from_temp_repo() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        let repo = testutil::init_repo(&repo_path);
        testutil::set_identity(&repo, "Dev", "dev@example.com");
        testutil::commit_file(&repo, "a.txt", "one\n", "first");
        std::fs::write(repo_path.join("a.txt"), "two\n").unwrap();
        std::fs::write(repo_path.join("b.txt"), "new\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.add_path(std::path::Path::new("b.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = git2::Signature::now("Dev", "dev@example.com").unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent])
            .unwrap();

        let files = list_commit_files(&repo_path, &oid.to_string()).await.unwrap();
        assert!(files.iter().any(|f| f.path == "a.txt" && f.status == "M"));
        assert!(files.iter().any(|f| f.path == "b.txt" && f.status == "A"));

        let diff = get_commit_file_diff(&repo_path, &oid.to_string(), "a.txt")
            .await
            .unwrap();
        assert!(diff.contains("-one") || diff.contains("-one\n"), "{diff}");
        assert!(diff.contains("+two") || diff.contains("+two\n"), "{diff}");
    }
}
