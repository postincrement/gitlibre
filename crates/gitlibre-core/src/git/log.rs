use crate::error::{CoreError, CoreResult};
use crate::git::executor::GitExecutor;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_COMMIT_PAGE_SIZE: u32 = 100;
const FIELD_SEP: char = '\u{1f}';
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

/// List commits reachable from all refs, newest first, for graph rendering.
///
/// `skip` offsets into the topo-ordered history (for infinite scroll).
pub async fn list_commits(
    executor: &GitExecutor,
    repo_path: &Path,
    limit: Option<u32>,
    skip: Option<u32>,
) -> CoreResult<Vec<CommitInfo>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }

    let limit = limit.unwrap_or(DEFAULT_COMMIT_PAGE_SIZE).clamp(1, 2000);
    let skip = skip.unwrap_or(0);
    let limit_arg = format!("-{limit}");
    let skip_arg = format!("--skip={skip}");
    // Record / field separators keep subjects and decorations parse-safe.
    // %D = decorations without wrapping parentheses.
    let pretty = format!(
        "%H{FIELD_SEP}%h{FIELD_SEP}%P{FIELD_SEP}%s{FIELD_SEP}%an{FIELD_SEP}%ae{FIELD_SEP}%aI{FIELD_SEP}%D{RECORD_SEP}"
    );

    let out = executor
        .run(
            repo_path,
            &[
                "log",
                "--all",
                "--topo-order",
                &skip_arg,
                &limit_arg,
                &format!("--pretty=format:{pretty}"),
            ],
        )
        .await?;

    if !out.success() {
        let stderr = out.stderr_lossy();
        // Empty repository (no commits yet).
        if stderr.contains("does not have any commits")
            || stderr.contains("bad default revision")
            || stderr.contains("unknown revision")
        {
            return Ok(Vec::new());
        }
        return Err(CoreError::process_failed(format!(
            "git log failed: {}",
            stderr.trim()
        )));
    }

    Ok(parse_commit_log(&out.stdout_lossy()))
}

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
    use crate::git::GitExecutor;
    use std::process::Command;
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
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]);
        git(&repo, &["config", "user.email", "dev@example.com"]);
        git(&repo, &["config", "user.name", "Dev"]);
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        git(&repo, &["add", "a.txt"]);
        git(&repo, &["commit", "-m", "first"]);
        git(&repo, &["branch", "feature"]);
        std::fs::write(repo.join("a.txt"), "two\n").unwrap();
        git(&repo, &["add", "a.txt"]);
        git(&repo, &["commit", "-m", "second on main"]);
        git(&repo, &["checkout", "feature"]);
        std::fs::write(repo.join("b.txt"), "feat\n").unwrap();
        git(&repo, &["add", "b.txt"]);
        git(&repo, &["commit", "-m", "work on feature"]);
        git(&repo, &["checkout", "main"]);

        let executor = GitExecutor::from_path().unwrap();
        let commits = list_commits(&executor, &repo, Some(50), None).await.unwrap();
        let page = list_commits(&executor, &repo, Some(2), Some(1)).await.unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].id, commits[1].id);
        assert!(commits.len() >= 3);
        assert!(commits.iter().any(|c| c.subject == "second on main"));
        assert!(commits.iter().any(|c| c.subject == "work on feature"));
        assert!(commits.iter().any(|c| c.refs.iter().any(|r| r == "main")));
        assert!(commits
            .iter()
            .any(|c| c.refs.iter().any(|r| r == "feature")));
        // Newest-first: tip of main or feature should lead.
        assert!(!commits[0].parents.is_empty() || commits.len() == 1);
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
