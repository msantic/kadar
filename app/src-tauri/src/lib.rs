mod commands;
mod favorites;
mod formats;
mod fs_scan;
mod macos;
mod protocol;
mod thumbs;
mod watch;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("Kadar failed to start");
}
