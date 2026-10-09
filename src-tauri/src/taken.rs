//! "Date Taken" for the sort: read from each photo's camera data once, then kept in a small
//! cache file, so a folder of thousands of photos sorts at once the next time.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};

use crate::platform::image;

/// A file the window asks about, with its modified time in ms. A new time means the cached date
/// is read again.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub path: String,
    pub mtime_ms: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
struct Known {
    mtime_ms: f64,
    taken_ms: Option<f64>,
}

/// The date-taken cache, in memory and in `date-taken-cache.json` in the app data folder.
pub struct TakenDates {
    file: PathBuf,
    known: Mutex<HashMap<String, Known>>,
}

impl TakenDates {
    /// Reads the cache file. A missing or broken file starts an empty cache.
    pub fn load(file: PathBuf) -> Self {
        let known = std::fs::read_to_string(&file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self { file, known: Mutex::new(known) }
    }

    /// Date taken for each file, in the same order; None when the photo has no camera date.
    pub fn get(&self, files: Vec<FileStamp>) -> Vec<Option<f64>> {
        let missing: Vec<usize> = {
            let known = crate::sync::lock(&self.known);
            (0..files.len())
                .filter(|&i| known.get(&files[i].path).is_none_or(|k| k.mtime_ms != files[i].mtime_ms))
                .collect()
        };
        if !missing.is_empty() {
            // Read the new ones on all cores; each read takes only the file's header.
            let next = AtomicUsize::new(0);
            let found = Mutex::new(Vec::with_capacity(missing.len()));
            let workers = thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
            thread::scope(|scope| {
                for _ in 0..workers {
                    scope.spawn(|| {
                        while let Some(&i) = missing.get(next.fetch_add(1, Ordering::Relaxed)) {
                        let path = Path::new(&files[i].path);
                        // A cloud file kept only online would download in full to read its date.
                        // Skip it (it sorts by creation date) and ask again once it is on the Mac.
                        if crate::platform::system::is_online_only(path) {
                            continue;
                        }
                        let taken = image::date_taken_ms(path);
                        crate::sync::lock(&found).push((i, taken));
                        }
                    });
                }
            });
            let mut known = crate::sync::lock(&self.known);
            for (i, taken_ms) in crate::sync::into_inner(found) {
                known.insert(files[i].path.clone(), Known { mtime_ms: files[i].mtime_ms, taken_ms });
            }
            prune(&mut known, PRUNE_AT);
            self.save(&known);
        }
        let known = crate::sync::lock(&self.known);
        files.iter().map(|f| known.get(&f.path).and_then(|k| k.taken_ms)).collect()
    }

    fn save(&self, known: &HashMap<String, Known>) {
        if let Some(dir) = self.file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let Ok(json) = serde_json::to_string(known) else { return };
        let tmp = self.file.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &self.file);
        }
    }
}

/// Above this many entries, the cache drops the dates of files that no longer exist.
const PRUNE_AT: usize = 50_000;

/// When `known` holds more than `limit` entries, removes those whose file is gone, so the cache
/// file does not grow forever. Below the limit it checks nothing, so saves stay fast.
fn prune(known: &mut HashMap<String, Known>, limit: usize) {
    if known.len() > limit {
        known.retain(|path, _| Path::new(path).exists());
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn files_without_camera_data_are_none_and_cached() {
        let dir = crate::testutil::temp_dir("taken");
        let img = dir.join("plain.png");
        crate::testutil::write_png(&img, 20, 20);
        let cache = dir.join("cache.json");
        let stamp = || vec![super::FileStamp { path: img.to_string_lossy().into_owned(), mtime_ms: 1.0 }];
        let dates = super::TakenDates::load(cache.clone());
        assert_eq!(dates.get(stamp()), vec![None]);
        assert!(cache.is_file(), "results are kept for the next start");
        assert_eq!(super::TakenDates::load(cache).get(stamp()), vec![None]);
    }

    #[test]
    fn the_cache_forgets_deleted_files_once_it_is_large() {
        let dir = crate::testutil::temp_dir("taken-prune");
        let here = dir.join("here.jpg");
        std::fs::write(&here, b"x").unwrap();
        let entry = super::Known { mtime_ms: 1.0, taken_ms: None };
        let mut known: std::collections::HashMap<String, super::Known> =
            [(here.to_string_lossy().into_owned(), entry), (dir.join("gone.jpg").to_string_lossy().into_owned(), entry)]
                .into_iter()
                .collect();
        super::prune(&mut known, 5);
        assert_eq!(known.len(), 2, "small: nothing is checked");
        super::prune(&mut known, 1);
        assert_eq!(known.keys().cloned().collect::<Vec<_>>(), [here.to_string_lossy().into_owned()]);
    }
}
