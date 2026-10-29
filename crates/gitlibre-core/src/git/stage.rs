use crate::error::{CoreError, CoreResult, ErrorCode};
use crate::git::executor::GitExecutor;
use crate::git::identity::CommitIdentity;
use crate::git::show::ChangeArea;
use std::path::Path;

/// Stage paths into the index (`git add -- …`).
pub async fn stage_paths(
    executor: &GitExecutor,
    repo_path: &Path,
    paths: &[String],
) -> CoreResult<()> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    run_checked(executor, repo_path, &args, "git add").await
}

/// Remove paths from the index, keeping the working tree (`git restore --staged`).
pub async fn unstage_paths(
    executor: &GitExecutor,
    repo_path: &Path,
    paths: &[String],
) -> CoreResult<()> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(paths);
    run_checked(executor, repo_path, &args, "git restore --staged").await
}

/// Discard local changes for paths in the given area.
///
/// - **Staged**: restore index + worktree to `HEAD`
/// - **Unstaged**: restore worktree to the index
/// - **Untracked**: delete via `git clean -f -d`
pub async fn discard_paths(
    executor: &GitExecutor,
    repo_path: &Path,
    paths: &[String],
    area: ChangeArea,
) -> CoreResult<()> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(paths)?;
    if paths.is_empty() {
        return Ok(());
    }

    match area {
        ChangeArea::Staged => {
            let mut args = vec![
                "restore".to_string(),
                "--source=HEAD".to_string(),
                "--staged".to_string(),
                "--worktree".to_string(),
                "--".to_string(),
            ];
            args.extend(paths);
            run_checked(executor, repo_path, &args, "git restore").await
        }
        ChangeArea::Unstaged => {
            let mut args = vec![
                "restore".to_string(),
                "--worktree".to_string(),
                "--".to_string(),
            ];
            args.extend(paths);
            run_checked(executor, repo_path, &args, "git restore").await
        }
        ChangeArea::Untracked => {
            let mut args = vec![
                "clean".to_string(),
                "-f".to_string(),
                "-d".to_string(),
                "--".to_string(),
            ];
            args.extend(paths);
            run_checked(executor, repo_path, &args, "git clean").await
        }
    }
}

/// Delete paths from the working tree and index.
///
/// - **Tracked / staged**: `git rm -f -- …`
/// - **Untracked**: delete via `git clean -f -d -- …`
pub async fn remove_paths(
    executor: &GitExecutor,
    repo_path: &Path,
    paths: &[String],
    area: ChangeArea,
) -> CoreResult<()> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(paths)?;
    if paths.is_empty() {
        return Ok(());
    }

    match area {
        ChangeArea::Untracked => {
            let mut args = vec![
                "clean".to_string(),
                "-f".to_string(),
                "-d".to_string(),
                "--".to_string(),
            ];
            args.extend(paths);
            run_checked(executor, repo_path, &args, "git clean").await
        }
        ChangeArea::Staged | ChangeArea::Unstaged => {
            let mut args = vec!["rm".to_string(), "-f".to_string(), "--".to_string()];
            args.extend(paths);
            run_checked(executor, repo_path, &args, "git rm").await
        }
    }
}

/// Stop tracking paths while keeping the working-tree files (`git rm --cached`).
pub async fn stop_tracking_paths(
    executor: &GitExecutor,
    repo_path: &Path,
    paths: &[String],
) -> CoreResult<()> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec![
        "rm".to_string(),
        "--cached".to_string(),
        "-f".to_string(),
        "--".to_string(),
    ];
    args.extend(paths);
    run_checked(executor, repo_path, &args, "git rm --cached").await
}

/// Resolve a repo-relative path to an absolute path under `repo_path`.
pub fn resolve_repo_path(repo_path: &Path, relative: &str) -> CoreResult<std::path::PathBuf> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(&[relative.to_string()])?;
    let rel = paths.into_iter().next().ok_or_else(|| {
        CoreError::new(ErrorCode::Internal, "Path must not be empty.")
    })?;
    let joined = repo_path.join(&rel);
    Ok(joined)
}

/// Create a commit from the current index.
///
/// When `identity` has name/email, they are applied via `-c user.*` for this
/// invocation only (does not rewrite repo/global config).
pub async fn commit_index(
    executor: &GitExecutor,
    repo_path: &Path,
    message: &str,
    amend: bool,
    identity: Option<&CommitIdentity>,
) -> CoreResult<String> {
    validate_repo(repo_path)?;
    let message = message.trim();
    if message.is_empty() && !amend {
        return Err(CoreError::new(
            ErrorCode::ProcessFailed,
            "Commit message must not be empty.",
        ));
    }

    if !amend {
        let staged = executor
            .run(repo_path, &["diff", "--cached", "--quiet"])
            .await?;
        // Exit 0 = no staged diff; 1 = staged changes present.
        if staged.success() {
            return Err(CoreError::new(
                ErrorCode::ProcessFailed,
                "Nothing staged to commit.",
            ));
        }
    }

    let mut args: Vec<String> = Vec::new();
    if let Some(identity) = identity {
        if let Some(name) = identity.name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            args.push("-c".into());
            args.push(format!("user.name={name}"));
        }
        if let Some(email) = identity
            .email
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            args.push("-c".into());
            args.push(format!("user.email={email}"));
        }
    }
    args.push("commit".into());
    if amend {
        args.push("--amend".into());
    }
    if message.is_empty() {
        // Amend only: keep the previous subject/body.
        args.push("--no-edit".into());
    } else {
        args.push("-m".into());
        args.push(message.to_string());
    }

    run_checked(executor, repo_path, &args, "git commit").await?;

    let head = executor.run(repo_path, &["rev-parse", "HEAD"]).await?;
    if !head.success() {
        return Err(CoreError::process_failed(format!(
            "git rev-parse HEAD failed: {}",
            head.stderr_lossy().trim()
        )));
    }
    Ok(head.stdout_lossy().trim().to_string())
}

fn validate_repo(repo_path: &Path) -> CoreResult<()> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }
    Ok(())
}

fn normalize_paths(paths: &[String]) -> CoreResult<Vec<String>> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() || trimmed.contains('\0') || trimmed.starts_with('-') {
            return Err(CoreError::new(
                ErrorCode::Internal,
                format!("Invalid path: {path}"),
            ));
        }
        let p = Path::new(trimmed);
        if p.is_absolute()
            || p.components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(CoreError::new(
                ErrorCode::Internal,
                format!("Invalid path: {path}"),
            ));
        }
        out.push(trimmed.to_string());
    }
    Ok(out)
}

async fn run_checked(
    executor: &GitExecutor,
    repo_path: &Path,
    args: &[String],
    label: &str,
) -> CoreResult<()> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = executor.run(repo_path, &refs).await?;
    if !out.success() {
        let detail = out.stderr_lossy();
        let detail = if detail.trim().is_empty() {
            out.stdout_lossy()
        } else {
            detail
        };
        return Err(CoreError::process_failed(format!(
            "{label} failed: {}",
            detail.trim()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::show::{list_commit_files, ChangeArea, UNCOMMITTED_COMMIT_ID};
    use crate::git::GitExecutor;
    use std::process::Command;
    use tempfile::tempdir;

    #[tokio::test]
    async fn stage_unstage_commit_discard() {
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

        let executor = GitExecutor::from_path().unwrap();
        let files = list_commit_files(&executor, &repo, UNCOMMITTED_COMMIT_ID)
            .await
            .unwrap();
        assert!(files.iter().any(|f| f.area == Some(ChangeArea::Unstaged)));
        assert!(files.iter().any(|f| f.area == Some(ChangeArea::Untracked)));

        stage_paths(
            &executor,
            &repo,
            &["a.txt".into(), "b.txt".into()],
        )
        .await
        .unwrap();

        let staged = list_commit_files(&executor, &repo, UNCOMMITTED_COMMIT_ID)
            .await
            .unwrap();
        assert!(staged
            .iter()
            .filter(|f| f.area == Some(ChangeArea::Staged))
            .count()
            >= 2);

        unstage_paths(&executor, &repo, &["b.txt".into()])
            .await
            .unwrap();

        let identity = CommitIdentity {
            name: Some("Scry".into()),
            email: Some("scry@example.com".into()),
            is_local: false,
        };
        let oid = commit_index(&executor, &repo, "update a", false, Some(&identity))
            .await
            .unwrap();
        assert_eq!(oid.len(), 40);

        let show = executor
            .run(&repo, &["log", "-1", "--format=%an <%ae>%n%s"])
            .await
            .unwrap()
            .stdout_lossy();
        assert!(show.contains("Scry <scry@example.com>"));
        assert!(show.contains("update a"));

        std::fs::write(repo.join("c.txt"), "temp\n").unwrap();
        discard_paths(&executor, &repo, &["c.txt".into()], ChangeArea::Untracked)
            .await
            .unwrap();
        assert!(!repo.join("c.txt").exists());

        std::fs::write(repo.join("d.txt"), "keep\n").unwrap();
        stage_paths(&executor, &repo, &["d.txt".into()])
            .await
            .unwrap();
        commit_index(&executor, &repo, "add d", false, None)
            .await
            .unwrap();

        stop_tracking_paths(&executor, &repo, &["d.txt".into()])
            .await
            .unwrap();
        assert!(repo.join("d.txt").exists());

        std::fs::write(repo.join("e.txt"), "gone\n").unwrap();
        stage_paths(&executor, &repo, &["e.txt".into()])
            .await
            .unwrap();
        commit_index(&executor, &repo, "add e", false, None)
            .await
            .unwrap();
        remove_paths(&executor, &repo, &["e.txt".into()], ChangeArea::Unstaged)
            .await
            .unwrap();
        assert!(!repo.join("e.txt").exists());
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
