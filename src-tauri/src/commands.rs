//! Commands the page calls with `invoke`. Most back a method on `window.viewer` or
//! `window.optimizer` (see `src/bridge.ts`); the optimizer, recorder and file-open code call
//! theirs directly. Each command is thin and hands the work to its module.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::capture;
use crate::clipboard;
use crate::favorites::{Favorite, Favorites};
use crate::formats::{kind_of, Kind};
use crate::fs_scan::{self, FolderEntry, FolderListing};
use crate::macos;
use crate::recorder::{self, Recorder};
use crate::optimize;
use crate::thumbs::{FileInfo, RequestResult, ThumbService};
use crate::watch::FolderWatch;

/// The subfolders and images/videos of a folder, sorted by name. Empty when it cannot be read.
#[tauri::command(async)]
pub fn list_folder(dir_path: String) -> FolderListing {
    fs_scan::list_folder(&dir_path)
}

/// The subfolders of a folder, for the sidebar tree.
#[tauri::command(async)]
pub fn list_tree_children(dir_path: String) -> Vec<FolderEntry> {
    fs_scan::list_tree_children(&dir_path)
}

/// The user's standard folders for the sidebar. A folder the Mac does not report is "".
#[derive(Serialize)]
pub struct Roots {
    home: String,
    pictures: String,
    desktop: String,
    downloads: String,
    movies: String,
}

/// Home, Pictures, Desktop, Downloads and Movies as full paths.
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

/// Shows the Mac folder picker and waits. Returns the chosen path, or null when cancelled.
#[tauri::command(async)]
pub fn choose_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Moves files to the Trash, as Finder does ("Put Back" works there too). Returns, per moved
/// file, [where it was, where it is in the Trash], so Undo can put it back.
#[tauri::command(async)]
pub fn trash_files(paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let fm = NSFileManager::defaultManager();
    let mut moved = Vec::new();
    let mut last_error = None;
    for path in &paths {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let mut in_trash = None;
        match fm.trashItemAtURL_resultingItemURL_error(&url, Some(&mut in_trash)) {
            Ok(()) => {
                let trashed = in_trash.and_then(|u| u.path()).map(|p| p.to_string());
                if let Some(t) = trashed {
                    moved.push((path.clone(), t));
                }
            }
            Err(e) => last_error = Some(e.localizedDescription().to_string()),
        }
    }
    match last_error {
        Some(e) if moved.is_empty() => Err(e),
        _ => Ok(moved),
    }
}

/// Undo of Move to Trash: moves each file from the Trash back to where it was. A file never
/// replaces another one with the same name there. Returns the paths put back.
#[tauri::command(async)]
pub fn put_back(pairs: Vec<(String, String)>) -> Result<Vec<String>, String> {
    let mut back = Vec::new();
    let mut last_error = None;
    for (original, trashed) in pairs {
        if Path::new(&original).exists() {
            last_error = Some(format!("\"{original}\" already exists."));
            continue;
        }
        match std::fs::rename(&trashed, &original) {
            Ok(()) => back.push(original),
            Err(e) => last_error = Some(e.to_string()),
        }
    }
    match last_error {
        Some(e) if back.is_empty() => Err(e),
        _ => Ok(back),
    }
}

/// Renames a file in its folder. Returns the new path. Refuses names with "/" and names that
/// another file already has (a change of upper/lower case only is allowed).
#[tauri::command(async)]
pub fn rename_file(path: String, new_name: String) -> Result<String, String> {
    let name = new_name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err("This name is not allowed.".into());
    }
    let src = Path::new(&path);
    let dest = src.parent().ok_or("No folder")?.join(name);
    if dest == src {
        return Ok(path);
    }
    // On the Mac, "Photo.jpg" and "photo.jpg" are the same file: then the rename only changes case.
    let same_file = dest.exists()
        && std::fs::canonicalize(&dest).ok() == std::fs::canonicalize(src).ok()
        && dest.to_string_lossy().to_lowercase() == src.to_string_lossy().to_lowercase();
    if dest.exists() && !same_file {
        return Err(format!("\"{name}\" already exists in this folder."));
    }
    std::fs::rename(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Camera dates for the "Date Taken" sort, in the same order as `files`.
#[tauri::command(async)]
pub fn taken_dates(taken: State<'_, crate::taken::TakenDates>, files: Vec<crate::taken::FileStamp>) -> Vec<Option<f64>> {
    taken.get(files)
}

/// "Export for web": makes the result for these settings and returns its size and temp path.
#[tauri::command(async)]
pub fn export_image(app: AppHandle, path: String, options: crate::export::ExportOptions) -> Result<crate::export::ExportResult, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("export");
    crate::export::export(&path, &options, &dir)
}

/// Exports many images with the same settings. Reports "export-progress" { run, done, total }.
/// A newer `run` stops an older one.
#[tauri::command(async)]
pub fn export_batch(
    app: AppHandle,
    paths: Vec<String>,
    options: crate::export::ExportOptions,
    run: u64,
) -> Result<Vec<crate::export::BatchItem>, String> {
    use tauri::Emitter;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("export-batch");
    crate::export::export_batch(&paths, &options, &dir, run, &|done, total| {
        let _ = app.emit("export-progress", serde_json::json!({ "run": run, "done": done, "total": total }));
    })
}

/// Copies many export results to the clipboard as files.
#[tauri::command(async)]
pub fn export_copy_many(app: AppHandle, results: Vec<String>) -> Result<(), String> {
    clipboard::copy_files(&app, results)
}

/// Saves results next to their sources ("optimized" folders). Pairs are [source, result].
#[tauri::command(async)]
pub fn export_save_many(pairs: Vec<(String, String)>) -> Result<Vec<String>, String> {
    pairs.iter().map(|(source, result)| crate::export::save_next_to(source, result)).collect()
}

/// The uncompressed counterpart of an export result, for the Compare view.
#[tauri::command(async)]
pub fn export_reference(app: AppHandle, path: String, options: crate::export::ExportOptions) -> Result<crate::export::ExportResult, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("export-reference");
    crate::export::export_reference(&path, &options, &dir)
}

/// Saves an export result into the "optimized" folder next to the source. Returns its path.
#[tauri::command(async)]
pub fn export_save(source: String, result: String) -> Result<String, String> {
    crate::export::save_next_to(&source, &result)
}

/// Copies an export result: the file, plus its picture for pasting into web pages.
#[tauri::command(async)]
pub fn export_copy(app: AppHandle, result: String) -> Result<(), String> {
    clipboard::copy_files(&app, vec![result])
}

/// All header details of an image, for the info panel; null for files the Mac cannot read.
#[tauri::command(async)]
pub fn image_properties(path: String) -> Option<serde_json::Value> {
    macos::image_properties(Path::new(&path))
}

/// Files that Finder asked Kadar to open, not yet shown.
#[derive(Default)]
pub struct OpenedFiles(pub std::sync::Mutex<Vec<String>>);

/// One opened path, and whether it is a folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedItem {
    path: String,
    is_dir: bool,
}

/// Hands the waiting opened files to the window, once.
#[tauri::command]
pub fn take_opened(opened: State<'_, OpenedFiles>) -> Vec<OpenedItem> {
    std::mem::take(&mut *crate::sync::lock(&opened.0))
        .into_iter()
        .map(|path| OpenedItem { is_dir: Path::new(&path).is_dir(), path })
        .collect()
}

/// Shows the file selected in a Finder window. Does not wait; errors are ignored.
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

/// Starts watching the shown folder for changes; replaces any earlier watch.
#[tauri::command]
pub fn watch_folder(app: AppHandle, watch: State<'_, FolderWatch>, path: String) {
    watch.watch(app, path);
}

/// Stops watching the folder.
#[tauri::command]
pub fn unwatch_folder(watch: State<'_, FolderWatch>) {
    watch.unwatch();
}

/// Asks for thumbnails of a batch of files. Returns the cached ones now; the rest arrive as
/// "viewer:thumb:ready" events.
#[tauri::command(async)]
pub fn thumb_request(
    thumbs: State<'_, ThumbService>,
    request_id: String,
    files: Vec<FileInfo>,
    target_size: u32,
) -> RequestResult {
    thumbs.request(request_id, files, target_size)
}

/// Drops the thumbnails of this request that are not made yet.
#[tauri::command]
pub fn thumb_cancel(thumbs: State<'_, ThumbService>, request_id: String) {
    thumbs.cancel(&request_id);
}

/// Size and dimensions for the info panel. Width and height are in pixels and only for images;
/// the duration (ms) only for videos. Missing values are left out.
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

/// File size, modified time and image size or video length. Error when the file is gone.
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

/// All favorite folders.
#[tauri::command]
pub fn fav_list(favs: State<'_, Favorites>) -> Vec<Favorite> {
    favs.list()
}

/// Adds a favorite folder and returns it (the existing one if the folder is already there).
#[tauri::command]
pub fn fav_add(favs: State<'_, Favorites>, path: String) -> Favorite {
    favs.add(path)
}

/// Removes a favorite by its id.
#[tauri::command]
pub fn fav_remove(favs: State<'_, Favorites>, id: String) {
    favs.remove(&id);
}

/// Changes a favorite's label. Returns the changed favorite, or null for an unknown id.
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

/// Opens the path with `open`: a folder opens in Finder, a file in its default app. Does not
/// wait; errors are ignored.
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

/// Names of the apps with a window on screen, for the app picker.
#[tauri::command(async)]
pub fn capture_running_apps() -> Vec<String> {
    capture::running_apps()
}

/// Screen Recording state; asks macOS the first time.
#[tauri::command]
pub fn capture_permissions() -> capture::Permissions {
    capture::permissions()
}

/// Moves and resizes the app's front window (screen points; missing x or y means 0). The error
/// is the AppleScript message, for example when Accessibility access is missing.
#[tauri::command(async)]
pub fn capture_resize_window(app: String, width: i32, height: i32, x: Option<i32>, y: Option<i32>) -> Result<(), String> {
    capture::resize_window(&app, width, height, x.unwrap_or(0), y.unwrap_or(0))
}

/// Takes a screenshot of the app's largest window. Returns the saved file's path.
#[tauri::command(async)]
pub fn capture_take(options: capture::ShotOptions) -> Result<String, String> {
    capture::take(&options)
}

/// The microphones the Mac has, for the recorder's picker.
#[tauri::command(async)]
pub fn record_microphones() -> Vec<recorder::Microphone> {
    recorder::microphones()
}

/// Asks macOS for microphone access the first time; then reports "granted" or "denied".
#[tauri::command(async)]
pub fn record_mic_access() -> &'static str {
    recorder::microphone_access()
}

/// Starts a screen recording. Returns once recording runs, or an error to show.
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

/// Drags files out of Kadar (into Finder, browsers, chats), as Finder does.
#[tauri::command(async)]
pub fn start_drag(window: tauri::WebviewWindow, paths: Vec<String>, icon: String) -> Result<(), String> {
    crate::drag::start(&window, paths, icon)
}

/// Cmd+C: copies the files (and the picture of a single image) to the clipboard.
#[tauri::command(async)]
pub fn copy_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    clipboard::copy_files(&app, paths)
}

/// Shift+Cmd+C: copies the full paths, one per line.
#[tauri::command(async)]
pub fn copy_paths(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    clipboard::copy_paths(&app, paths)
}

#[cfg(test)]
mod tests {
    use super::rename_file;

    #[test]
    fn rename_rules() {
        let dir = crate::testutil::temp_dir("rename");
        let a = dir.join("a.jpg");
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(dir.join("taken.jpg"), b"t").unwrap();
        let a = a.to_string_lossy().into_owned();

        assert!(rename_file(a.clone(), "x/y.jpg".into()).is_err(), "no slash");
        assert!(rename_file(a.clone(), "  ".into()).is_err(), "no empty name");
        assert!(rename_file(a.clone(), "taken.jpg".into()).is_err(), "never replaces another file");
        let b = rename_file(a.clone(), " b.jpg ".into()).unwrap();
        assert!(b.ends_with("/b.jpg") && std::path::Path::new(&b).is_file());
        let upper = rename_file(b, "B.jpg".into()).unwrap();
        assert!(upper.ends_with("/B.jpg"), "a change of case only is allowed");
    }

    #[test]
    fn put_back_moves_files_home_and_never_replaces() {
        let dir = crate::testutil::temp_dir("put-back");
        let away = dir.join("away");
        std::fs::create_dir(&away).unwrap();
        std::fs::write(away.join("a.jpg"), b"a").unwrap();
        std::fs::write(away.join("b.jpg"), b"b").unwrap();
        std::fs::write(dir.join("b.jpg"), b"other").unwrap();
        let pairs = vec![
            (dir.join("a.jpg").to_string_lossy().into_owned(), away.join("a.jpg").to_string_lossy().into_owned()),
            (dir.join("b.jpg").to_string_lossy().into_owned(), away.join("b.jpg").to_string_lossy().into_owned()),
        ];
        let back = super::put_back(pairs).unwrap();
        assert_eq!(back.len(), 1);
        assert!(dir.join("a.jpg").is_file());
        assert_eq!(std::fs::read(dir.join("b.jpg")).unwrap(), b"other", "the file there stays");
    }
}
