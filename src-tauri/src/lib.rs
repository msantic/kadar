//! Starts Kadar: builds the Tauri app, the menu bar and the `viewer-file://` protocol, sets up the
//! shared services (thumbnails, favorites, date-taken cache, folder watch, recorder), and lists
//! every command the window can call. It also takes files that Finder opens with Kadar and
//! queues them for the window.

mod commands;
mod export;
mod favorites;
mod formats;
mod fs_scan;
#[cfg(target_os = "macos")]
mod menu;
mod optimize;
mod platform;
mod protocol;
mod sync;
mod taken;
#[cfg(test)]
mod testutil;
mod thumbs;
mod video;
mod watch;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Builds and runs the app; returns only when Kadar quits. Panics if Tauri fails to start.
pub fn run() {
    let builder = tauri::Builder::default();
    // Only the Mac has a menu bar: every Mac app has one at the top of the screen. On Windows and
    // Linux the window maps the same keys itself (src/shortcuts.ts) and keeps its own look.
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build)
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()));
    // Windows and Linux start a new program for every "Open with Kadar". One Kadar at a time:
    // a second start hands its files to the Kadar that runs and quits (the Mac does this itself).
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        commands::hand_over(app, commands::files_from_args(args));
    }));
    builder
        // Before everything else: Finder can hand over files before the app is fully set up.
        .manage(commands::OpenedFiles::default())
        .plugin(tauri_plugin_dialog::init())
        // Reopens the window at its last size and place.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Serves local files to the page as viewer-file://viewer/<absolute path>.
        .register_asynchronous_uri_scheme_protocol("viewer-file", protocol::handle)
        .setup(|app| {
            // Windows and Linux hand files to open as start arguments ("Open with Kadar").
            #[cfg(not(target_os = "macos"))]
            if let Some(opened) = app.try_state::<commands::OpenedFiles>() {
                crate::sync::lock(&opened.0).extend(commands::files_from_args(std::env::args()));
            }
            // A dark title bar on Windows, to match Kadar's dark window.
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(Some(tauri::Theme::Dark));
            }
            let data_dir = app.path().app_data_dir()?;
            app.manage(thumbs::ThumbService::start(
                app.handle().clone(),
                data_dir.join("thumb-cache"),
            ));
            app.manage(favorites::Favorites::new(data_dir.join("viewer-favorites.json")));
            app.manage(taken::TakenDates::load(data_dir.join("date-taken-cache.json")));
            app.manage(watch::FolderWatch::default());
            app.manage(platform::recorder::Recorder::default());
            platform::recorder::set_app(app.handle().clone());
            save_window_state_on_change(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_folder,
            commands::list_tree_children,
            commands::get_roots,
            commands::platform_features,
            commands::choose_folder,
            commands::reveal_in_finder,
            commands::trash_files,
            commands::put_back,
            commands::rename_file,
            commands::taken_dates,
            commands::export_image,
            commands::image_properties,
            commands::export_save,
            commands::export_batch,
            commands::export_stop,
            commands::export_reference,
            commands::export_copy_many,
            commands::export_save_many,
            commands::export_copy,
            commands::take_opened,
            commands::open_default,
            commands::watch_folder,
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
            commands::start_drag,
            commands::copy_paths,
            commands::copy_text,
            commands::capture_running_apps,
            commands::capture_permissions,
            commands::capture_resize_window,
            commands::capture_take,
            commands::record_microphones,
            commands::record_mic_access,
            commands::record_start,
            commands::record_stop,
        ])
        .build(tauri::generate_context!())
        .expect("Kadar failed to start")
        .run(|app, event| {
            // Only the Mac sends opened files as an event; other systems pass them at start.
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
            // Files opened from Finder ("Open With", double-click, drop on the Dock icon). They
            // wait in a queue: at launch the window is not ready yet and takes them when it is.
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = event {
                let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
                commands::hand_over(app, paths);
            }
        });
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
