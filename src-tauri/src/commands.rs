use crate::dto::{
    AccountDto, AppErrorDto, AppSnapshot, CmdResult, CreateAccountRequest, FetchFinishedEvent,
    FetchProgressEvent, RepoStatusDto, RepositoryDto, WorkspaceDto, WorkspaceFetchFinishedEvent,
};
use crate::state::{AppState, LiveRepoState};
use gitlibre_core::{
    inspect_repository, Account, AccountId, AuthKind, CoreError, GitAuth, RepositoryId,
    WorkspaceId,
};
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

fn snapshot_from_state(state: &AppState) -> CmdResult<AppSnapshot> {
    let store = lock_store(state)?;
    let mut accounts = Vec::with_capacity(store.list_accounts().len());
    for account in store.list_accounts() {
        let has_token = matches!(account.auth_kind, AuthKind::HttpsToken)
            && state
                .secrets
                .get_token(account.id)
                .map(|t| t.is_some())
                .unwrap_or(false);
        accounts.push(AccountDto::from_account(account.clone(), has_token));
    }
    Ok(AppSnapshot {
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
        accounts,
    })
}

fn resolve_auth_for_repo(state: &AppState, repo_id: RepositoryId) -> CmdResult<Option<GitAuth>> {
    let store = lock_store(state)?;
    let repo = store
        .get_repository(repo_id)
        .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?;
    let Some(account_id) = repo.account_id else {
        return Ok(None);
    };
    let account = store
        .get_account(account_id)
        .ok_or_else(|| AppErrorDto::from(CoreError::account_not_found()))?
        .clone();
    drop(store);

    let token = if matches!(account.auth_kind, AuthKind::HttpsToken) {
        state.secrets.get_token(account.id).map_err(AppErrorDto::from)?
    } else {
        None
    };
    Ok(GitAuth::from_account(&account, token))
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    snapshot_from_state(&state)
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
    drop(store);
    snapshot_from_state(&state)
}

#[tauri::command]
pub fn set_active_workspace(
    id: WorkspaceId,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    let mut store = lock_store(&state)?;
    store.set_active_workspace(id).map_err(AppErrorDto::from)?;
    drop(store);
    snapshot_from_state(&state)
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
    drop(store);
    snapshot_from_state(&state)
}

#[tauri::command]
pub fn create_account(
    request: CreateAccountRequest,
    state: State<'_, AppState>,
) -> CmdResult<AccountDto> {
    let account = Account {
        id: AccountId::new(),
        provider: request.provider,
        auth_kind: request.auth_kind,
        username: request.username.trim().to_string(),
        display_name: {
            let name = request.display_name.trim();
            if name.is_empty() {
                request.username.trim().to_string()
            } else {
                name.to_string()
            }
        },
        commit_name: request
            .commit_name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        commit_email: request
            .commit_email
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        ssh_private_key_path: request.ssh_private_key_path,
    };

    if matches!(account.auth_kind, AuthKind::HttpsToken) {
        let token = request
            .token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                AppErrorDto::from(CoreError::new(
                    gitlibre_core::ErrorCode::InvalidAccount,
                    "HTTPS accounts require a personal access token.",
                ))
            })?;
        state
            .secrets
            .set_token(account.id, token)
            .map_err(AppErrorDto::from)?;
    }

    let mut store = lock_store(&state)?;
    let saved = store.add_account(account).map_err(AppErrorDto::from)?;
    let has_token = matches!(saved.auth_kind, AuthKind::HttpsToken);
    Ok(AccountDto::from_account(saved, has_token))
}

#[tauri::command]
pub fn delete_account(id: AccountId, state: State<'_, AppState>) -> CmdResult<AppSnapshot> {
    {
        let mut store = lock_store(&state)?;
        store.delete_account(id).map_err(AppErrorDto::from)?;
    }
    let _ = state.secrets.delete_token(id);
    snapshot_from_state(&state)
}

#[tauri::command]
pub fn set_repository_account(
    repository_id: RepositoryId,
    account_id: Option<AccountId>,
    state: State<'_, AppState>,
) -> CmdResult<RepositoryDto> {
    let mut store = lock_store(&state)?;
    let repo = store
        .set_repository_account(repository_id, account_id)
        .map_err(AppErrorDto::from)?;
    Ok(repo.into())
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> CmdResult<Option<String>> {
    let folder = app
        .dialog()
        .file()
        .set_title("Select Git repository")
        .blocking_pick_folder();
    Ok(folder
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn pick_file(app: AppHandle) -> CmdResult<Option<String>> {
    let file = app
        .dialog()
        .file()
        .set_title("Select SSH private key")
        .blocking_pick_file();
    Ok(file
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn get_repository_status(
    id: RepositoryId,
    state: State<'_, AppState>,
) -> CmdResult<RepoStatusDto> {
    let (display_name, path, account_id) = {
        let store = lock_store(&state)?;
        let repo = store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .clone();
        (repo.display_name, repo.path, repo.account_id)
    };
    status_for_repo(&state, id, display_name, path, account_id).await
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
        out.push(
            status_for_repo(
                &state,
                repo.id,
                repo.display_name,
                repo.path,
                repo.account_id,
            )
            .await?,
        );
    }
    Ok(out)
}

async fn status_for_repo(
    state: &State<'_, AppState>,
    id: RepositoryId,
    display_name: String,
    path: PathBuf,
    account_id: Option<AccountId>,
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
            account_id,
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
            account_id,
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
            account_id,
        }),
    }
}

#[tauri::command]
pub async fn fetch_repository(
    id: RepositoryId,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .path
            .clone()
    };
    let auth = resolve_auth_for_repo(&state, id)?;

    {
        let mut live = lock_live(&state)?;
        let entry = live.entry(id).or_default();
        entry.is_fetching = true;
        entry.last_error = None;
    }

    let app_progress = app.clone();
    let outcome = state
        .coordinator
        .fetch_one_with_auth(id, &path, auth, |p| {
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
pub async fn fetch_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<WorkspaceFetchFinishedEvent> {
    let repos: Vec<(RepositoryId, PathBuf)> = {
        let store = lock_store(&state)?;
        store
            .repositories_in_active_workspace()
            .into_iter()
            .map(|r| (r.id, r.path.clone()))
            .collect()
    };

    let mut with_auth = Vec::with_capacity(repos.len());
    for (id, path) in repos {
        let auth = resolve_auth_for_repo(&state, id)?;
        with_auth.push((id, path, auth));
    }

    {
        let mut live = lock_live(&state)?;
        for (id, _, _) in &with_auth {
            let entry = live.entry(*id).or_default();
            entry.is_fetching = true;
            entry.last_error = None;
        }
    }

    let app_progress = app.clone();
    let summary = state
        .coordinator
        .fetch_many_with_auth(with_auth, move |p| {
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
