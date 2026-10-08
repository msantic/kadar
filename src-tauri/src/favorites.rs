use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub path: String,
    pub label: String,
    pub added_at: f64,
    pub kind: String,
}

#[derive(Serialize, Deserialize)]
struct Store {
    version: u32,
    favorites: Vec<Favorite>,
}

pub struct Favorites {
    file: PathBuf,
    list: Mutex<Option<Vec<Favorite>>>,
}

impl Favorites {
    pub fn new(file: PathBuf) -> Self {
        Self { file, list: Mutex::new(None) }
    }

    /// Runs `f` on the loaded list. Saves to disk when `f` returns true as the second value.
    fn with<T>(&self, f: impl FnOnce(&mut Vec<Favorite>) -> (T, bool)) -> T {
        let mut guard = self.list.lock().unwrap();
        let list = guard.get_or_insert_with(|| load(&self.file));
        let (out, changed) = f(list);
        if changed {
            save(&self.file, list);
        }
        out
    }

    pub fn list(&self) -> Vec<Favorite> {
        self.with(|l| (l.clone(), false))
    }

    pub fn add(&self, path: String) -> Favorite {
        self.with(|l| {
            if let Some(existing) = l.iter().find(|f| f.path == path) {
                return (existing.clone(), false);
            }
            let label = Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let fav = Favorite {
                id: uuid::Uuid::new_v4().to_string(),
                path,
                label,
                added_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0),
                kind: "folder".into(),
            };
            l.push(fav.clone());
            (fav, true)
        })
    }

    pub fn remove(&self, id: &str) {
        self.with(|l| {
            l.retain(|f| f.id != id);
            ((), true)
        })
    }

    pub fn rename(&self, id: &str, label: String) -> Option<Favorite> {
        self.with(|l| match l.iter_mut().find(|f| f.id == id) {
            Some(f) => {
                f.label = label;
                (Some(f.clone()), true)
            }
            None => (None, false),
        })
    }
}

fn load(file: &Path) -> Vec<Favorite> {
    fs::read_to_string(file)
        .ok()
        .and_then(|raw| serde_json::from_str::<Store>(&raw).ok())
        .filter(|s| s.version == 1)
        .map(|s| s.favorites)
        .unwrap_or_default()
}

fn save(file: &Path, favorites: &[Favorite]) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let store = Store { version: 1, favorites: favorites.to_vec() };
    let Ok(json) = serde_json::to_string_pretty(&store) else { return };
    // Write then rename, so a crash never leaves a half-written file.
    let tmp = file.with_extension("json.tmp");
    if fs::write(&tmp, json).is_ok() {
        let _ = fs::rename(&tmp, file);
    }
}
