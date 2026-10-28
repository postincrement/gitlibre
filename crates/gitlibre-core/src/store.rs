use crate::error::{CoreError, CoreResult};
use crate::ids::{RepositoryId, WorkspaceId};
use crate::models::{AppConfig, Repository, Workspace, CONFIG_VERSION};
use std::fs;
use std::path::{Path, PathBuf};

/// In-memory workspace configuration with JSON persistence.
///
/// Persistence uses write-to-temp + rename for atomic replacement on the same volume.
#[derive(Debug, Clone)]
pub struct ConfigStore {
    path: PathBuf,
    config: AppConfig,
}

impl ConfigStore {
    pub fn open(path: impl Into<PathBuf>) -> CoreResult<Self> {
        let path = path.into();
        let config = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(CoreError::config_io)?;
            let mut parsed: AppConfig =
                serde_json::from_str(&raw).map_err(CoreError::config_parse)?;
            if parsed.version == 0 {
                parsed.version = CONFIG_VERSION;
            }
            // Future: migrate when parsed.version < CONFIG_VERSION
            parsed
        } else {
            AppConfig::default()
        };
        Ok(Self { path, config })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn config(&self) -> &AppConfig {
        &self.config
    }

    pub fn save(&self) -> CoreResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(CoreError::config_io)?;
        }
        let json = serde_json::to_string_pretty(&self.config).map_err(|e| {
            CoreError::new(crate::error::ErrorCode::Internal, e.to_string())
        })?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json.as_bytes()).map_err(CoreError::config_io)?;
        fs::rename(&tmp, &self.path).map_err(CoreError::config_io)?;
        Ok(())
    }

    pub fn list_workspaces(&self) -> &[Workspace] {
        &self.config.workspaces
    }

    pub fn active_workspace_id(&self) -> Option<WorkspaceId> {
        self.config.active_workspace_id
    }

    pub fn create_workspace(&mut self, name: impl Into<String>) -> CoreResult<Workspace> {
        let name = name.into();
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::new(
                crate::error::ErrorCode::Internal,
                "Workspace name must not be empty.",
            ));
        }
        let workspace = Workspace {
            id: WorkspaceId::new(),
            name: name.to_string(),
            repositories: Vec::new(),
        };
        self.config.workspaces.push(workspace.clone());
        if self.config.active_workspace_id.is_none() {
            self.config.active_workspace_id = Some(workspace.id);
        }
        self.save()?;
        Ok(workspace)
    }

    pub fn delete_workspace(&mut self, id: WorkspaceId) -> CoreResult<()> {
        let before = self.config.workspaces.len();
        self.config.workspaces.retain(|w| w.id != id);
        if self.config.workspaces.len() == before {
            return Err(CoreError::workspace_not_found());
        }
        if self.config.active_workspace_id == Some(id) {
            self.config.active_workspace_id = self.config.workspaces.first().map(|w| w.id);
        }
        // Orphaned repositories that are no longer referenced may remain in the
        // registry for now (harmless). A future prune pass can remove them.
        self.save()?;
        Ok(())
    }

    pub fn set_active_workspace(&mut self, id: WorkspaceId) -> CoreResult<()> {
        if !self.config.workspaces.iter().any(|w| w.id == id) {
            return Err(CoreError::workspace_not_found());
        }
        self.config.active_workspace_id = Some(id);
        self.save()?;
        Ok(())
    }

    pub fn active_workspace(&self) -> Option<&Workspace> {
        let id = self.config.active_workspace_id?;
        self.config.workspaces.iter().find(|w| w.id == id)
    }

    pub fn get_repository(&self, id: RepositoryId) -> Option<&Repository> {
        self.config.repositories.iter().find(|r| r.id == id)
    }

    pub fn repositories_in_active_workspace(&self) -> Vec<&Repository> {
        let Some(ws) = self.active_workspace() else {
            return Vec::new();
        };
        ws.repositories
            .iter()
            .filter_map(|id| self.get_repository(*id))
            .collect()
    }

    /// Canonicalize `path`, validate it is a Git repo, and add it to the active workspace.
    pub fn add_repository_to_active(
        &mut self,
        path: impl AsRef<Path>,
    ) -> CoreResult<Repository> {
        let active_id = self
            .config
            .active_workspace_id
            .ok_or_else(CoreError::workspace_not_found)?;
        self.add_repository_to_workspace(active_id, path)
    }

    pub fn add_repository_to_workspace(
        &mut self,
        workspace_id: WorkspaceId,
        path: impl AsRef<Path>,
    ) -> CoreResult<Repository> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(CoreError::path_not_found(path.display()));
        }
        if !path.is_dir() {
            return Err(CoreError::new(
                crate::error::ErrorCode::PathNotDirectory,
                format!("Path is not a directory: {}", path.display()),
            ));
        }

        let canonical = fs::canonicalize(path).map_err(CoreError::config_io)?;
        if !is_git_repository(&canonical) {
            return Err(CoreError::not_a_git_repository(canonical.display()));
        }

        if !self.config.workspaces.iter().any(|w| w.id == workspace_id) {
            return Err(CoreError::workspace_not_found());
        }

        // Look up registry entry before mutating workspace membership.
        let existing_id = self
            .config
            .repositories
            .iter()
            .find(|r| paths_equal(&r.path, &canonical))
            .map(|r| r.id);

        let repo = if let Some(id) = existing_id {
            let ws = self
                .config
                .workspaces
                .iter_mut()
                .find(|w| w.id == workspace_id)
                .expect("workspace checked above");
            if ws.repositories.contains(&id) {
                return Err(CoreError::duplicate_repository(canonical.display()));
            }
            ws.repositories.push(id);
            self.config
                .repositories
                .iter()
                .find(|r| r.id == id)
                .expect("registry entry exists")
                .clone()
        } else {
            let display_name = canonical
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("repository")
                .to_string();
            let repo = Repository {
                id: RepositoryId::new(),
                path: canonical,
                display_name,
            };
            let ws = self
                .config
                .workspaces
                .iter_mut()
                .find(|w| w.id == workspace_id)
                .expect("workspace checked above");
            ws.repositories.push(repo.id);
            self.config.repositories.push(repo.clone());
            repo
        };

        self.save()?;
        Ok(repo)
    }

    pub fn remove_repository_from_active(&mut self, repo_id: RepositoryId) -> CoreResult<()> {
        let active_id = self
            .config
            .active_workspace_id
            .ok_or_else(CoreError::workspace_not_found)?;
        self.remove_repository_from_workspace(active_id, repo_id)
    }

    pub fn remove_repository_from_workspace(
        &mut self,
        workspace_id: WorkspaceId,
        repo_id: RepositoryId,
    ) -> CoreResult<()> {
        let ws = self
            .config
            .workspaces
            .iter_mut()
            .find(|w| w.id == workspace_id)
            .ok_or_else(CoreError::workspace_not_found)?;
        let before = ws.repositories.len();
        ws.repositories.retain(|id| *id != repo_id);
        if ws.repositories.len() == before {
            return Err(CoreError::repository_not_found());
        }
        self.save()?;
        Ok(())
    }
}

fn is_git_repository(path: &Path) -> bool {
    let git_dir = path.join(".git");
    git_dir.is_dir() || git_dir.is_file() // file = worktree / submodule gitfile
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    a == b
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::tempdir;

    fn init_git_repo(dir: &Path) {
        let status = Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .status()
            .expect("git init");
        assert!(status.success());
    }

    #[test]
    fn create_and_delete_workspace() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut store = ConfigStore::open(&path).unwrap();
        let ws = store.create_workspace("ScryPOS").unwrap();
        assert_eq!(store.list_workspaces().len(), 1);
        assert_eq!(store.active_workspace_id(), Some(ws.id));
        store.delete_workspace(ws.id).unwrap();
        assert!(store.list_workspaces().is_empty());
    }

    #[test]
    fn add_remove_repository_and_detect_duplicate() {
        let dir = tempdir().unwrap();
        let repo_dir = dir.path().join("repo");
        fs::create_dir(&repo_dir).unwrap();
        init_git_repo(&repo_dir);

        let mut store = ConfigStore::open(dir.path().join("config.json")).unwrap();
        store.create_workspace("ScryPOS").unwrap();
        let repo = store.add_repository_to_active(&repo_dir).unwrap();
        assert_eq!(store.repositories_in_active_workspace().len(), 1);

        let err = store.add_repository_to_active(&repo_dir).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::DuplicateRepository);

        store.remove_repository_from_active(repo.id).unwrap();
        assert!(store.repositories_in_active_workspace().is_empty());
        // Disk repo still exists
        assert!(repo_dir.join(".git").exists());
    }

    #[test]
    fn serde_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut store = ConfigStore::open(&path).unwrap();
        store.create_workspace("A").unwrap();
        drop(store);

        let reloaded = ConfigStore::open(&path).unwrap();
        assert_eq!(reloaded.list_workspaces().len(), 1);
        assert_eq!(reloaded.config().version, CONFIG_VERSION);
    }

    #[test]
    fn reject_non_git_directory() {
        let dir = tempdir().unwrap();
        let plain = dir.path().join("plain");
        fs::create_dir(&plain).unwrap();
        let mut store = ConfigStore::open(dir.path().join("config.json")).unwrap();
        store.create_workspace("W").unwrap();
        let err = store.add_repository_to_active(&plain).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::NotAGitRepository);
    }

    #[test]
    fn same_repo_two_workspaces_shares_registry() {
        let dir = tempdir().unwrap();
        let repo_dir = dir.path().join("repo");
        fs::create_dir(&repo_dir).unwrap();
        init_git_repo(&repo_dir);

        let mut store = ConfigStore::open(dir.path().join("config.json")).unwrap();
        let a = store.create_workspace("A").unwrap();
        let b = store.create_workspace("B").unwrap();
        let r1 = store.add_repository_to_workspace(a.id, &repo_dir).unwrap();
        let r2 = store.add_repository_to_workspace(b.id, &repo_dir).unwrap();
        assert_eq!(r1.id, r2.id);
        assert_eq!(store.config().repositories.len(), 1);
    }
}
