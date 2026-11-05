use crate::error::{CoreError, CoreResult};
use crate::git::identity::{CommitIdentity, commit_signature};
use crate::git::session::{blocking, map_git2, open_repo};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One entry on `refs/stash`, newest first. `index` is the position `git stash`
/// uses (`stash@{0}` is index 0).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

pub async fn list_stashes(repo_path: &Path) -> CoreResult<Vec<StashEntry>> {
    let path = repo_path.to_path_buf();
    blocking(move || list_stashes_at(&path)).await
}

/// Save staged, unstaged, and optionally untracked changes, then restore a
/// clean work tree. An empty message lets libgit2 write the usual
/// "WIP on {branch}" message.
pub async fn save_stash(
    repo_path: &Path,
    message: Option<String>,
    include_untracked: bool,
    identity: Option<CommitIdentity>,
) -> CoreResult<String> {
    let path = repo_path.to_path_buf();
    let message = message
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    blocking(move || {
        save_stash_at(
            &path,
            message.as_deref(),
            include_untracked,
            identity.as_ref(),
        )
    })
    .await
}

pub async fn apply_stash(repo_path: &Path, index: usize) -> CoreResult<()> {
    let path = repo_path.to_path_buf();
    blocking(move || apply_stash_at(&path, index, false)).await
}

pub async fn pop_stash(repo_path: &Path, index: usize) -> CoreResult<()> {
    let path = repo_path.to_path_buf();
    blocking(move || apply_stash_at(&path, index, true)).await
}

pub async fn drop_stash(repo_path: &Path, index: usize) -> CoreResult<()> {
    let path = repo_path.to_path_buf();
    blocking(move || {
        let mut repo = open_repo(&path)?;
        repo.stash_drop(index).map_err(map_git2)
    })
    .await
}

fn list_stashes_at(path: &Path) -> CoreResult<Vec<StashEntry>> {
    let mut repo = open_repo(path)?;
    let mut entries = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        entries.push(StashEntry {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })
    .map_err(map_git2)?;
    Ok(entries)
}

fn save_stash_at(
    path: &Path,
    message: Option<&str>,
    include_untracked: bool,
    identity: Option<&CommitIdentity>,
) -> CoreResult<String> {
    let mut repo = open_repo(path)?;
    let signature = commit_signature(&repo, identity)?;
    let flags = if include_untracked {
        git2::StashFlags::INCLUDE_UNTRACKED
    } else {
        git2::StashFlags::DEFAULT
    };
    repo.stash_save2(&signature, message, Some(flags))
        .map_err(stash_save_error)?;
    let mut saved = None;
    repo.stash_foreach(|index, message, _oid| {
        if index == 0 {
            saved = Some(message.to_string());
        }
        true
    })
    .map_err(map_git2)?;
    Ok(saved.unwrap_or_else(|| "Stash saved".into()))
}

fn apply_stash_at(path: &Path, index: usize, pop: bool) -> CoreResult<()> {
    let mut repo = open_repo(path)?;
    let mut opts = git2::StashApplyOptions::new();
    opts.reinstantiate_index();
    let result = if pop {
        repo.stash_pop(index, Some(&mut opts))
    } else {
        repo.stash_apply(index, Some(&mut opts))
    };
    result.map_err(map_git2)
}

fn stash_save_error(err: git2::Error) -> CoreError {
    let message = err.message().to_lowercase();
    if err.code() == git2::ErrorCode::NotFound || message.contains("no local changes") {
        return CoreError::process_failed("There are no local changes to stash.");
    }
    map_git2(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil;
    use std::fs;
    use std::path::Path;

    fn repo_with_commit(path: &Path) -> git2::Repository {
        let repo = testutil::init_repo(path);
        testutil::commit_file(&repo, "a.txt", "base", "init");
        repo
    }

    #[tokio::test]
    async fn stash_saves_staged_edits_and_pop_restores_them() {
        let dir = tempfile::tempdir().unwrap();
        let repo = repo_with_commit(dir.path());
        let work = repo.workdir().unwrap().to_path_buf();
        fs::write(work.join("a.txt"), "changed").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
        index.write().unwrap();
        drop(index);
        drop(repo);

        let message = save_stash(dir.path(), Some("wip".into()), false, None)
            .await
            .unwrap();
        assert!(message.to_lowercase().contains("wip"), "{message}");
        assert_eq!(fs::read_to_string(work.join("a.txt")).unwrap(), "base");

        let listed = list_stashes(dir.path()).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].index, 0);

        pop_stash(dir.path(), 0).await.unwrap();
        assert!(list_stashes(dir.path()).await.unwrap().is_empty());
        assert_eq!(fs::read_to_string(work.join("a.txt")).unwrap(), "changed");

        let repo = git2::Repository::open(dir.path()).unwrap();
        let statuses = repo.statuses(None).unwrap();
        let entry = statuses
            .iter()
            .find(|entry| entry.path().ok() == Some("a.txt"))
            .expect("a.txt status");
        assert!(entry.status().is_index_modified());
    }

    #[tokio::test]
    async fn stash_includes_untracked_files_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        let repo = repo_with_commit(dir.path());
        let work = repo.workdir().unwrap().to_path_buf();
        drop(repo);
        fs::write(work.join("new.txt"), "fresh").unwrap();

        save_stash(dir.path(), None, true, None).await.unwrap();
        assert!(!work.join("new.txt").exists());

        apply_stash(dir.path(), 0).await.unwrap();
        assert_eq!(list_stashes(dir.path()).await.unwrap().len(), 1);
        assert_eq!(fs::read_to_string(work.join("new.txt")).unwrap(), "fresh");
    }

    #[tokio::test]
    async fn stash_refuses_a_clean_work_tree() {
        let dir = tempfile::tempdir().unwrap();
        let repo = repo_with_commit(dir.path());
        drop(repo);
        let err = save_stash(dir.path(), None, true, None).await.unwrap_err();
        assert!(err.message.contains("no local changes"), "{err:?}");
    }

    #[tokio::test]
    async fn drop_removes_the_stash_without_restoring_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = repo_with_commit(dir.path());
        let work = repo.workdir().unwrap().to_path_buf();
        fs::write(work.join("a.txt"), "changed").unwrap();
        drop(repo);

        save_stash(dir.path(), Some("later".into()), false, None)
            .await
            .unwrap();
        drop_stash(dir.path(), 0).await.unwrap();
        assert!(list_stashes(dir.path()).await.unwrap().is_empty());
        assert_eq!(fs::read_to_string(work.join("a.txt")).unwrap(), "base");
    }
}
