//! The favorite folders in the viewer's sidebar. They live in `viewer-favorites.json` in the app
//! data folder, read on first use and written again after each change. The `fav_*` commands use
//! this list.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// One favorite folder. `added_at` is in ms since 1970; `kind` is always "folder" for now.
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

/// The favorites list and the file it is saved to. Safe to use from any thread.
pub struct Favorites {
    file: PathBuf,
    list: Mutex<Option<Vec<Favorite>>>,
}

impl Favorites {
    /// Remembers the file only; the list is read from it on first use.
    pub fn new(file: PathBuf) -> Self {
        Self { file, list: Mutex::new(None) }
    }

    /// Runs `f` on the loaded list. Saves to disk when `f` returns true as the second value.
    fn with<T>(&self, f: impl FnOnce(&mut Vec<Favorite>) -> (T, bool)) -> T {
        let mut guard = crate::sync::lock(&self.list);
        let list = guard.get_or_insert_with(|| load(&self.file));
        let (out, changed) = f(list);
        if changed {
            save(&self.file, list);
        }
        out
    }

    /// All favorites, in the order they were added.
    pub fn list(&self) -> Vec<Favorite> {
        self.with(|l| (l.clone(), false))
    }

    /// Adds the folder with its name as the label, and saves. A folder already in the list is
    /// returned as it is, not added twice.
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

    /// Removes the favorite with this id, if any, and saves.
    pub fn remove(&self, id: &str) {
        self.with(|l| {
            l.retain(|f| f.id != id);
            ((), true)
        })
    }

    /// Changes the label and saves. None when no favorite has this id.
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

/// Reads the list. A file that cannot be read as a list is kept aside as `.damaged`, so the
/// next save does not destroy favorites that someone could still recover by hand.
fn load(file: &Path) -> Vec<Favorite> {
    let Ok(raw) = fs::read_to_string(file) else { return Vec::new() };
    match serde_json::from_str::<Store>(&raw) {
        Ok(store) if store.version == 1 => store.favorites,
        _ => {
            let _ = fs::rename(file, file.with_extension("json.damaged"));
            Vec::new()
        }
    }
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

#[cfg(test)]
mod tests {
    use super::Favorites;

    #[test]
    fn add_rename_remove_and_keep_on_disk() {
        let dir = crate::testutil::temp_dir("favorites");
        let file = dir.join("sub").join("favorites.json");
        let favs = Favorites::new(file.clone());
        assert!(favs.list().is_empty(), "no file yet: an empty list");

        let a = favs.add("/Users/me/Pictures".into());
        assert_eq!(a.label, "Pictures");
        assert_eq!(favs.add("/Users/me/Pictures".into()).id, a.id, "the same folder twice: one entry");
        let b = favs.add("/Volumes/Photos".into());
        assert_eq!(favs.rename(&b.id, "Archive".into()).unwrap().label, "Archive");
        assert!(favs.rename("no-such-id", "x".into()).is_none());

        // A new start reads the same list back from disk.
        let again = Favorites::new(file.clone());
        let labels: Vec<_> = again.list().into_iter().map(|f| f.label).collect();
        assert_eq!(labels, ["Pictures", "Archive"]);

        again.remove(&a.id);
        assert_eq!(Favorites::new(file.clone()).list().len(), 1);
        assert!(!file.with_extension("json.tmp").exists(), "no half-written file is left");
    }

    #[test]
    fn a_damaged_file_gives_an_empty_list() {
        let dir = crate::testutil::temp_dir("favorites-bad");
        let file = dir.join("favorites.json");
        std::fs::write(&file, "{ not json").unwrap();
        assert!(Favorites::new(file.clone()).list().is_empty());
        assert_eq!(std::fs::read_to_string(file.with_extension("json.damaged")).unwrap(), "{ not json", "kept aside");
        std::fs::write(&file, r#"{"version":9,"favorites":[]}"#).unwrap();
        assert!(Favorites::new(file).list().is_empty(), "an unknown version is not read");
    }
}
