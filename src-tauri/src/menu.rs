//! The menu bar: every command with its key, as in any Mac app. A click on an item sends its id
//! to the window ("menu" event), which runs the same code as the key.
//!
//! The window handles most keys itself and marks them handled; WebKit then does not pass them on
//! to the menu, so one key press never runs twice. The menu catches the keys the window does not
//! handle, for example ⌘1–⌘4, or ⌘E while you type in the filter field.

use tauri::menu::{Menu, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

use crate::platform::system;

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, text: &str, key: Option<&str>) -> tauri::Result<MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, text);
    if let Some(k) = key {
        b = b.accelerator(k);
    }
    b.build(app)
}

/// Builds the whole menu bar: Kadar, File, Edit, View (with Sort By), Go and Window.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "Kadar")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(app, "open-folder", "Open Folder…", None)?)
        .item(&item(app, "open-default", "Open in Default App", Some("CmdOrCtrl+O"))?)
        .item(&item(app, "reveal", &format!("Show in {}", system::FILE_MANAGER), Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(app, "export", "Export for Web…", Some("CmdOrCtrl+E"))?)
        .item(&item(app, "optimize", "Optimize", Some("Shift+CmdOrCtrl+O"))?)
        .separator()
        .item(&item(app, "rename", "Rename (Return)", None)?)
        .item(&item(app, "trash", &format!("Move to {}", system::TRASH), Some("CmdOrCtrl+Backspace"))?)
        .separator()
        .close_window()
        .build()?;

    // Undo, Copy and Select All are Kadar's own items, so a click with the mouse acts on files
    // too. In a text field the window does the text action instead (see src/main.ts). Redo, Cut
    // and Paste stay the Mac's standard items: they only ever act on text.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app, "undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .redo()
        .separator()
        .cut()
        .item(&item(app, "copy", "Copy", Some("CmdOrCtrl+C"))?)
        .paste()
        .item(&item(app, "copy-paths", "Copy Path", Some("Shift+CmdOrCtrl+C"))?)
        .separator()
        .item(&item(app, "select-all", "Select All", Some("CmdOrCtrl+A"))?)
        .item(&item(app, "filter", "Filter by Name", Some("CmdOrCtrl+F"))?)
        .build()?;

    let sort: Submenu<R> = SubmenuBuilder::new(app, "Sort By")
        .item(&item(app, "sort:name", "Name", None)?)
        .item(&item(app, "sort:taken", "Date Taken", None)?)
        .item(&item(app, "sort:modified", "Date Modified", None)?)
        .item(&item(app, "sort:created", "Date Created", None)?)
        .item(&item(app, "sort:size", "Size", None)?)
        .item(&item(app, "sort:type", "Kind", None)?)
        .separator()
        .item(&item(app, "sort:reverse", "Reverse Order", None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "tab:viewer", "Viewer", Some("CmdOrCtrl+1"))?)
        .item(&item(app, "tab:optimize", "Optimize", Some("CmdOrCtrl+2"))?)
        .item(&item(app, "tab:record", "Record", Some("CmdOrCtrl+3"))?)
        .item(&item(app, "tab:screenshot", "Screenshot", Some("CmdOrCtrl+4"))?)
        .separator()
        .item(&sort)
        .item(&item(app, "zoom-in", "Bigger Thumbnails", Some("CmdOrCtrl+="))?)
        .item(&item(app, "zoom-out", "Smaller Thumbnails", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&item(app, "info", "Show Info", Some("CmdOrCtrl+I"))?)
        .separator()
        .fullscreen()
        .build()?;

    let go = SubmenuBuilder::new(app, "Go")
        .item(&item(app, "go:back", "Back", Some("CmdOrCtrl+["))?)
        .item(&item(app, "go:forward", "Forward", Some("CmdOrCtrl+]"))?)
        .item(&item(app, "go:up", "Enclosing Folder", Some("CmdOrCtrl+Up"))?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &go, &window])
}

/// Sends a clicked menu item to the window.
pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id.to_string());
}
