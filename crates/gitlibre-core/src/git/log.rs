use crate::error::{CoreError, CoreResult};
use crate::git::session::{blocking, map_git2, open_repo};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub const DEFAULT_COMMIT_PAGE_SIZE: u32 = 100;
const FIELD_SEP: char = '\u{1f}';
#[allow(dead_code)]
const RECORD_SEP: char = '\u{1e}';

/// A commit for graph / history display.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    /// Decorations such as `main`, `origin/main`, `tag: v1.0`, `HEAD`.
    pub refs: Vec<String>,
}

/// List commits reachable from every ref, newest first, for graph rendering.
///
/// Tag badges are kept only when the tagged commit is also reachable from a
/// branch. Other tags stay in the graph without a badge, so release history
/// that is not on a branch tip still connects.
/// `skip` offsets into the topo-ordered history (for infinite scroll).
pub async fn list_commits(
    repo_path: &Path,
    limit: Option<u32>,
    skip: Option<u32>,
) -> CoreResult<Vec<CommitInfo>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    let path = repo_path.to_path_buf();
    let limit = limit.unwrap_or(DEFAULT_COMMIT_PAGE_SIZE).clamp(1, 2000);
    let skip = skip.unwrap_or(0);
    blocking(move || list_commits_at(&path, limit, skip)).await
}

fn list_commits_at(repo_path: &Path, limit: u32, skip: u32) -> CoreResult<Vec<CommitInfo>> {
    let repo = open_repo(repo_path)?;
    let decorations = load_decorations(&repo)?;
    let mut walk = repo.revwalk().map_err(map_git2)?;
    // Time within topo order so the current branch tip comes before ancient tag tips.
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(map_git2)?;
    if let Err(err) = walk.push_glob("refs/*") {
        if err.code() == git2::ErrorCode::NotFound {
            return Ok(Vec::new());
        }
        return Err(map_git2(err));
    }
    let mut commits = Vec::new();
    for (index, oid) in walk.enumerate() {
        if index < skip as usize {
            continue;
        }
        if commits.len() >= limit as usize {
            break;
        }
        let oid = oid.map_err(map_git2)?;
        let commit = repo.find_commit(oid).map_err(map_git2)?;
        commits.push(commit_to_info(&commit, decorations.get(&oid)));
    }
    Ok(commits)
}

/// List commits that touched `path`, newest first (`git log --follow`).
///
/// When `start_commit` is set (and not the uncommitted sentinel), history is
/// limited to that revision and its ancestors.
pub async fn list_file_commits(
    repo_path: &Path,
    path: &str,
    start_commit: Option<&str>,
    limit: Option<u32>,
) -> CoreResult<Vec<CommitInfo>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    if path.is_empty() || path.contains('\0') || path.starts_with('-') {
        return Err(CoreError::new(
            crate::error::ErrorCode::Internal,
            "Invalid path",
        ));
    }
    let start = start_commit
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != super::show::UNCOMMITTED_COMMIT_ID)
        .map(str::to_string);
    if let Some(rev) = &start {
        if rev.contains('\0') || rev.starts_with('-') {
            return Err(CoreError::new(
                crate::error::ErrorCode::Internal,
                "Invalid commit id",
            ));
        }
    }
    let repo_path = repo_path.to_path_buf();
    let path = path.to_string();
    let limit = limit.unwrap_or(DEFAULT_COMMIT_PAGE_SIZE).clamp(1, 2000);
    blocking(move || list_file_commits_at(&repo_path, &path, start.as_deref(), limit)).await
}

fn list_file_commits_at(
    repo_path: &Path,
    path: &str,
    start: Option<&str>,
    limit: u32,
) -> CoreResult<Vec<CommitInfo>> {
    let repo = open_repo(repo_path)?;
    let decorations = load_decorations(&repo)?;
    let mut rev = match start {
        Some(spec) => match repo.revparse_single(spec) {
            Ok(obj) => obj.peel_to_commit().map_err(map_git2)?.id(),
            Err(_) => return Ok(Vec::new()),
        },
        None => match repo.head() {
            Ok(head) => match head.peel_to_commit() {
                Ok(commit) => commit.id(),
                Err(_) => return Ok(Vec::new()),
            },
            Err(_) => return Ok(Vec::new()),
        },
    };
    let mut follow = path.to_string();
    let mut commits = Vec::new();
    let mut seen = std::collections::HashSet::new();
    while commits.len() < limit as usize {
        if !seen.insert(rev) {
            break;
        }
        let commit = match repo.find_commit(rev) {
            Ok(commit) => commit,
            Err(_) => break,
        };
        if let Some(old_path) = path_changed_in(&repo, &commit, &follow)? {
            commits.push(commit_to_info(&commit, decorations.get(&rev)));
            if let Some(old) = old_path {
                follow = old;
            }
        }
        rev = match commit.parent_id(0) {
            Ok(id) => id,
            Err(_) => break,
        };
    }
    Ok(commits)
}

fn path_changed_in(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    path: &str,
) -> CoreResult<Option<Option<String>>> {
    let new_tree = commit.tree().map_err(map_git2)?;
    let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(path);
    let mut diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))
        .map_err(map_git2)?;
    diff.find_similar(None).map_err(map_git2)?;
    for delta in diff.deltas() {
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        if new_path.as_deref() == Some(path) || old_path.as_deref() == Some(path) {
            let renamed_from = if delta.status() == git2::Delta::Renamed {
                old_path.filter(|old| old != path)
            } else {
                None
            };
            return Ok(Some(renamed_from));
        }
    }
    Ok(None)
}

/// Branch tips, plus HEAD when it is detached and not already a branch tip.
fn push_branch_roots(repo: &git2::Repository, walk: &mut git2::Revwalk<'_>) -> CoreResult<bool> {
    let mut found = false;
    for glob in ["refs/heads/*", "refs/remotes/*"] {
        match walk.push_glob(glob) {
            Ok(()) => found = true,
            Err(err) if err.code() == git2::ErrorCode::NotFound => {}
            Err(err) => return Err(map_git2(err)),
        }
    }
    if let Ok(commit) = repo.head().and_then(|head| head.peel_to_commit()) {
        walk.push(commit.id()).map_err(map_git2)?;
        found = true;
    }
    Ok(found)
}

fn commits_on_branches(repo: &git2::Repository) -> CoreResult<HashSet<git2::Oid>> {
    let mut walk = repo.revwalk().map_err(map_git2)?;
    if !push_branch_roots(repo, &mut walk)? {
        return Ok(HashSet::new());
    }
    let mut ids = HashSet::new();
    for oid in walk {
        ids.insert(oid.map_err(map_git2)?);
    }
    Ok(ids)
}

fn load_decorations(repo: &git2::Repository) -> CoreResult<HashMap<git2::Oid, Vec<String>>> {
    let on_branch = commits_on_branches(repo)?;
    let mut map: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    if let Ok(head) = repo.head() {
        if let Ok(commit) = head.peel_to_commit() {
            let entry = map.entry(commit.id()).or_default();
            entry.push("HEAD".into());
            if head.is_branch() {
        if let Ok(name) = head.shorthand() {
            push_unique(entry, name);
        }
            }
        }
    }
    let refs = repo.references().map_err(map_git2)?;
    for reference in refs.flatten() {
        let Ok(name) = reference.name() else {
            continue;
        };
        if name == "HEAD" {
            continue;
        }
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        let label = if let Some(branch) = name.strip_prefix("refs/heads/") {
            branch.to_string()
        } else if let Some(remote) = name.strip_prefix("refs/remotes/") {
            if remote.ends_with("/HEAD") {
                continue;
            }
            remote.to_string()
        } else if let Some(tag) = name.strip_prefix("refs/tags/") {
            if !on_branch.contains(&commit.id()) {
                continue;
            }
            format!("tag: {tag}")
        } else {
            continue;
        };
        push_unique(map.entry(commit.id()).or_default(), label);
    }
    Ok(map)
}

fn push_unique(list: &mut Vec<String>, label: impl Into<String>) {
    let label = label.into();
    if !list.iter().any(|existing| existing == &label) {
        list.push(label);
    }
}

fn commit_to_info(commit: &git2::Commit<'_>, refs: Option<&Vec<String>>) -> CommitInfo {
    let id = commit.id().to_string();
    let author = commit.author();
    CommitInfo {
        short_id: id.chars().take(7).collect(),
        parents: commit.parent_ids().map(|oid| oid.to_string()).collect(),
        subject: commit.summary().ok().flatten().unwrap_or("").to_string(),
        author_name: author.name().unwrap_or("").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        authored_at: format_signature_time(&author.when()),
        refs: refs.cloned().unwrap_or_default(),
        id,
    }
}

fn format_signature_time(time: &git2::Time) -> String {
    let offset_minutes = time.offset_minutes();
    let local = time.seconds() + i64::from(offset_minutes) * 60;
    let days = local.div_euclid(86_400);
    let tod = local.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    let sign = if offset_minutes >= 0 { '+' } else { '-' };
    let abs = offset_minutes.abs();
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}{sign}{:02}{:02}",
        abs / 60,
        abs % 60
    )
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[allow(dead_code)]
fn parse_commit_log(text: &str) -> Vec<CommitInfo> {
    text.split(RECORD_SEP)
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .filter_map(parse_commit_record)
        .collect()
}

fn parse_commit_record(record: &str) -> Option<CommitInfo> {
    let mut fields = record.split(FIELD_SEP);
    let id = fields.next()?.trim();
    if id.is_empty() {
        return None;
    }
    let short_id = fields.next()?.trim().to_string();
    let parents_raw = fields.next()?.trim();
    let subject = fields.next()?.to_string();
    let author_name = fields.next()?.to_string();
    let author_email = fields.next()?.trim().to_string();
    let authored_at = fields.next()?.trim().to_string();
    let refs_raw = fields.next().unwrap_or("").trim();

    let parents = if parents_raw.is_empty() {
        Vec::new()
    } else {
        parents_raw
            .split_whitespace()
            .map(str::to_string)
            .collect()
    };

    Some(CommitInfo {
        id: id.to_string(),
        short_id,
        parents,
        subject,
        author_name,
        author_email,
        authored_at,
        refs: parse_decorations(refs_raw),
    })
}

fn parse_decorations(raw: &str) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .flat_map(|part| {
            if let Some(rest) = part.strip_prefix("HEAD -> ") {
                // Keep both HEAD and the pointed-to name for UI chips.
                return vec!["HEAD".to_string(), shorten_ref(rest)];
            }
            if part == "HEAD" {
                return vec!["HEAD".to_string()];
            }
            if let Some(tag) = part.strip_prefix("tag: ") {
                return vec![format!("tag: {}", shorten_ref(tag))];
            }
            vec![shorten_ref(part)]
        })
        .collect()
}

fn shorten_ref(name: &str) -> String {
    name.strip_prefix("refs/heads/")
        .or_else(|| name.strip_prefix("refs/remotes/"))
        .or_else(|| name.strip_prefix("refs/tags/"))
        .unwrap_or(name)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil;
    use tempfile::tempdir;

    #[test]
    fn parse_simple_record() {
        let record = format!(
            "abc123{FIELD_SEP}abc{FIELD_SEP}def456{FIELD_SEP}Fix bug{FIELD_SEP}Ada{FIELD_SEP}ada@example.com{FIELD_SEP}2024-01-02T03:04:05Z{FIELD_SEP}HEAD -> main, origin/main"
        );
        let commit = parse_commit_record(&record).expect("parse");
        assert_eq!(commit.id, "abc123");
        assert_eq!(commit.short_id, "abc");
        assert_eq!(commit.parents, vec!["def456"]);
        assert_eq!(commit.subject, "Fix bug");
        assert_eq!(commit.author_name, "Ada");
        assert_eq!(commit.author_email, "ada@example.com");
        assert_eq!(commit.refs, vec!["HEAD", "main", "origin/main"]);
    }

    #[test]
    fn parse_root_commit_and_tag() {
        let record = format!(
            "root{FIELD_SEP}root{FIELD_SEP}{FIELD_SEP}init{FIELD_SEP}Ada{FIELD_SEP}ada@example.com{FIELD_SEP}2024-01-01T00:00:00Z{FIELD_SEP}tag: v1.0"
        );
        let commit = parse_commit_record(&record).expect("parse");
        assert!(commit.parents.is_empty());
        assert_eq!(commit.refs, vec!["tag: v1.0"]);
    }

    #[tokio::test]
    async fn list_commits_from_temp_repo() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        let repo = testutil::init_repo(&repo_path);
        testutil::set_identity(&repo, "Dev", "dev@example.com");
        testutil::commit_file(&repo, "a.txt", "one\n", "first");
        let first = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &first, false).unwrap();
        testutil::commit_file(&repo, "a.txt", "two\n", "second on main");
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        testutil::commit_file(&repo, "b.txt", "feat\n", "work on feature");
        repo.set_head("refs/heads/main").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();

        let commits = list_commits(&repo_path, Some(50), None).await.unwrap();
        let page = list_commits(&repo_path, Some(2), Some(1)).await.unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].id, commits[1].id);
        assert!(commits.len() >= 3);
        assert!(commits.iter().any(|c| c.subject == "second on main"));
        assert!(commits.iter().any(|c| c.subject == "work on feature"));
        assert!(commits.iter().any(|c| c.refs.iter().any(|r| r == "main")));
        assert!(commits
            .iter()
            .any(|c| c.refs.iter().any(|r| r == "feature")));
        assert!(!commits[0].parents.is_empty() || commits.len() == 1);
    }

    #[tokio::test]
    async fn history_keeps_tag_only_commits_without_their_badges() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        let repo = testutil::init_repo(&repo_path);
        let on_branch = testutil::commit_file(&repo, "a.txt", "1\n", "on branch");
        let tag_only = testutil::commit_file(&repo, "b.txt", "2\n", "tag only");
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let on_branch_commit = repo.find_commit(on_branch).unwrap();
        let tag_only_commit = repo.find_commit(tag_only).unwrap();
        repo.tag(
            "v-on-branch",
            on_branch_commit.as_object(),
            &sig,
            "on branch",
            false,
        )
        .unwrap();
        repo.tag("v-only", tag_only_commit.as_object(), &sig, "only tag", false)
            .unwrap();
        repo.reset(on_branch_commit.as_object(), git2::ResetType::Hard, None)
            .unwrap();

        let commits = list_commits(&repo_path, Some(50), None).await.unwrap();
        assert!(commits.iter().any(|c| c.id == on_branch.to_string()));
        assert!(commits.iter().any(|c| c.id == tag_only.to_string()));
        assert!(commits
            .iter()
            .any(|c| c.refs.iter().any(|r| r == "tag: v-on-branch")));
        assert!(commits
            .iter()
            .all(|c| c.refs.iter().all(|r| r != "tag: v-only")));
    }
}
