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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub src_path: String,
    pub mtime_ms: f64,
    pub size: u64,
}

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
    /// Jobs still queued or running, per request. "done" fires when it reaches zero.
    remaining: HashMap<String, usize>,
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
    app: AppHandle,
}

pub struct ThumbService {
    shared: Arc<Shared>,
    cache_dir: PathBuf,
}

impl ThumbService {
    pub fn start(app: AppHandle, cache_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&cache_dir);
        let shared = Arc::new(Shared { queue: Mutex::default(), wake: Condvar::new(), app });

        let workers = thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let workers = workers.saturating_sub(1).clamp(1, 6);
        for _ in 0..workers {
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
            let mut q = self.shared.queue.lock().unwrap();
            *q.remaining.entry(request_id).or_default() += jobs.len();
            q.jobs.extend(jobs);
            self.shared.wake.notify_all();
        }
        RequestResult { cached, pending }
    }

    pub fn cancel(&self, request_id: &str) {
        let mut q = self.shared.queue.lock().unwrap();
        let before = q.jobs.len();
        q.jobs.retain(|j| j.request_id != request_id);
        let dropped = before - q.jobs.len();
        let Some(left) = q.remaining.get_mut(request_id) else { return };
        *left -= dropped;
        if *left == 0 {
            q.remaining.remove(request_id);
            drop(q);
            let _ = self.shared.app.emit("viewer:thumb:done", json!({ "requestId": request_id }));
        }
        // Jobs already running finish; the page ignores results for a cancelled request.
    }

    /// Cache path without extension; the file is `.jpg`, or `.png` when it has transparency.
    fn base_path(&self, f: &FileInfo, target_size: u32) -> PathBuf {
        let key_src = format!("{}:{}:{}:{}:{}", f.src_path, f.mtime_ms, f.size, THUMB_VERSION, target_size);
        let key = sha1_smol::Sha1::from(key_src).digest().to_string();
        let key = &key[..16];
        self.cache_dir.join(&key[..2]).join(key)
    }
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
            let mut q = shared.queue.lock().unwrap();
            loop {
                if let Some(job) = q.jobs.pop_front() {
                    break job;
                }
                q = shared.wake.wait(q).unwrap();
            }
        };

        let result = generate(&job);
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

        let mut q = shared.queue.lock().unwrap();
        let finished = match q.remaining.get_mut(&job.request_id) {
            Some(left) => {
                *left -= 1;
                *left == 0
            }
            None => false,
        };
        if finished {
            q.remaining.remove(&job.request_id);
            drop(q);
            let _ = shared.app.emit("viewer:thumb:done", json!({ "requestId": job.request_id }));
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
    if total <= CAP_BYTES {
        return;
    }
    files.sort_by_key(|f| f.2);
    for (path, size, _) in files {
        if total <= TARGET_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total -= size;
        }
    }
}
