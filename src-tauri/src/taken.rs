//! "Date Taken" for the sort: read from each photo's camera data once, then kept in a small
//! cache file, so a folder of thousands of photos sorts at once the next time.

use std::collections::HashMap;
use std::os::macos::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};

use crate::macos;

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

pub struct TakenDates {
    file: PathBuf,
    known: Mutex<HashMap<String, Known>>,
}

impl TakenDates {
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
            let known = self.known.lock().unwrap();
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
                    scope.spawn(|| loop {
                        let Some(&i) = missing.get(next.fetch_add(1, Ordering::Relaxed)) else { break };
                        let path = Path::new(&files[i].path);
                        // A cloud file kept only online would download in full to read its date.
                        // Skip it (it sorts by creation date) and ask again once it is on the Mac.
                        if is_online_only(path) {
                            continue;
                        }
                        let taken = macos::date_taken_ms(path);
                        found.lock().unwrap().push((i, taken));
                    });
                }
            });
            let mut known = self.known.lock().unwrap();
            for (i, taken_ms) in found.into_inner().unwrap() {
                known.insert(files[i].path.clone(), Known { mtime_ms: files[i].mtime_ms, taken_ms });
            }
            self.save(&known);
        }
        let known = self.known.lock().unwrap();
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

/// macOS marks cloud files whose content is not on this Mac yet as "dataless".
fn is_online_only(path: &Path) -> bool {
    const SF_DATALESS: u32 = 0x4000_0000;
    std::fs::metadata(path).is_ok_and(|m| m.st_flags() & SF_DATALESS != 0)
}

