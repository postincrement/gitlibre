mod commands;
mod dto;
mod menu;
mod state;

use gitlibre_core::{ConfigStore, GitExecutor};
use state::AppState;
use std::fs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app config dir");
            fs::create_dir_all(&config_dir).expect("failed to create app config dir");
            let config_path = config_dir.join("config.json");

            let store = ConfigStore::open(config_path).expect("failed to open config store");
            let executor = match GitExecutor::from_path() {
                Ok(executor) => executor,
                Err(err) => {
                    eprintln!("GitLibre warning: {err}");
                    GitExecutor::from_explicit_path(std::path::PathBuf::from("git"))
                }
            };

            app.manage(AppState::new(store, executor));

            let app_menu = menu::build_menu(app.handle())?;
            app.set_menu(app_menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(&app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::create_workspace,
            commands::delete_workspace,
            commands::set_active_workspace,
            commands::open_workspace_window,
            commands::add_repository,
            commands::remove_repository,
            commands::detect_repository_account,
            commands::create_account,
            commands::update_account,
            commands::delete_account,
            commands::set_repository_account,
            commands::pick_directory,
            commands::pick_file,
            commands::pick_ssh_key,
            commands::list_ssh_private_keys,
            commands::get_repository_status,
            commands::list_repository_branches,
            commands::list_remote_branches,
            commands::list_repository_commits,
            commands::list_file_commits,
            commands::blame_file,
            commands::list_commit_files,
            commands::get_commit_file_diff,
            commands::get_commit_file_preview,
            commands::stage_repository_paths,
            commands::unstage_repository_paths,
            commands::discard_repository_paths,
            commands::remove_repository_paths,
            commands::stop_tracking_repository_paths,
            commands::resolve_repository_file_path,
            commands::open_repository_file,
            commands::reveal_repository_file,
            commands::commit_repository,
            commands::read_head_commit_message,
            commands::push_repository,
            commands::list_workspace_statuses,
            commands::fetch_repository,
            commands::pull_repository,
            commands::fetch_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitLibre");
}
