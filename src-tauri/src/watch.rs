//! Watches the open folder and tells the page when its contents change.

use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter};

/// Changes closer together than this are reported once.
const QUIET: Duration = Duration::from_millis(200);

/// The one folder watch (Mac FSEvents, through the `notify` crate). None when nothing is watched.
#[derive(Default)]
pub struct FolderWatch(Mutex<Option<RecommendedWatcher>>);

impl FolderWatch {
    /// Watches `dir` (not its subfolders) in place of any earlier folder. After changes stop for
    /// 200 ms, sends "viewer:fs:changed" { dirPath } once. A folder that cannot be watched is
    /// silently left unwatched.
    pub fn watch(&self, app: AppHandle, dir: String) {
        self.unwatch();
        let (tx, rx) = mpsc::channel::<()>();
        let Ok(mut watcher) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        }) else {
            return;
        };
        if watcher.watch(Path::new(&dir), RecursiveMode::NonRecursive).is_err() {
            return;
        }
        // Ends when the watcher is dropped, because that closes the sending side.
        thread::spawn(move || {
            while rx.recv().is_ok() {
                loop {
                    match rx.recv_timeout(QUIET) {
                        Ok(()) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                let _ = app.emit("viewer:fs:changed", json!({ "dirPath": dir }));
            }
        });
        *crate::sync::lock(&self.0) = Some(watcher);
    }

    /// Stops the watch; its thread ends on its own.
    pub fn unwatch(&self) {
        crate::sync::lock(&self.0).take();
    }
}
