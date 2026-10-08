mod capture;
mod clipboard;
mod commands;
mod favorites;
mod formats;
mod fs_scan;
mod macos;
mod optimize;
mod protocol;
mod recorder;
mod thumbs;
mod video;
mod watch;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Drag thumbnails out of the window as real files.
        .plugin(tauri_plugin_drag::init())
        // Reopens the window at its last size and place.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Serves local files to the page as viewer-file://viewer/<absolute path>.
        .register_asynchronous_uri_scheme_protocol("viewer-file", protocol::handle)
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(thumbs::ThumbService::start(
                app.handle().clone(),
                data_dir.join("thumb-cache"),
            ));
            app.manage(favorites::Favorites::new(data_dir.join("viewer-favorites.json")));
            app.manage(watch::FolderWatch::default());
            app.manage(recorder::Recorder::default());
            save_window_state_on_change(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_folder,
            commands::list_tree_children,
            commands::get_roots,
            commands::choose_folder,
            commands::reveal_in_finder,
            commands::open_default,
            commands::watch_folder,
            commands::unwatch_folder,
            commands::thumb_request,
            commands::thumb_cancel,
            commands::meta_get,
            commands::fav_list,
            commands::fav_add,
            commands::fav_remove,
            commands::fav_rename,
            commands::optimize_expand,
            commands::optimize_files,
            commands::open_in_finder,
            commands::open_external,
            commands::copy_files,
            commands::copy_paths,
            commands::capture_running_apps,
            commands::capture_permissions,
            commands::capture_resize_window,
            commands::capture_take,
            commands::record_microphones,
            commands::record_mic_access,
            commands::record_start,
            commands::record_stop,
        ])
        .run(tauri::generate_context!())
        .expect("Kadar failed to start");
}

/// The window-state add-on saves only on a normal quit. Also save half a second after each move
/// or resize, so a crash or a forced quit keeps the window where it was.
fn save_window_state_on_change(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let generation = Arc::new(AtomicU64::new(0));
    let app = app.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (generation, app) = (generation.clone(), app.clone());
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            if generation.load(Ordering::SeqCst) == mine {
                let _ = app.save_window_state(StateFlags::all());
            }
        });
    });
}
