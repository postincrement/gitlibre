mod commands;
mod dto;
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::create_workspace,
            commands::delete_workspace,
            commands::set_active_workspace,
            commands::add_repository,
            commands::remove_repository,
            commands::detect_repository_account,
            commands::create_account,
            commands::delete_account,
            commands::set_repository_account,
            commands::pick_directory,
            commands::pick_file,
            commands::pick_ssh_key,
            commands::list_ssh_private_keys,
            commands::get_repository_status,
            commands::list_workspace_statuses,
            commands::fetch_repository,
            commands::fetch_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitLibre");
}
