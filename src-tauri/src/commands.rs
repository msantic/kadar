//! Commands the page calls. Each one matches a method on `window.viewer` in the page.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::capture;
use crate::favorites::{Favorite, Favorites};
use crate::formats::{kind_of, Kind};
use crate::fs_scan::{self, FolderEntry, FolderListing};
use crate::macos;
use crate::recorder::{self, Recorder};
use crate::optimize;
use crate::thumbs::{FileInfo, RequestResult, ThumbService};
use crate::watch::FolderWatch;

#[tauri::command(async)]
pub fn list_folder(dir_path: String) -> FolderListing {
    fs_scan::list_folder(&dir_path)
}

#[tauri::command(async)]
pub fn list_tree_children(dir_path: String) -> Vec<FolderEntry> {
    fs_scan::list_tree_children(&dir_path)
}

#[derive(Serialize)]
pub struct Roots {
    home: String,
    pictures: String,
    desktop: String,
    downloads: String,
    movies: String,
}

#[tauri::command]
pub fn get_roots(app: AppHandle) -> Roots {
    let p = app.path();
    let s = |r: tauri::Result<std::path::PathBuf>| {
        r.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
    };
    Roots {
        home: s(p.home_dir()),
        pictures: s(p.picture_dir()),
        desktop: s(p.desktop_dir()),
        downloads: s(p.download_dir()),
        movies: s(p.video_dir()),
    }
}

#[tauri::command(async)]
pub fn choose_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) {
    let _ = Command::new("open").arg("-R").arg(path).spawn();
}

/// Opens the file in its default app. Returns an error message, or "" on success.
#[tauri::command(async)]
pub fn open_default(path: String) -> String {
    match Command::new("open").arg(path).status() {
        Ok(s) if s.success() => String::new(),
        Ok(_) => "No app can open this file.".into(),
        Err(e) => e.to_string(),
    }
}

#[tauri::command]
pub fn watch_folder(app: AppHandle, watch: State<'_, FolderWatch>, path: String) {
    watch.watch(app, path);
}

#[tauri::command]
pub fn unwatch_folder(watch: State<'_, FolderWatch>) {
    watch.unwatch();
}

#[tauri::command(async)]
pub fn thumb_request(
    thumbs: State<'_, ThumbService>,
    request_id: String,
    files: Vec<FileInfo>,
    target_size: u32,
) -> RequestResult {
    thumbs.request(request_id, files, target_size)
}

#[tauri::command]
pub fn thumb_cancel(thumbs: State<'_, ThumbService>, request_id: String) {
    thumbs.cancel(&request_id);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<f64>,
    size_bytes: u64,
    mtime_ms: f64,
}

#[tauri::command(async)]
pub fn meta_get(file_path: String) -> Result<FileMetadata, String> {
    let meta = std::fs::metadata(&file_path).map_err(|e| e.to_string())?;
    let mut out = FileMetadata {
        width: None,
        height: None,
        duration_ms: None,
        size_bytes: meta.len(),
        mtime_ms: fs_scan::mtime_ms(&meta),
    };
    let path = Path::new(&file_path);
    match kind_of(&file_path) {
        Kind::Image => {
            if let Some((w, h)) = macos::image_size(path) {
                out.width = Some(w);
                out.height = Some(h);
            }
        }
        Kind::Video => out.duration_ms = macos::video_duration_ms(path),
        Kind::Unsupported => {}
    }
    Ok(out)
}

#[tauri::command]
pub fn fav_list(favs: State<'_, Favorites>) -> Vec<Favorite> {
    favs.list()
}

#[tauri::command]
pub fn fav_add(favs: State<'_, Favorites>, path: String) -> Favorite {
    favs.add(path)
}

#[tauri::command]
pub fn fav_remove(favs: State<'_, Favorites>, id: String) {
    favs.remove(&id);
}

#[tauri::command]
pub fn fav_rename(favs: State<'_, Favorites>, id: String, label: String) -> Option<Favorite> {
    favs.rename(&id, label)
}

/// Dropped files and folders → the files the optimizer will process, in order.
#[tauri::command(async)]
pub fn optimize_expand(paths: Vec<String>) -> Vec<String> {
    optimize::expand(&paths)
}

/// Optimizes `files`, reporting each step as a "file-progress" event. Returns when all are done.
#[tauri::command(async)]
pub fn optimize_files(app: AppHandle, files: Vec<String>, options: optimize::Options) {
    optimize::run(&app, files, &options);
}

#[tauri::command]
pub fn open_in_finder(path: String) {
    let _ = Command::new("open").arg(path).spawn();
}

/// Opens a web page or a System Settings pane. Other schemes are refused.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let allowed = ["https://", "http://", "x-apple.systempreferences:"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err("refused".into());
    }
    Command::new("open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn capture_running_apps() -> Vec<String> {
    capture::running_apps()
}

#[tauri::command]
pub fn capture_permissions() -> capture::Permissions {
    capture::permissions()
}

#[tauri::command(async)]
pub fn capture_resize_window(app: String, width: i32, height: i32, x: Option<i32>, y: Option<i32>) -> Result<(), String> {
    capture::resize_window(&app, width, height, x.unwrap_or(0), y.unwrap_or(0))
}

#[tauri::command(async)]
pub fn capture_take(options: capture::ShotOptions) -> Result<String, String> {
    capture::take(&options)
}

#[tauri::command(async)]
pub fn record_microphones() -> Vec<recorder::Microphone> {
    recorder::microphones()
}

/// Asks macOS for microphone access the first time; then reports "granted" or "denied".
#[tauri::command(async)]
pub fn record_mic_access() -> &'static str {
    recorder::microphone_access()
}

#[tauri::command(async)]
pub fn record_start(rec: State<'_, Recorder>, options: recorder::RecordOptions) -> Result<(), String> {
    rec.start(options)
}

/// Stops and saves. Reports saving progress as "record-progress" events (0–99).
#[tauri::command(async)]
pub fn record_stop(app: AppHandle, rec: State<'_, Recorder>) -> Result<String, String> {
    use tauri::Emitter;
    rec.stop(&|p| {
        let _ = app.emit("record-progress", p);
    })
}
