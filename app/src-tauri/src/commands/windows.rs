//! Tauri commands for OS window/process information.
//!
//! Used by the per-program rewrite prompt profiles UI.

use crate::windows_apps;

/// List currently open top-level windows.
///
/// Returns window title + executable path.
#[tauri::command]
pub fn list_open_windows() -> Vec<windows_apps::OpenWindowInfo> {
    windows_apps::list_open_windows()
}

/// Get the executable path of the current foreground process (active window).
#[tauri::command]
pub fn get_foreground_process_path() -> Option<String> {
    windows_apps::get_foreground_process_path()
}
