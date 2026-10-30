use crate::error::{CoreError, CoreResult, ErrorCode};
use crate::git::identity::{CommitIdentity, commit_signature};
use crate::git::session::{blocking, map_git2, open_repo};
use crate::git::show::ChangeArea;
use std::path::Path;

/// Stage paths into the index.
pub async fn stage_paths(repo_path: &Path, paths: &[String]) -> CoreResult<()> {
    let paths = prepare_paths(repo_path, paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let repo_path = repo_path.to_path_buf();
    blocking(move || {
        let repo = open_repo(&repo_path)?;
        let mut index = repo.index().map_err(map_git2)?;
        for path in &paths {
            stage_one(&mut index, &repo_path, path)?;
        }
        index.write().map_err(map_git2)?;
        Ok(())
    })
    .await
}

/// Stage one work-tree path the way `git add` does.
///
/// `Index::add_path` only updates a file that is still on disk. A missing
/// tracked path is a deletion, and a directory that contains its own `.git`
/// is a nested repository (a gitlink), not a file to hash.
fn stage_one(index: &mut git2::Index, repo_path: &Path, rel: &str) -> CoreResult<()> {
    let abs = repo_path.join(rel);
    if abs.is_dir() {
        if abs.join(".git").exists() {
            stage_gitlink(index, &abs, rel)?;
        } else {
            index
                .add_all([rel], git2::IndexAddOption::DEFAULT, None)
                .map_err(|err| stage_error(rel, err))?;
        }
        return Ok(());
    }
    if !abs.exists() {
        return index.remove_path(Path::new(rel)).map_err(|err| {
            if err.code() == git2::ErrorCode::NotFound {
                CoreError::new(
                    ErrorCode::PathNotFound,
                    format!("Cannot stage {rel}: the path is not in the work tree or the index."),
                )
            } else {
                stage_error(rel, err)
            }
        });
    }
    index
        .add_path(Path::new(rel))
        .map_err(|err| stage_error(rel, err))
}

fn stage_gitlink(index: &mut git2::Index, abs: &Path, rel: &str) -> CoreResult<()> {
    let nested = git2::Repository::open(abs).map_err(|err| stage_error(rel, err))?;
    let oid = match nested.head() {
        Ok(head) => head
            .peel_to_commit()
            .map_err(|err| stage_error(rel, err))?
            .id(),
        Err(err) if err.code() == git2::ErrorCode::UnbornBranch => {
            return Err(CoreError::new(
                ErrorCode::ProcessFailed,
                format!("Cannot stage {rel}: the nested repository has no commits."),
            ));
        }
        Err(err) => return Err(stage_error(rel, err)),
    };
    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: u32::from(git2::FileMode::Commit),
        uid: 0,
        gid: 0,
        file_size: 0,
        id: oid,
        flags: 0,
        flags_extended: 0,
        path: rel.replace('\\', "/").into_bytes(),
    };
    index.add(&entry).map_err(|err| stage_error(rel, err))
}

fn stage_error(rel: &str, err: git2::Error) -> CoreError {
    let mapped = map_git2(err);
    CoreError::new(
        mapped.code,
        format!("Cannot stage {rel}: {}", mapped.message),
    )
}

/// Remove paths from the index, keeping the working tree.
pub async fn unstage_paths(repo_path: &Path, paths: &[String]) -> CoreResult<()> {
    let paths = prepare_paths(repo_path, paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let repo_path = repo_path.to_path_buf();
    blocking(move || {
        let repo = open_repo(&repo_path)?;
        match repo.head() {
            Ok(head) => {
                let object = head.peel(git2::ObjectType::Commit).map_err(map_git2)?;
                let specs: Vec<&str> = paths.iter().map(String::as_str).collect();
                repo.reset_default(Some(&object), specs.as_slice())
                    .map_err(map_git2)?;
            }
            Err(_) => {
                let mut index = repo.index().map_err(map_git2)?;
                for path in &paths {
                    index.remove_path(Path::new(path)).map_err(map_git2)?;
                }
                index.write().map_err(map_git2)?;
            }
        }
        Ok(())
    })
    .await
}

/// Discard local changes for paths in the given area.
pub async fn discard_paths(repo_path: &Path, paths: &[String], area: ChangeArea) -> CoreResult<()> {
    let paths = prepare_paths(repo_path, paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let repo_path = repo_path.to_path_buf();
    blocking(move || {
        let repo = open_repo(&repo_path)?;
        match area {
            ChangeArea::Staged => restore_from_head(&repo, &repo_path, &paths),
            ChangeArea::Unstaged => {
                let mut checkout = git2::build::CheckoutBuilder::new();
                checkout.force();
                for path in &paths {
                    checkout.path(path);
                }
                repo.checkout_index(None, Some(&mut checkout))
                    .map_err(map_git2)?;
                Ok(())
            }
            ChangeArea::Untracked => {
                for path in &paths {
                    delete_untracked(&repo, &repo_path, path)?;
                }
                Ok(())
            }
        }
    })
    .await
}

/// Delete paths from the working tree and index.
pub async fn remove_paths(repo_path: &Path, paths: &[String], area: ChangeArea) -> CoreResult<()> {
    let paths = prepare_paths(repo_path, paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let repo_path = repo_path.to_path_buf();
    blocking(move || match area {
        ChangeArea::Untracked => {
            let repo = open_repo(&repo_path)?;
            for path in &paths {
                delete_untracked(&repo, &repo_path, path)?;
            }
            Ok(())
        }
        ChangeArea::Staged | ChangeArea::Unstaged => {
            let repo = open_repo(&repo_path)?;
            let mut index = repo.index().map_err(map_git2)?;
            for path in &paths {
                let _ = index.remove_path(Path::new(path));
                let abs = repo_path.join(path);
                if abs.is_file() || abs.is_symlink() {
                    std::fs::remove_file(&abs).map_err(|err| {
                        CoreError::process_failed(format!(
                            "Failed to remove {}: {err}",
                            abs.display()
                        ))
                    })?;
                }
            }
            index.write().map_err(map_git2)?;
            Ok(())
        }
    })
    .await
}

/// Stop tracking paths while keeping the working-tree files.
pub async fn stop_tracking_paths(repo_path: &Path, paths: &[String]) -> CoreResult<()> {
    let paths = prepare_paths(repo_path, paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    let repo_path = repo_path.to_path_buf();
    blocking(move || {
        let repo = open_repo(&repo_path)?;
        let mut index = repo.index().map_err(map_git2)?;
        for path in &paths {
            index.remove_path(Path::new(path)).map_err(map_git2)?;
        }
        index.write().map_err(map_git2)?;
        Ok(())
    })
    .await
}

/// Resolve a repo-relative path to an absolute path under `repo_path`.
pub fn resolve_repo_path(repo_path: &Path, relative: &str) -> CoreResult<std::path::PathBuf> {
    validate_repo(repo_path)?;
    let paths = normalize_paths(&[relative.to_string()])?;
    let rel = paths
        .into_iter()
        .next()
        .ok_or_else(|| CoreError::new(ErrorCode::Internal, "Path must not be empty."))?;
    Ok(repo_path.join(rel))
}

/// Options for [`commit_index`].
#[derive(Debug, Clone, Copy, Default)]
pub struct CommitOptions {
    pub amend: bool,
    /// Append a `Signed-off-by` trailer.
    pub sign_off: bool,
    /// Request a signed commit. In-process signing is not available yet.
    pub sign_commit: bool,
    /// Skip pre-commit and commit-msg hooks.
    pub no_verify: bool,
}

/// Create a commit from the current index.
///
/// When `identity` has name/email, they apply to this commit only and are not
/// written into Git config.
pub async fn commit_index(
    repo_path: &Path,
    message: &str,
    options: CommitOptions,
    identity: Option<&CommitIdentity>,
) -> CoreResult<String> {
    validate_repo(repo_path)?;
    let message = message.trim().to_string();
    if message.is_empty() && !options.amend {
        return Err(CoreError::new(
            ErrorCode::ProcessFailed,
            "Commit message must not be empty.",
        ));
    }
    if options.sign_commit {
        return Err(CoreError::process_failed(
            "Commit signing is not available in GitLibre yet.",
        ));
    }
    let identity = identity.cloned();
    let repo_path = repo_path.to_path_buf();
    blocking(move || commit_index_at(&repo_path, &message, options, identity.as_ref())).await
}

fn commit_index_at(
    repo_path: &Path,
    message: &str,
    options: CommitOptions,
    identity: Option<&CommitIdentity>,
) -> CoreResult<String> {
    let repo = open_repo(repo_path)?;
    if !options.no_verify {
        run_hook(&repo, "pre-commit", &[])?;
    }
    let mut index = repo.index().map_err(map_git2)?;
    let tree_id = index.write_tree().map_err(map_git2)?;
    let tree = repo.find_tree(tree_id).map_err(map_git2)?;
    let head = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
    if !options.amend {
        let unchanged = match &head {
            Some(parent) => parent.tree_id() == tree_id,
            None => {
                tree_id
                    == repo
                        .index()
                        .map_err(map_git2)?
                        .write_tree()
                        .ok()
                        .unwrap_or(tree_id)
                    && diff_against_empty_is_empty(&repo, &tree)?
            }
        };
        if unchanged {
            return Err(CoreError::new(
                ErrorCode::ProcessFailed,
                "Nothing staged to commit.",
            ));
        }
    }
    let signature = commit_signature(&repo, identity)?;
    let mut message = if message.is_empty() {
        head.as_ref()
            .and_then(|commit| commit.message().ok())
            .unwrap_or("")
            .to_string()
    } else {
        message.to_string()
    };
    if options.sign_off {
        let trailer = format!(
            "Signed-off-by: {} <{}>",
            signature.name().unwrap_or(""),
            signature.email().unwrap_or("")
        );
        if !message.contains(&trailer) {
            if !message.ends_with('\n') {
                message.push('\n');
            }
            message.push('\n');
            message.push_str(&trailer);
            message.push('\n');
        }
    }
    if !options.no_verify {
        let msg_file = repo.path().join("COMMIT_EDITMSG");
        std::fs::write(&msg_file, &message).map_err(|err| {
            CoreError::process_failed(format!("Failed to write commit message: {err}"))
        })?;
        run_hook(
            &repo,
            "commit-msg",
            &[msg_file.to_string_lossy().into_owned()],
        )?;
        message = std::fs::read_to_string(&msg_file).unwrap_or(message);
    }
    let oid = if options.amend {
        let head = head.ok_or_else(|| {
            CoreError::process_failed("Cannot amend: this repository has no commits.")
        })?;
        head.amend(
            Some("HEAD"),
            Some(&signature),
            None,
            None,
            Some(&message),
            Some(&tree),
        )
        .map_err(map_git2)?
    } else {
        let parents: Vec<&git2::Commit<'_>> = head.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parents,
        )
        .map_err(map_git2)?
    };
    Ok(oid.to_string())
}

fn diff_against_empty_is_empty(repo: &git2::Repository, tree: &git2::Tree<'_>) -> CoreResult<bool> {
    let diff = repo
        .diff_tree_to_tree(None, Some(tree), None)
        .map_err(map_git2)?;
    Ok(diff.deltas().len() == 0)
}

/// Subject and body of `HEAD`.
pub async fn read_head_commit_message(repo_path: &Path) -> CoreResult<String> {
    validate_repo(repo_path)?;
    let path = repo_path.to_path_buf();
    blocking(move || {
        let repo = open_repo(&path)?;
        let message = repo
            .head()
            .map_err(map_git2)?
            .peel_to_commit()
            .map_err(map_git2)?
            .message()
            .unwrap_or("")
            .trim_end()
            .to_string();
        Ok(message)
    })
    .await
}

/// Push the current branch to its upstream, or to `origin` when none is set.
pub async fn push_current_branch(
    repo_path: &Path,
    auth: Option<&crate::auth::GitAuth>,
) -> CoreResult<String> {
    validate_repo(repo_path)?;
    let path = repo_path.to_path_buf();
    let auth = auth.cloned();
    blocking(move || crate::git::transport::push_current_branch(&path, auth.as_ref())).await
}

fn restore_from_head(
    repo: &git2::Repository,
    repo_path: &Path,
    paths: &[String],
) -> CoreResult<()> {
    let head_tree = match repo.head() {
        Ok(head) => Some(head.peel_to_tree().map_err(map_git2)?),
        Err(_) => None,
    };
    let mut in_head = Vec::new();
    let mut added = Vec::new();
    for path in paths {
        let present = head_tree
            .as_ref()
            .and_then(|tree| tree.get_path(Path::new(path)).ok())
            .is_some();
        if present {
            in_head.push(path.clone());
        } else {
            added.push(path.clone());
        }
    }
    if !in_head.is_empty() {
        if let Some(tree) = head_tree.as_ref() {
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.force().update_index(true);
            for path in &in_head {
                checkout.path(path);
            }
            repo.checkout_tree(tree.as_object(), Some(&mut checkout))
                .map_err(map_git2)?;
        }
    }
    if !added.is_empty() {
        let mut index = repo.index().map_err(map_git2)?;
        for path in &added {
            let _ = index.remove_path(Path::new(path));
            let abs = repo_path.join(path);
            if abs.exists() {
                if abs.is_dir() {
                    std::fs::remove_dir_all(&abs).map_err(|err| {
                        CoreError::process_failed(format!(
                            "Failed to remove {}: {err}",
                            abs.display()
                        ))
                    })?;
                } else {
                    std::fs::remove_file(&abs).map_err(|err| {
                        CoreError::process_failed(format!(
                            "Failed to remove {}: {err}",
                            abs.display()
                        ))
                    })?;
                }
            }
        }
        index.write().map_err(map_git2)?;
    }
    Ok(())
}

fn delete_untracked(repo: &git2::Repository, repo_path: &Path, path: &str) -> CoreResult<()> {
    if repo
        .index()
        .map_err(map_git2)?
        .get_path(Path::new(path), 0)
        .is_some()
    {
        return Err(CoreError::process_failed(format!(
            "{path} is tracked and was not deleted."
        )));
    }
    let target = repo_path.join(path);
    if !target.exists() {
        return Ok(());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target)
    } else {
        std::fs::remove_file(&target)
    }
    .map_err(|err| {
        CoreError::process_failed(format!("Failed to remove {}: {err}", target.display()))
    })
}

fn run_hook(repo: &git2::Repository, name: &str, args: &[String]) -> CoreResult<()> {
    let hook = repo.path().join("hooks").join(name);
    if !hook.is_file() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&hook)
            .map(|meta| meta.permissions().mode())
            .unwrap_or(0);
        if mode & 0o111 == 0 {
            return Ok(());
        }
    }
    let workdir = repo.workdir().unwrap_or_else(|| repo.path());
    let status = std::process::Command::new(&hook)
        .args(args)
        .current_dir(workdir)
        .env("GIT_DIR", repo.path())
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(CoreError::process_failed(format!(
            "{name} hook failed ({status})"
        ))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(CoreError::process_failed(format!(
            "{name} hook failed: {err}"
        ))),
    }
}

fn prepare_paths(repo_path: &Path, paths: &[String]) -> CoreResult<Vec<String>> {
    validate_repo(repo_path)?;
    normalize_paths(paths)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::show::{ChangeArea, UNCOMMITTED_COMMIT_ID, list_commit_files};
    use crate::testutil;
    use tempfile::tempdir;

    #[tokio::test]
    async fn stage_unstage_commit_discard() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        let repo = testutil::init_repo(&repo_path);
        testutil::set_identity(&repo, "Dev", "dev@example.com");
        testutil::commit_file(&repo, "a.txt", "one\n", "first");

        std::fs::write(repo_path.join("a.txt"), "two\n").unwrap();
        std::fs::write(repo_path.join("b.txt"), "new\n").unwrap();

        let files = list_commit_files(&repo_path, UNCOMMITTED_COMMIT_ID)
            .await
            .unwrap();
        assert!(files.iter().any(|f| f.area == Some(ChangeArea::Unstaged)));
        assert!(files.iter().any(|f| f.area == Some(ChangeArea::Untracked)));

        stage_paths(&repo_path, &["a.txt".into(), "b.txt".into()])
            .await
            .unwrap();

        let staged = list_commit_files(&repo_path, UNCOMMITTED_COMMIT_ID)
            .await
            .unwrap();
        assert!(
            staged
                .iter()
                .filter(|f| f.area == Some(ChangeArea::Staged))
                .count()
                >= 2
        );

        unstage_paths(&repo_path, &["b.txt".into()]).await.unwrap();

        let identity = CommitIdentity {
            name: Some("Scry".into()),
            email: Some("scry@example.com".into()),
            is_local: false,
        };
        let oid = commit_index(
            &repo_path,
            "update a",
            CommitOptions::default(),
            Some(&identity),
        )
        .await
        .unwrap();
        assert_eq!(oid.len(), 40);

        let repo = git2::Repository::open(&repo_path).unwrap();
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        let author = commit.author();
        assert_eq!(author.name().unwrap(), "Scry");
        assert_eq!(author.email().unwrap(), "scry@example.com");
        assert_eq!(commit.summary().unwrap().as_deref(), Some("update a"));
        let config = repo.config().unwrap();
        assert_eq!(config.get_string("user.name").unwrap(), "Dev");

        std::fs::write(repo_path.join("c.txt"), "temp\n").unwrap();
        discard_paths(&repo_path, &["c.txt".into()], ChangeArea::Untracked)
            .await
            .unwrap();
        assert!(!repo_path.join("c.txt").exists());

        std::fs::write(repo_path.join("d.txt"), "keep\n").unwrap();
        stage_paths(&repo_path, &["d.txt".into()]).await.unwrap();
        commit_index(&repo_path, "add d", CommitOptions::default(), None)
            .await
            .unwrap();

        stop_tracking_paths(&repo_path, &["d.txt".into()])
            .await
            .unwrap();
        assert!(repo_path.join("d.txt").exists());

        std::fs::write(repo_path.join("e.txt"), "gone\n").unwrap();
        stage_paths(&repo_path, &["e.txt".into()]).await.unwrap();
        commit_index(&repo_path, "add e", CommitOptions::default(), None)
            .await
            .unwrap();
        remove_paths(&repo_path, &["e.txt".into()], ChangeArea::Unstaged)
            .await
            .unwrap();
        assert!(!repo_path.join("e.txt").exists());
    }

    #[tokio::test]
    async fn stage_deletion_and_nested_repository() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        let repo = testutil::init_repo(&repo_path);
        testutil::commit_file(&repo, "gone.txt", "bye\n", "add gone");
        drop(repo);

        std::fs::remove_file(repo_path.join("gone.txt")).unwrap();
        std::fs::write(repo_path.join("kept.txt"), "stay\n").unwrap();

        let nested_path = repo_path.join("nested repo");
        let nested = testutil::init_repo(&nested_path);
        testutil::commit_file(&nested, "inside.txt", "x\n", "nested");
        let nested_head = nested.head().unwrap().peel_to_commit().unwrap().id();
        drop(nested);

        let listed = list_commit_files(&repo_path, UNCOMMITTED_COMMIT_ID)
            .await
            .unwrap();
        let mut paths: Vec<String> = listed.iter().map(|file| file.path.clone()).collect();
        paths.push("nested repo".into());
        stage_paths(&repo_path, &paths).await.unwrap();

        let parent = git2::Repository::open(&repo_path).unwrap();
        let index = parent.index().unwrap();
        assert!(index.get_path(Path::new("gone.txt"), 0).is_none());
        assert!(index.get_path(Path::new("kept.txt"), 0).is_some());
        let link = index.get_path(Path::new("nested repo"), 0).unwrap();
        assert_eq!(link.mode, u32::from(git2::FileMode::Commit));
        assert_eq!(link.id, nested_head);
    }
}
