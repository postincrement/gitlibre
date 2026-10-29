use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = MenuItem::with_id(
        app,
        "settings",
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "GitLibre",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let new_workspace = MenuItem::with_id(
        app,
        "new-workspace",
        "New Workspace",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let open_workspace = MenuItem::with_id(
        app,
        "open-workspace",
        "Open Workspace",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let accounts = MenuItem::with_id(
        app,
        "accounts",
        "Accounts…",
        true,
        Some("CmdOrCtrl+Shift+A"),
    )?;

    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_workspace,
            &open_workspace,
            &PredefinedMenuItem::separator(app)?,
            &accounts,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_workspace,
            &open_workspace,
            &PredefinedMenuItem::separator(app)?,
            &accounts,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window_menu;
        Menu::with_items(app, &[&file_menu, &edit_menu])
    }
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "new-workspace" => emit_to_focused(app, "menu-new-workspace"),
        "open-workspace" => emit_to_focused(app, "menu-open-workspace"),
        "accounts" => emit_to_focused(app, "menu-accounts"),
        "settings" => emit_to_focused(app, "menu-settings"),
        _ => {}
    }
}

fn emit_to_focused(app: &AppHandle, event: &str) {
    if let Some(window) = focused_window(app) {
        let _ = window.emit(event, ());
        return;
    }
    // No focused window — open a fresh one for workspace actions only.
    if event == "menu-new-workspace" || event == "menu-open-workspace" {
        let intent = if event == "menu-new-workspace" {
            "create"
        } else {
            "open"
        };
        let _ = open_workspace_window(app, intent);
    }
}

fn focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

/// Opens a new window bound to the one-workspace-per-window paradigm.
///
/// Window labels encode the splash intent (`ws-open-…` / `ws-create-…`) so the
/// frontend can choose Open vs New without relying on fragile URL query parsing.
pub fn open_workspace_window(app: &AppHandle, intent: &str) -> tauri::Result<()> {
    let intent = match intent {
        "create" => "create",
        _ => "open",
    };
    let label = format!("ws-{intent}-{}", Uuid::new_v4());
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("GitLibre")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()?;
    Ok(())
}
