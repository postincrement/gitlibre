use crate::dto::{
    AccountDto, AddRepositoryResult, AppErrorDto, AppSnapshot, CmdResult, CreateAccountRequest,
    DetectedAccountDto, FetchFinishedEvent, FetchProgressEvent, PullResult, RepoStatusDto,
    RepositoryDto, UpdateAccountRequest, WorkspaceDto, WorkspaceFetchFinishedEvent,
};
use crate::state::{AppState, LiveRepoState};
use gitlibre_core::{
    checkout_revision, commit_index, create_branch_at, create_tag_at, detect_repo_account,
    detect_repo_account_from_remote, discard_paths, inspect_repository,
    list_local_branches_for_remote, push_current_branch, remove_paths, resolve_repo_path,
    stage_paths, stop_tracking_paths, unstage_paths, Account, AccountId, AuthKind, BranchInfo,
    ChangeArea, CommitIdentity, CommitOptions, CoreError, GitAuth, RepositoryId, WorkspaceId,
};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

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

fn repo_path(state: &AppState, id: RepositoryId) -> CmdResult<PathBuf> {
    let store = lock_store(state)?;
    store
        .get_repository(id)
        .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))
        .map(|r| r.path.clone())
}

/// Prefer the assigned account's commit name/email when both are set; otherwise None
/// so Git uses the repo/global identity.
fn resolve_commit_identity_for_repo(
    state: &AppState,
    repo_id: RepositoryId,
) -> CmdResult<Option<CommitIdentity>> {
    let store = lock_store(state)?;
    let repo = store
        .get_repository(repo_id)
        .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?;
    let Some(account_id) = repo.account_id else {
        return Ok(None);
    };
    let account = store
        .get_account(account_id)
        .ok_or_else(|| AppErrorDto::from(CoreError::account_not_found()))?;
    let name = account
        .commit_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let email = account
        .commit_email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if name.is_none() && email.is_none() {
        return Ok(None);
    }
    Ok(Some(CommitIdentity {
        name,
        email,
        is_local: false,
    }))
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
pub fn open_workspace_window(intent: String, app: AppHandle) -> CmdResult<()> {
    crate::menu::open_workspace_window(&app, &intent).map_err(|err| AppErrorDto {
        code: "internal".into(),
        message: format!("Failed to open workspace window: {err}"),
    })
}

#[tauri::command]
pub async fn add_repository(
    workspace_id: WorkspaceId,
    path: String,
    state: State<'_, AppState>,
) -> CmdResult<AddRepositoryResult> {
    let repo = {
        let mut store = lock_store(&state)?;
        store
            .add_repository_to_workspace(workspace_id, PathBuf::from(&path))
            .map_err(AppErrorDto::from)?
    };

    let accounts = {
        let store = lock_store(&state)?;
        store.list_accounts().to_vec()
    };

    let detection = match detect_repo_account(state.coordinator.executor(), &repo.path, &accounts)
        .await
    {
        Ok(d) => Some(d),
        Err(err) => {
            eprintln!("GitLibre: account detection failed for {}: {err}", repo.path.display());
            None
        }
    };

    let mut auto_assigned = None;
    let mut repository = RepositoryDto::from(repo.clone());

    if let Some(ref detected) = detection {
        if let Some(account_id) = detected.matched_account_id {
            let mut store = lock_store(&state)?;
            if let Ok(updated) = store.set_repository_account(repo.id, Some(account_id)) {
                repository = updated.into();
                auto_assigned = Some(account_id);
            }
        }
    }

    Ok(AddRepositoryResult {
        repository,
        detection: detection.map(DetectedAccountDto::from),
        auto_assigned_account_id: auto_assigned,
    })
}

#[tauri::command]
pub async fn detect_repository_account(
    id: RepositoryId,
    remote_name: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<DetectedAccountDto> {
    let (path, accounts) = {
        let store = lock_store(&state)?;
        let repo = store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .clone();
        (repo.path, store.list_accounts().to_vec())
    };

    let detected = detect_repo_account_from_remote(
        state.coordinator.executor(),
        &path,
        &accounts,
        remote_name.as_deref(),
    )
    .await
    .map_err(AppErrorDto::from)?;

    // If a match exists and the repo is unassigned, assign it.
    if let Some(account_id) = detected.matched_account_id {
        let mut store = lock_store(&state)?;
        if store.get_repository(id).and_then(|r| r.account_id).is_none() {
            let _ = store.set_repository_account(id, Some(account_id));
        }
    }

    Ok(detected.into())
}

#[tauri::command]
pub fn remove_repository(
    workspace_id: WorkspaceId,
    id: RepositoryId,
    state: State<'_, AppState>,
) -> CmdResult<AppSnapshot> {
    let mut store = lock_store(&state)?;
    store
        .remove_repository_from_workspace(workspace_id, id)
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
pub fn update_account(
    request: UpdateAccountRequest,
    state: State<'_, AppState>,
) -> CmdResult<AccountDto> {
    let existing = {
        let store = lock_store(&state)?;
        store
            .get_account(request.id)
            .cloned()
            .ok_or_else(|| AppErrorDto::from(CoreError::account_not_found()))?
    };

    let account = Account {
        id: request.id,
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
        ssh_private_key_path: if matches!(request.auth_kind, AuthKind::SshKey) {
            request.ssh_private_key_path
        } else {
            None
        },
    };

    let new_token = request
        .token
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());

    match account.auth_kind {
        AuthKind::HttpsToken => {
            if let Some(token) = new_token {
                state
                    .secrets
                    .set_token(account.id, token)
                    .map_err(AppErrorDto::from)?;
            } else if !matches!(existing.auth_kind, AuthKind::HttpsToken)
                || state.secrets.get_token(account.id).ok().flatten().is_none()
            {
                return Err(AppErrorDto::from(CoreError::new(
                    gitlibre_core::ErrorCode::InvalidAccount,
                    "HTTPS accounts require a personal access token.",
                )));
            }
        }
        AuthKind::SshKey => {
            // Switching away from HTTPS: drop any leftover keychain secret.
            if matches!(existing.auth_kind, AuthKind::HttpsToken) {
                let _ = state.secrets.delete_token(account.id);
            }
        }
    }

    let mut store = lock_store(&state)?;
    let saved = store.update_account(account).map_err(AppErrorDto::from)?;
    let has_token = matches!(saved.auth_kind, AuthKind::HttpsToken)
        && state.secrets.get_token(saved.id).ok().flatten().is_some();
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
    pick_ssh_key(app).await
}

/// Open a file dialog starting in `~/.ssh` so hidden-directory browsing is not required.
#[tauri::command]
pub async fn pick_ssh_key(app: AppHandle) -> CmdResult<Option<String>> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Select SSH private key");

    if let Some(ssh_dir) = ssh_dir_path() {
        if ssh_dir.is_dir() {
            dialog = dialog.set_directory(&ssh_dir);
        }
    }

    let file = dialog.blocking_pick_file();
    Ok(file
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string()))
}

/// List likely private key files in `~/.ssh` for a one-click picker.
#[tauri::command]
pub fn list_ssh_private_keys() -> CmdResult<Vec<String>> {
    let Some(ssh_dir) = ssh_dir_path() else {
        return Ok(Vec::new());
    };
    if !ssh_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut keys = Vec::new();
    let entries = std::fs::read_dir(&ssh_dir).map_err(|e| AppErrorDto {
        code: "internal".into(),
        message: format!("Could not read ~/.ssh: {e}"),
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if is_likely_ssh_private_key(&path) {
            keys.push(path.display().to_string());
        }
    }
    keys.sort();
    Ok(keys)
}

fn ssh_dir_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".ssh"))
}

fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return Some(PathBuf::from(profile));
            }
        }
    }
    None
}

fn is_likely_ssh_private_key(path: &std::path::Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.starts_with('.') {
        return false;
    }
    // Public keys, config, and known_hosts are not private keys.
    const SKIP: &[&str] = &[
        "config",
        "known_hosts",
        "known_hosts.old",
        "authorized_keys",
    ];
    if SKIP.contains(&name) || name.ends_with(".pub") {
        return false;
    }
    // Common private key names / extensions.
    name.starts_with("id_")
        || name.ends_with(".pem")
        || name.ends_with("_rsa")
        || name.ends_with("_ed25519")
        || name.ends_with("_ecdsa")
        || name == "identity"
}

#[tauri::command]
pub async fn list_repository_branches(
    id: RepositoryId,
    remote_name: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<BranchInfo>> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .path
            .clone()
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    list_local_branches_for_remote(
        state.coordinator.executor(),
        &path,
        remote_name.as_deref(),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn list_remote_branches(
    id: RepositoryId,
    remote_name: String,
    state: State<'_, AppState>,
) -> CmdResult<Vec<String>> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .path
            .clone()
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    gitlibre_core::list_remote_branches(
        state.coordinator.executor(),
        &path,
        remote_name.trim(),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn checkout_repository_revision(
    id: RepositoryId,
    revision: String,
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
    checkout_revision(
        state.coordinator.executor(),
        &path,
        revision.trim(),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn create_repository_branch(
    id: RepositoryId,
    name: String,
    revision: String,
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
    create_branch_at(
        state.coordinator.executor(),
        &path,
        name.trim(),
        revision.trim(),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn create_repository_tag(
    id: RepositoryId,
    name: String,
    revision: String,
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
    create_tag_at(
        state.coordinator.executor(),
        &path,
        name.trim(),
        revision.trim(),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn list_repository_commits(
    id: RepositoryId,
    limit: Option<u32>,
    skip: Option<u32>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<gitlibre_core::CommitInfo>> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .path
            .clone()
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    gitlibre_core::list_commits(state.coordinator.executor(), &path, limit, skip)
        .await
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn list_file_commits(
    id: RepositoryId,
    path: String,
    start_commit: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<gitlibre_core::CommitInfo>> {
    let repo_path = repo_path(&state, id)?;
    if !repo_path.exists() {
        return Ok(Vec::new());
    }
    gitlibre_core::list_file_commits(
        state.coordinator.executor(),
        &repo_path,
        path.trim(),
        start_commit
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
        limit,
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn blame_file(
    id: RepositoryId,
    path: String,
    commit: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<gitlibre_core::BlameLine>> {
    let repo_path = repo_path(&state, id)?;
    if !repo_path.exists() {
        return Ok(Vec::new());
    }
    gitlibre_core::blame_file(
        state.coordinator.executor(),
        &repo_path,
        path.trim(),
        commit
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn list_commit_files(
    id: RepositoryId,
    commit: String,
    state: State<'_, AppState>,
) -> CmdResult<Vec<gitlibre_core::CommitFileChange>> {
    let path = {
        let store = lock_store(&state)?;
        store
            .get_repository(id)
            .ok_or_else(|| AppErrorDto::from(CoreError::repository_not_found()))?
            .path
            .clone()
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    gitlibre_core::list_commit_files(
        state.coordinator.executor(),
        &path,
        commit.trim(),
    )
    .await
    .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn get_commit_file_diff(
    id: RepositoryId,
    commit: String,
    path: String,
    old_path: Option<String>,
    area: Option<ChangeArea>,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let repo_path = repo_path(&state, id)?;
    if !repo_path.exists() {
        return Ok(String::new());
    }
    gitlibre_core::get_commit_file_diff_with_old_path(
        state.coordinator.executor(),
        &repo_path,
        commit.trim(),
        path.trim(),
        old_path.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        area,
    )
    .await
    .map_err(AppErrorDto::from)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewDto {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewPairDto {
    pub before: Option<FilePreviewDto>,
    pub after: Option<FilePreviewDto>,
}

#[tauri::command]
pub async fn get_commit_file_preview(
    id: RepositoryId,
    commit: String,
    path: String,
    old_path: Option<String>,
    area: Option<ChangeArea>,
    status: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<FilePreviewPairDto> {
    let repo_path = repo_path(&state, id)?;
    if !repo_path.exists() {
        return Err(AppErrorDto::from(CoreError::path_not_found(
            repo_path.display(),
        )));
    }
    let trimmed_path = path.trim();
    let trimmed_old = old_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let pair = gitlibre_core::get_commit_file_bytes_pair(
        state.coordinator.executor(),
        &repo_path,
        commit.trim(),
        trimmed_path,
        trimmed_old,
        area,
        status.as_deref().unwrap_or("M"),
    )
    .await
    .map_err(AppErrorDto::from)?;

    use base64::Engine;
    let encode = |bytes: Vec<u8>, mime_path: &str| FilePreviewDto {
        mime_type: mime_type_for_path(mime_path),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    };

    Ok(FilePreviewPairDto {
        before: pair
            .before
            .map(|b| encode(b, trimmed_old.unwrap_or(trimmed_path))),
        after: pair.after.map(|b| encode(b, trimmed_path)),
    })
}

fn mime_type_for_path(path: &str) -> String {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command(rename = "stage_paths")]
pub async fn stage_repository_paths(
    id: RepositoryId,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let path = repo_path(&state, id)?;
    let executor = state.coordinator.executor().clone();
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            let paths = paths.clone();
            async move {
                stage_paths(&executor, &path, &paths)
                    .await
                    .map_err(AppErrorDto::from)
            }
        })
        .await
}

#[tauri::command(rename = "unstage_paths")]
pub async fn unstage_repository_paths(
    id: RepositoryId,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let path = repo_path(&state, id)?;
    let executor = state.coordinator.executor().clone();
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            let paths = paths.clone();
            async move {
                unstage_paths(&executor, &path, &paths)
                    .await
                    .map_err(AppErrorDto::from)
            }
        })
        .await
}

#[tauri::command(rename = "discard_paths")]
pub async fn discard_repository_paths(
    id: RepositoryId,
    paths: Vec<String>,
    area: ChangeArea,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let path = repo_path(&state, id)?;
    let executor = state.coordinator.executor().clone();
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            let paths = paths.clone();
            async move {
                discard_paths(&executor, &path, &paths, area)
                    .await
                    .map_err(AppErrorDto::from)
            }
        })
        .await
}

#[tauri::command(rename = "remove_paths")]
pub async fn remove_repository_paths(
    id: RepositoryId,
    paths: Vec<String>,
    area: ChangeArea,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let path = repo_path(&state, id)?;
    let executor = state.coordinator.executor().clone();
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            let paths = paths.clone();
            async move {
                remove_paths(&executor, &path, &paths, area)
                    .await
                    .map_err(AppErrorDto::from)
            }
        })
        .await
}

#[tauri::command(rename = "stop_tracking_paths")]
pub async fn stop_tracking_repository_paths(
    id: RepositoryId,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let path = repo_path(&state, id)?;
    let executor = state.coordinator.executor().clone();
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            let paths = paths.clone();
            async move {
                stop_tracking_paths(&executor, &path, &paths)
                    .await
                    .map_err(AppErrorDto::from)
            }
        })
        .await
}

#[tauri::command]
pub fn resolve_repository_file_path(
    id: RepositoryId,
    path: String,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let repo = repo_path(&state, id)?;
    let abs = resolve_repo_path(&repo, &path).map_err(AppErrorDto::from)?;
    Ok(abs.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_repository_file(
    id: RepositoryId,
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let repo = repo_path(&state, id)?;
    let abs = resolve_repo_path(&repo, &path).map_err(AppErrorDto::from)?;
    if !abs.exists() {
        return Err(AppErrorDto::from(CoreError::path_not_found(
            abs.display(),
        )));
    }
    app.opener()
        .open_path(abs.to_string_lossy(), None::<&str>)
        .map_err(|err| AppErrorDto {
            code: "process_failed".into(),
            message: format!("Failed to open file: {err}"),
        })
}

#[tauri::command]
pub fn reveal_repository_file(
    id: RepositoryId,
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let repo = repo_path(&state, id)?;
    let abs = resolve_repo_path(&repo, &path).map_err(AppErrorDto::from)?;
    if !abs.exists() {
        return Err(AppErrorDto::from(CoreError::path_not_found(
            abs.display(),
        )));
    }
    app.opener().reveal_item_in_dir(&abs).map_err(|err| AppErrorDto {
        code: "process_failed".into(),
        message: format!("Failed to reveal file: {err}"),
    })
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequestOptions {
    #[serde(default)]
    pub amend: bool,
    #[serde(default)]
    pub sign_off: bool,
    #[serde(default)]
    pub sign_commit: bool,
    #[serde(default)]
    pub no_verify: bool,
}

#[tauri::command]
pub async fn commit_repository(
    id: RepositoryId,
    message: String,
    amend: Option<bool>,
    options: Option<CommitRequestOptions>,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let path = repo_path(&state, id)?;
    let identity = resolve_commit_identity_for_repo(&state, id)?;
    let executor = state.coordinator.executor().clone();
    let opts = options.unwrap_or(CommitRequestOptions {
        amend: amend.unwrap_or(false),
        sign_off: false,
        sign_commit: false,
        no_verify: false,
    });
    let commit_opts = CommitOptions {
        amend: opts.amend || amend.unwrap_or(false),
        sign_off: opts.sign_off,
        sign_commit: opts.sign_commit,
        no_verify: opts.no_verify,
    };
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            async move {
                commit_index(
                    &executor,
                    &path,
                    &message,
                    commit_opts,
                    identity.as_ref(),
                )
                .await
                .map_err(AppErrorDto::from)
            }
        })
        .await
}

#[tauri::command]
pub async fn read_head_commit_message(
    id: RepositoryId,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let path = repo_path(&state, id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    gitlibre_core::read_head_commit_message(state.coordinator.executor(), &path)
        .await
        .map_err(AppErrorDto::from)
}

#[tauri::command]
pub async fn push_repository(
    id: RepositoryId,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let path = repo_path(&state, id)?;
    let auth = resolve_auth_for_repo(&state, id)?;
    let executor = state.coordinator.executor().clone();
    state
        .coordinator
        .with_repo_lock(&path, || {
            let path = path.clone();
            async move {
                push_current_branch(&executor, &path, auth.as_ref())
                    .await
                    .map_err(AppErrorDto::from)
            }
        })
        .await
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
    workspace_id: WorkspaceId,
    state: State<'_, AppState>,
) -> CmdResult<Vec<RepoStatusDto>> {
    let repos: Vec<_> = {
        let store = lock_store(&state)?;
        store
            .repositories_in_workspace(workspace_id)
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
            commit_name: None,
            commit_email: None,
            commit_identity_is_local: false,
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
            commit_name: info.commit_name,
            commit_email: info.commit_email,
            commit_identity_is_local: info.commit_identity_is_local,
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
            commit_name: None,
            commit_email: None,
            commit_identity_is_local: false,
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
pub async fn pull_repository(
    id: RepositoryId,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<PullResult> {
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
        .pull_one_with_auth(id, &path, auth, |p| {
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

    let error = outcome.error.map(AppErrorDto::from);
    let _ = app.emit(
        "repo-fetch-finished",
        FetchFinishedEvent {
            repository_id: outcome.repository_id,
            success: outcome.success,
            summary: outcome.summary.clone(),
            error: error.clone(),
        },
    );

    Ok(PullResult {
        repository_id: outcome.repository_id,
        success: outcome.success,
        summary: outcome.summary,
        has_conflicts: outcome.has_conflicts,
        conflicted_paths: outcome.conflicted_paths,
        error,
    })
}

#[tauri::command]
pub async fn fetch_workspace(
    workspace_id: WorkspaceId,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<WorkspaceFetchFinishedEvent> {
    let repos: Vec<(RepositoryId, PathBuf)> = {
        let store = lock_store(&state)?;
        store
            .repositories_in_workspace(workspace_id)
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
