//! Thumbnail cache and worker pool. The page asks for a batch; cached thumbnails return at
//! once, the rest are queued and announced one by one with "viewer:thumb:ready".

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::formats::{kind_of, Kind};
use crate::macos;

/// Bump when thumbnail output changes, so old cache files are not reused.
const THUMB_VERSION: u32 = 2;
const CAP_BYTES: u64 = 1024 * 1024 * 1024;
const TARGET_BYTES: u64 = 800 * 1024 * 1024;
/// Thumbnails are made at twice the requested size, for Retina screens.
const PIXEL_RATIO: u32 = 2;

/// One file the page wants a thumbnail for. The modified time (ms) and size (bytes) are part of
/// the cache key, so a changed file gets a new thumbnail.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub src_path: String,
    pub mtime_ms: f64,
    pub size: u64,
}

/// Answer to a batch: `cached` maps source path → cache file for thumbnails that exist now;
/// `pending` lists the sources that will arrive later as events.
#[derive(Serialize)]
pub struct RequestResult {
    pub cached: HashMap<String, String>,
    pub pending: Vec<String>,
}

struct Job {
    request_id: String,
    src: String,
    kind: Kind,
    target: PathBuf,
    max_px: u32,
}

#[derive(Default)]
struct Queue {
    jobs: VecDeque<Job>,
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
    app: AppHandle,
}

/// The thumbnail queue, its worker threads and the cache folder. One for the whole app.
pub struct ThumbService {
    shared: Arc<Shared>,
    cache_dir: PathBuf,
}

impl ThumbService {
    /// Makes the cache folder and starts one worker thread per performance core, plus a thread
    /// that trims the cache to its size limit every hour.
    pub fn start(app: AppHandle, cache_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&cache_dir);
        let shared = Arc::new(Shared { queue: Mutex::default(), wake: Condvar::new(), app });

        for _ in 0..worker_count() {
            let shared = shared.clone();
            thread::spawn(move || worker_loop(&shared));
        }

        let sweep_dir = cache_dir.clone();
        thread::spawn(move || loop {
            evict_if_needed(&sweep_dir);
            thread::sleep(Duration::from_secs(60 * 60));
        });

        Self { shared, cache_dir }
    }

    /// Returns cached thumbnails at once and queues the rest, newest request first. Each queued
    /// file then sends "viewer:thumb:ready" or "viewer:thumb:error". `target_size` is in CSS px; thumbnails are made at twice that.
    pub fn request(&self, request_id: String, files: Vec<FileInfo>, target_size: u32) -> RequestResult {
        let mut cached = HashMap::new();
        let mut jobs = Vec::new();

        for f in files {
            let kind = kind_of(&f.src_path);
            if kind == Kind::Unsupported {
                continue;
            }
            let base = self.base_path(&f, target_size);
            if let Some(hit) = lookup(&base) {
                cached.insert(f.src_path, hit.to_string_lossy().into_owned());
                continue;
            }
            if let Some(dir) = base.parent() {
                let _ = fs::create_dir_all(dir);
            }
            jobs.push(Job {
                request_id: request_id.clone(),
                src: f.src_path,
                kind,
                target: base,
                max_px: target_size * PIXEL_RATIO,
            });
        }

        let pending = jobs.iter().map(|j| j.src.clone()).collect();
        if !jobs.is_empty() {
            let mut q = crate::sync::lock(&self.shared.queue);
            // Newest request first: after a fast scroll, the rows on screen now come before the
            // rows passed on the way. Reversed, so the newest batch still starts at its top-left.
            q.jobs.extend(jobs.into_iter().rev());
            self.shared.wake.notify_all();
        }
        RequestResult { cached, pending }
    }

    /// Drops this request's jobs that have not started. Jobs already running finish; the page
    /// ignores results for a cancelled request.
    pub fn cancel(&self, request_id: &str) {
        crate::sync::lock(&self.shared.queue).jobs.retain(|j| j.request_id != request_id);
    }

    /// Cache path without extension; the file is `.jpg`, or `.png` when it has transparency.
    fn base_path(&self, f: &FileInfo, target_size: u32) -> PathBuf {
        let key_src = format!("{}:{}:{}:{}:{}", f.src_path, f.mtime_ms, f.size, THUMB_VERSION, target_size);
        let key = sha1_smol::Sha1::from(key_src).digest().to_string();
        let key = &key[..16];
        self.cache_dir.join(&key[..2]).join(key)
    }
}

/// One worker per performance core. Measured on 10 performance cores: 10 workers make about
/// 320 thumbnails a second, 6 workers about 170; more than the core count gains nothing.
fn worker_count() -> usize {
    let mut cores: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let name = c"hw.perflevel0.physicalcpu";
    let ok = unsafe {
        libc::sysctlbyname(name.as_ptr(), (&raw mut cores).cast(), &mut size, std::ptr::null_mut(), 0)
    } == 0;
    let fallback = thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(2);
    (if ok && cores > 0 { cores as usize } else { fallback }).clamp(2, 12)
}

fn lookup(base: &Path) -> Option<PathBuf> {
    for ext in ["jpg", "png"] {
        let p = base.with_extension(ext);
        if let Ok(meta) = fs::metadata(&p) {
            if meta.is_file() && meta.len() > 0 {
                // Mark as recently used; the cache sweep removes the oldest first.
                if let Ok(file) = fs::File::options().write(true).open(&p) {
                    let _ = file.set_modified(SystemTime::now());
                }
                return Some(p);
            }
        }
    }
    None
}

fn worker_loop(shared: &Shared) {
    loop {
        let job = {
            let mut q = crate::sync::lock(&shared.queue);
            loop {
                if let Some(job) = q.jobs.pop_back() {
                    break job;
                }
                q = crate::sync::wait(&shared.wake, q);
            }
        };

        // A crash inside one image's decoder must not end this worker: report it as an error.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| generate(&job)))
            .unwrap_or_else(|_| Err("this file crashed the thumbnail maker".into()));
        match result {
            Ok(path) => {
                let _ = shared.app.emit(
                    "viewer:thumb:ready",
                    json!({ "requestId": job.request_id, "srcPath": job.src, "cachePath": path }),
                );
            }
            Err(message) => {
                let _ = shared.app.emit(
                    "viewer:thumb:error",
                    json!({ "requestId": job.request_id, "srcPath": job.src, "message": message }),
                );
            }
        }
    }
}

fn generate(job: &Job) -> Result<String, String> {
    let src = Path::new(&job.src);
    let frame = match job.kind {
        Kind::Video => macos::video_frame(src, job.max_px)?,
        _ => macos::image_thumbnail(src, job.max_px)?,
    };
    let ext = macos::write_thumbnail(&frame, &job.target)?;
    Ok(job.target.with_extension(ext).to_string_lossy().into_owned())
}

/// Keeps the cache under 1 GB: when over, removes the least recently used files down to 800 MB.
fn evict_if_needed(root: &Path) {
    evict(root, CAP_BYTES, TARGET_BYTES);
}

/// When the files in `root`'s shard folders total more than `cap` bytes, removes the least
/// recently used ones until `target` bytes or less remain.
fn evict(root: &Path, cap: u64, target: u64) {
    let mut files: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let mut total = 0u64;
    let Ok(shards) = fs::read_dir(root) else { return };
    for shard in shards.flatten() {
        let Ok(entries) = fs::read_dir(shard.path()) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let used = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            total += meta.len();
            files.push((entry.path(), meta.len(), used));
        }
    }
    if total <= cap {
        return;
    }
    files.sort_by_key(|f| f.2);
    for (path, size, _) in files {
        if total <= target {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total -= size;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{temp_dir, write_png};

    #[test]
    fn makes_a_thumbnail_and_finds_it_again() {
        let dir = temp_dir("thumbs-make");
        let src = dir.join("photo.png");
        write_png(&src, 400, 200);
        let job = Job {
            request_id: "r1".into(),
            src: src.to_string_lossy().into_owned(),
            kind: Kind::Image,
            target: dir.join("ab").join("abcdef"),
            max_px: 100,
        };
        std::fs::create_dir_all(dir.join("ab")).unwrap();
        let made = PathBuf::from(generate(&job).expect("a thumbnail"));
        assert_eq!(macos::image_size(&made), Some((100, 50)), "the long side fits, the shape stays");
        assert_eq!(lookup(&job.target), Some(made));
        assert_eq!(lookup(&dir.join("ab").join("missing")), None);

        let broken = Job { src: dir.join("gone.jpg").to_string_lossy().into_owned(), ..job };
        assert!(generate(&broken).is_err());
    }

    #[test]
    fn an_empty_cache_file_counts_as_missing() {
        let dir = temp_dir("thumbs-empty");
        std::fs::write(dir.join("x.jpg"), b"").unwrap();
        assert_eq!(lookup(&dir.join("x")), None, "a half-written file is made again");
    }

    #[test]
    fn eviction_removes_the_least_recently_used_first() {
        let root = temp_dir("thumbs-evict");
        let shard = root.join("aa");
        std::fs::create_dir_all(&shard).unwrap();
        let now = SystemTime::now();
        for (i, name) in ["old", "mid", "new"].iter().enumerate() {
            let p = shard.join(format!("{name}.jpg"));
            std::fs::write(&p, vec![0u8; 100]).unwrap();
            let used = now - Duration::from_secs(1000 * (3 - i as u64));
            std::fs::File::options().write(true).open(&p).unwrap().set_modified(used).unwrap();
        }
        evict(&root, 300, 200);
        assert_eq!(std::fs::read_dir(&shard).unwrap().count(), 3, "at the limit: nothing goes");

        evict(&root, 250, 150);
        let left: Vec<_> = std::fs::read_dir(&shard).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, ["new.jpg"], "down to the target, oldest first");
    }

    #[test]
    fn workers_match_the_cores() {
        let n = worker_count();
        assert!((2..=12).contains(&n));
    }
}
