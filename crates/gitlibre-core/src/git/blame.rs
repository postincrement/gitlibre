use crate::error::{CoreError, CoreResult};
use crate::git::session::{blocking, map_git2, open_repo};
use crate::git::UNCOMMITTED_COMMIT_ID;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One line of `git blame` output for annotate views.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub commit_id: String,
    pub short_id: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub line_number: u32,
    pub content: String,
}

/// Blame `path` at `commit` (working tree when uncommitted / omitted).
///
/// For deleted paths, pass a revision where the file still exists (e.g. parent).
pub async fn blame_file(
    repo_path: &Path,
    path: &str,
    commit: Option<&str>,
) -> CoreResult<Vec<BlameLine>> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    if path.is_empty() || path.contains('\0') || path.starts_with('-') {
        return Err(CoreError::new(
            crate::error::ErrorCode::Internal,
            "Invalid path",
        ));
    }
    let rev = commit
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != UNCOMMITTED_COMMIT_ID)
        .map(str::to_string);
    if let Some(rev) = &rev {
        if rev.contains('\0') || rev.starts_with('-') {
            return Err(CoreError::new(
                crate::error::ErrorCode::Internal,
                "Invalid commit id",
            ));
        }
    }
    let repo_path = repo_path.to_path_buf();
    let path = path.to_string();
    blocking(move || blame_file_at(&repo_path, &path, rev.as_deref())).await
}

fn blame_file_at(repo_path: &Path, path: &str, rev: Option<&str>) -> CoreResult<Vec<BlameLine>> {
    let repo = open_repo(repo_path)?;
    let mut opts = git2::BlameOptions::new();
    if let Some(rev) = rev {
        let oid = repo
            .revparse_single(rev)
            .map_err(map_git2)?
            .peel_to_commit()
            .map_err(map_git2)?
            .id();
        opts.newest_commit(oid);
    }
    let blame = repo
        .blame_file(Path::new(path), Some(&mut opts))
        .map_err(map_git2)?;
    let text = blame_text(&repo, path, rev)?;
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    for hunk in blame.iter() {
        let Some(sig) = hunk.final_signature() else {
            continue;
        };
        let commit_id = hunk.final_commit_id().to_string();
        for offset in 0..hunk.lines_in_hunk() {
            let line_number = (hunk.final_start_line() + offset) as u32;
            let content = lines
                .get((line_number.saturating_sub(1)) as usize)
                .copied()
                .unwrap_or("")
                .to_string();
            out.push(BlameLine {
                short_id: commit_id.chars().take(7).collect(),
                author_name: sig.name().unwrap_or("").to_string(),
                author_email: sig.email().unwrap_or("").to_string(),
                authored_at: format_blame_time(&sig.when()),
                line_number,
                content,
                commit_id: commit_id.clone(),
            });
        }
    }
    Ok(out)
}

fn blame_text(repo: &git2::Repository, path: &str, rev: Option<&str>) -> CoreResult<String> {
    if let Some(rev) = rev {
        let spec = format!("{rev}:{path}");
        let blob = repo
            .revparse_single(&spec)
            .map_err(map_git2)?
            .peel_to_blob()
            .map_err(map_git2)?;
        return Ok(String::from_utf8_lossy(blob.content()).into_owned());
    }
    let workdir = repo
        .workdir()
        .ok_or_else(|| CoreError::process_failed("Repository has no working tree."))?;
    let abs = workdir.join(path);
    std::fs::read_to_string(&abs).map_err(|err| {
        CoreError::process_failed(format!("Failed to read {}: {err}", abs.display()))
    })
}

fn format_blame_time(time: &git2::Time) -> String {
    if time.seconds() <= 0 {
        return String::new();
    }
    let offset = time.offset_minutes();
    let local = time.seconds() + i64::from(offset) * 60;
    let days = local.div_euclid(86_400);
    let tod = local.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    let sign = if offset >= 0 { '+' } else { '-' };
    let abs = offset.abs();
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}{sign}{:02}{:02}",
        abs / 60,
        abs % 60
    )
}

#[cfg(test)]
fn parse_blame_porcelain(text: &str) -> Vec<BlameLine> {
    let mut lines = Vec::new();
    let mut commit_id = String::new();
    let mut author_name = String::new();
    let mut author_email = String::new();
    let mut author_time: i64 = 0;
    let mut author_tz = String::new();
    let mut result_line: u32 = 0;
    // Metadata for a commit hash is only emitted once; reuse across hunk lines.
    let mut meta_by_commit: std::collections::HashMap<String, (String, String, i64, String)> =
        std::collections::HashMap::new();

    for raw in text.lines() {
        if let Some(content) = raw.strip_prefix('\t') {
            let (name, email, time, tz) = meta_by_commit
                .get(&commit_id)
                .cloned()
                .unwrap_or_else(|| {
                    (
                        author_name.clone(),
                        author_email.clone(),
                        author_time,
                        author_tz.clone(),
                    )
                });
            lines.push(BlameLine {
                commit_id: commit_id.clone(),
                short_id: short_hash(&commit_id),
                author_name: name,
                author_email: email,
                authored_at: format_author_time(time, &tz),
                line_number: result_line,
                content: content.to_string(),
            });
            continue;
        }

        if raw.is_empty() {
            continue;
        }

        // Header: <40-char-hash> <sourceline> <resultline> [<num>]
        let mut parts = raw.split_whitespace();
        let maybe_hash = parts.next().unwrap_or("");
        if maybe_hash.len() >= 40
            && maybe_hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            commit_id = maybe_hash.to_string();
            let _source = parts.next();
            result_line = parts
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(result_line.saturating_add(1));
            continue;
        }

        if let Some(rest) = raw.strip_prefix("author ") {
            author_name = rest.to_string();
        } else if let Some(rest) = raw.strip_prefix("author-mail ") {
            author_email = rest
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
        } else if let Some(rest) = raw.strip_prefix("author-time ") {
            author_time = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = raw.strip_prefix("author-tz ") {
            author_tz = rest.trim().to_string();
            meta_by_commit.insert(
                commit_id.clone(),
                (
                    author_name.clone(),
                    author_email.clone(),
                    author_time,
                    author_tz.clone(),
                ),
            );
        }
    }

    lines
}

#[cfg(test)]
fn short_hash(id: &str) -> String {
    id.chars().take(7).collect()
}

#[cfg(test)]
fn format_author_time(unix: i64, tz: &str) -> String {
    if unix <= 0 {
        return String::new();
    }
    // Prefer ISO-like display; keep raw epoch+tz if chrono unavailable.
    // Format as RFC3339-ish via UTC then append tz label when present.
    let secs = unix;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    if tz.is_empty() {
        format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
    } else {
        format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}{tz}")
    }
}

/// Howard Hinnant civil_from_days (UTC), `z` = days since 1970-01-01 → Y-M-D.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_blame() {
        let text = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Ada
author-mail <ada@example.com>
author-time 1700000000
author-tz +0000
committer Ada
committer-mail <ada@example.com>
committer-time 1700000000
committer-tz +0000
summary first
filename a.txt
\tline one
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2
\tline two
";
        let lines = parse_blame_porcelain(text);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].content, "line one");
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author_name, "Ada");
        assert_eq!(lines[0].short_id, "aaaaaaa");
        assert_eq!(lines[1].content, "line two");
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].author_name, "Ada");
    }
}
