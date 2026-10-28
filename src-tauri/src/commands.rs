use crate::dto::{
    AppErrorDto, AppSnapshot, CmdResult, FetchFinishedEvent, FetchProgressEvent, RepoStatusDto,
    RepositoryDto, WorkspaceDto, WorkspaceFetchFinishedEvent,
};
use crate::state::{AppState, LiveRepoState};
use gitlibre_core::{inspect_repository, CoreError, RepositoryId, WorkspaceId};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

fn lock_store(
    state: &AppState,
) -> Result<std::sync::MutexGuard<'_, gitlibre_core::ConfigStore>, AppErrorDto> {
    state.store.lock().map_err(|_| AppErrorDto {
        code: "internal".into(),
        message: "Application state lock was poisoned".into(),
    })
}

fn lock_live(
    state: &AppState,
) -> Result<
    std::sync::MutexGuard<'_, std::collections::HashMap<RepositoryId, LiveRepoState>>,
    AppErrorDto,
> {
    state.live.lock().map_err(|_| AppErrorDto {
        code: "internal".into(),
        message: "Application state lock was poisoned".into(),
    })
}

fn snapshot_from_store(store: &gitlibre_core::ConfigStore) -> AppSnapshot {
    AppSnapshot {
        workspaces: store
            .list_workspaces()
            .iter()
            .cloned()
            .map(WorkspaceDto::from)
            .collect(),
        active_workspace_id: store.active_workspace_id(),
        repositories: store
            .config()
            .repositories
            .iter()
            .cloned()
            .map(RepositoryDto::from)
            .collect(),
    }
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    let store = lock_store(&state)?;
    Ok(snapshot_from_store(&store))
}

#[tauri::command]
pub fn create_workspace(name: String, state: State<'_, AppState>) -> CmdResult<WorkspaceDto> {
    let mut store = lock_store(&state)?;
    let ws = store.create_workspace(name.trim()).map_err(AppErrorDto::from)?;
    Ok(ws.into())
}

#[tauri::command]
pub fn delete_workspace(id: WorkspaceId, state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    let mut store = lock_store(&state)?;
    store.delete_workspace(id).map_err(AppErrorDto::from)?;
    Ok(snapshot_from_store(&store))
}

#[tauri::command]
pub fn set_active_workspace(
    id: WorkspaceId,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    let mut store = lock_store(&state)?;
    store.set_active_workspace(id).map_err(AppErrorDto::from)?;
    Ok(snapshot_from_store(&store))
}

#[tauri::command]
pub fn add_repository(path: String, state: State<'_, AppState>) -> CmdResult<RepositoryDto> {
    let mut store = lock_store(&state)?;
    let repo = store
        .add_repository_to_active(PathBuf::from(path))
        .map_err(AppErrorDto::from)?;
    Ok(repo.into())
}

#[tauri::command]
pub fn remove_repository(
    id: RepositoryId,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    let mut store = lock_store(&state)?;
    store
        .remove_repository_from_active(id)
        .map_err(AppErrorDto::from)?;
    Ok(snapshot_from_store(&store))
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> CmdResult<Option<String>> {
    let folder = app
        .dialog()
        .file()
        .set_title("Select Git repository")
        .blocking_pick_folder();
    Ok(folder.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn get_repository_status(
    id: RepositoryId,
    state: State<'_, AppState>,
) -> CmdResult<RepoStatusDto> {
    let (display_name, path) = {
        let store = lock_store(&state)?;
        let repo = store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .clone();
        (repo.display_name, repo.path)
    };
    status_for_repo(&state, id, display_name, path).await
}

#[tauri::command]
pub async fn list_workspace_statuses(
    state: State<'_, AppState>,
) -> CmdResult<Vec<RepoStatusDto>> {
    let repos: Vec<_> = {
        let store = lock_store(&state)?;
        store
            .repositories_in_active_workspace()
            .into_iter()
            .cloned()
            .collect()
    };

    let mut out = Vec::with_capacity(repos.len());
    for repo in repos {
        out.push(status_for_repo(&state, repo.id, repo.display_name, repo.path).await?);
    }
    Ok(out)
}

async fn status_for_repo(
    state: &State<'_, AppState>,
    id: RepositoryId,
    display_name: String,
    path: PathBuf,
) -> CmdResult<RepoStatusDto> {
    let live = {
        let map = lock_live(state)?;
        map.get(&id).cloned().unwrap_or_default()
    };

    if !path.exists() {
        return Ok(RepoStatusDto {
            repository_id: id,
            display_name,
            path,
            available: false,
            current_branch: None,
            detached_head: false,
            remotes: Vec::new(),
            working_tree: None,
            is_fetching: live.is_fetching,
            last_error: Some("Repository path no longer exists".into()),
            last_fetch_summary: live.last_fetch_summary,
        });
    }

    match inspect_repository(state.coordinator.executor(), &path).await {
        Ok(info) => Ok(RepoStatusDto {
            repository_id: id,
            display_name,
            path,
            available: true,
            current_branch: info.current_branch,
            detached_head: info.detached_head,
            remotes: info.remotes,
            working_tree: Some(info.working_tree),
            is_fetching: live.is_fetching,
            last_error: live.last_error,
            last_fetch_summary: live.last_fetch_summary,
        }),
        Err(err) => Ok(RepoStatusDto {
            repository_id: id,
            display_name,
            path,
            available: false,
            current_branch: None,
            detached_head: false,
            remotes: Vec::new(),
            working_tree: None,
            is_fetching: live.is_fetching,
            last_error: Some(err.message),
            last_fetch_summary: live.last_fetch_summary,
        }),
    }
}

#[tauri::command]
pub async fn fetch_repository(id: RepositoryId, app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .path
            .clone()
    };

    {
        let mut live = lock_live(&state)?;
        let entry = live.entry(id).or_default();
        entry.is_fetching = true;
        entry.last_error = None;
    }

    let app_progress = app.clone();
    let outcome = state
        .coordinator
        .fetch_one(id, &path, |p| {
            let _ = app_progress.emit(
                "repo-fetch-progress",
                FetchProgressEvent {
                    repository_id: p.repository_id,
                    message: p.message,
                },
            );
        })
        .await;

    {
        let mut live = lock_live(&state)?;
        let entry = live.entry(id).or_default();
        entry.is_fetching = false;
        entry.last_fetch_summary = Some(outcome.summary.clone());
        entry.last_error = outcome.error.as_ref().map(|e| e.message.clone());
    }

    let _ = app.emit(
        "repo-fetch-finished",
        FetchFinishedEvent {
            repository_id: outcome.repository_id,
            success: outcome.success,
            summary: outcome.summary,
            error: outcome.error.map(AppErrorDto::from),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn fetch_workspace(app: AppHandle, state: State<'_, AppState>) -> CmdResult<WorkspaceFetchFinishedEvent> {
    let repos: Vec<(RepositoryId, PathBuf)> = {
        let store = lock_store(&state)?;
        store
            .repositories_in_active_workspace()
            .into_iter()
            .map(|r| (r.id, r.path.clone()))
            .collect()
    };

    {
        let mut live = lock_live(&state)?;
        for (id, _) in &repos {
            let entry = live.entry(*id).or_default();
            entry.is_fetching = true;
            entry.last_error = None;
        }
    }

    let app_progress = app.clone();
    let summary = state
        .coordinator
        .fetch_many(repos, move |p| {
            let _ = app_progress.emit(
                "repo-fetch-progress",
                FetchProgressEvent {
                    repository_id: p.repository_id,
                    message: p.message,
                },
            );
        })
        .await;

    {
        let mut live = lock_live(&state)?;
        for outcome in &summary.outcomes {
            let entry = live.entry(outcome.repository_id).or_default();
            entry.is_fetching = false;
            entry.last_fetch_summary = Some(outcome.summary.clone());
            entry.last_error = outcome.error.as_ref().map(|e| e.message.clone());
            let _ = app.emit(
                "repo-fetch-finished",
                FetchFinishedEvent {
                    repository_id: outcome.repository_id,
                    success: outcome.success,
                    summary: outcome.summary.clone(),
                    error: outcome.error.clone().map(AppErrorDto::from),
                },
            );
        }
    }

    let finished = WorkspaceFetchFinishedEvent {
        total: summary.total,
        succeeded: summary.succeeded,
        failed: summary.failed,
    };
    let _ = app.emit("workspace-fetch-finished", &finished);
    Ok(finished)
}
