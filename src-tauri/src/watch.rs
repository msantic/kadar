//! Watches the open folder and tells the page when its contents change.

use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// Changes closer together than this are reported once.
const QUIET: Duration = Duration::from_millis(200);

/// The one folder watch (Mac FSEvents, through the `notify` crate). None when nothing is watched.
#[derive(Default)]
pub struct FolderWatch(Mutex<Option<RecommendedWatcher>>);

impl FolderWatch {
    /// Watches `dir` (not its subfolders) in place of any earlier folder. After changes stop for
    /// 200 ms, calls `report(dir)` once. A folder that cannot be watched is silently left unwatched.
    pub fn watch(&self, dir: String, report: impl Fn(&str) + Send + 'static) {
        crate::sync::lock(&self.0).take();
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
                report(&dir);
            }
        });
        *crate::sync::lock(&self.0) = Some(watcher);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::mpsc::Receiver;

    /// Longer than the quiet time plus the Mac's own event delay, so a missing report is real.
    const WAIT: Duration = Duration::from_millis(1500);

    /// Watches `dir`; every report arrives on the returned receiver.
    fn watch(w: &FolderWatch, dir: &Path) -> Receiver<String> {
        let (tx, rx) = mpsc::channel();
        w.watch(dir.to_string_lossy().into_owned(), move |d| {
            let _ = tx.send(d.to_string());
        });
        // The Mac can deliver changes made just before the watch began, late. Drop those, so each
        // check counts only its own changes.
        while rx.recv_timeout(Duration::from_millis(700)).is_ok() {}
        rx
    }

    /// All reports that arrive within `WAIT`.
    fn reports(rx: &Receiver<String>) -> Vec<String> {
        let mut got = Vec::new();
        while let Ok(d) = rx.recv_timeout(WAIT) {
            got.push(d);
        }
        got
    }

    fn folder(name: &str) -> PathBuf {
        temp_dir(&format!("watch-{name}"))
    }

    #[test]
    fn a_new_file_is_reported_with_the_folder_path() {
        let dir = folder("new");
        let w = FolderWatch::default();
        let rx = watch(&w, &dir);
        fs::write(dir.join("a.jpg"), b"x").unwrap();
        assert_eq!(reports(&rx), vec![dir.to_string_lossy().into_owned()]);
    }

    #[test]
    fn delete_rename_and_edit_are_reported() {
        let dir = folder("change");
        fs::write(dir.join("a.jpg"), b"x").unwrap();
        fs::write(dir.join("b.jpg"), b"x").unwrap();
        fs::write(dir.join("c.jpg"), b"x").unwrap();
        let w = FolderWatch::default();
        let rx = watch(&w, &dir);

        fs::remove_file(dir.join("a.jpg")).unwrap();
        assert_eq!(reports(&rx).len(), 1, "delete");
        fs::rename(dir.join("b.jpg"), dir.join("b2.jpg")).unwrap();
        assert_eq!(reports(&rx).len(), 1, "rename");
        fs::write(dir.join("c.jpg"), b"changed").unwrap();
        assert_eq!(reports(&rx).len(), 1, "edit");
    }

    #[test]
    fn a_burst_of_changes_is_reported_once() {
        let dir = folder("burst");
        let w = FolderWatch::default();
        let rx = watch(&w, &dir);
        for i in 0..50 {
            fs::write(dir.join(format!("{i}.jpg")), b"x").unwrap();
        }
        assert_eq!(reports(&rx).len(), 1);
    }

    #[test]
    fn a_new_or_removed_subfolder_is_reported() {
        let dir = folder("sub");
        let w = FolderWatch::default();
        let rx = watch(&w, &dir);

        fs::create_dir(dir.join("new")).unwrap();
        assert_eq!(reports(&rx).len(), 1, "new subfolder");
        fs::remove_dir(dir.join("new")).unwrap();
        assert_eq!(reports(&rx).len(), 1, "removed subfolder");
    }

    /// Windows reports a change inside a subfolder as a change of the subfolder itself. The page
    /// then lists the folder again and finds nothing new, so only the Mac skips it here.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_change_inside_a_subfolder_is_not_reported() {
        let dir = folder("inside");
        fs::create_dir(dir.join("old")).unwrap();
        let w = FolderWatch::default();
        let rx = watch(&w, &dir);
        fs::write(dir.join("old").join("inside.jpg"), b"x").unwrap();
        assert!(reports(&rx).is_empty());
    }

    #[test]
    fn watching_another_folder_stops_reports_from_the_first() {
        let first = folder("first");
        let second = folder("second");
        let w = FolderWatch::default();
        let rx_first = watch(&w, &first);
        let rx_second = watch(&w, &second);

        fs::write(first.join("a.jpg"), b"x").unwrap();
        assert!(reports(&rx_first).is_empty());
        fs::write(second.join("a.jpg"), b"x").unwrap();
        assert_eq!(reports(&rx_second), vec![second.to_string_lossy().into_owned()]);
    }

    #[test]
    fn a_missing_folder_is_left_unwatched() {
        let dir = folder("missing").join("not-there");
        let w = FolderWatch::default();
        let rx = watch(&w, &dir);
        assert!(crate::sync::lock(&w.0).is_none());
        assert!(reports(&rx).is_empty());
    }
}
