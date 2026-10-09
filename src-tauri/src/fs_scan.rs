//! Reads a folder for the viewer: its subfolders and the images and videos in it, sorted the
//! way Finder sorts names. Plain `std::fs`, one level deep, hidden files left out. The
//! `list_folder` and `list_tree_children` commands use it.

use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::formats::{ext_of, kind_of, Kind};

const MAX_ENTRIES: usize = 50_000;

/// One subfolder: its name and full path.
#[derive(Serialize)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
}

/// One image or video. `size` is in bytes; the times are ms since 1970 (0 when unknown).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub ext: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime_ms: f64,
    pub created_ms: f64,
}

/// What a folder holds. `truncated` is true when the folder had more than 50,000 entries and
/// the rest were left out.
#[derive(Serialize)]
pub struct FolderListing {
    pub folders: Vec<FolderEntry>,
    pub files: Vec<FileEntry>,
    pub truncated: bool,
}

fn ms(time: std::io::Result<std::time::SystemTime>) -> f64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// The last-modified time in ms since 1970; 0 when the Mac does not report one.
pub fn mtime_ms(meta: &fs::Metadata) -> f64 {
    ms(meta.modified())
}

/// Subfolders and supported files of `dir`, both sorted by name. A folder that cannot be read
/// gives an empty listing, not an error.
pub fn list_folder(dir: &str) -> FolderListing {
    let mut folders = Vec::new();
    let mut files = Vec::new();
    let mut truncated = false;

    let Ok(read) = fs::read_dir(dir) else {
        return FolderListing { folders, files, truncated };
    };

    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path().to_string_lossy().into_owned();
        // fs::metadata follows symlinks, so a linked folder or image counts as itself.
        let Ok(meta) = fs::metadata(&path) else { continue };
        if meta.is_dir() {
            folders.push(FolderEntry { name, path });
        } else if meta.is_file() {
            let kind = kind_of(&name);
            if kind == Kind::Unsupported {
                continue;
            }
            files.push(FileEntry {
                ext: ext_of(&name),
                kind,
                size: meta.len(),
                mtime_ms: mtime_ms(&meta),
                created_ms: ms(meta.created()),
                name,
                path,
            });
        }
        if folders.len() + files.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
    }

    folders.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    FolderListing { folders, files, truncated }
}

/// Only the subfolders of `dir`, sorted by name, for the sidebar's folder tree. Empty when the
/// folder cannot be read.
pub fn list_tree_children(dir: &str) -> Vec<FolderEntry> {
    let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<FolderEntry> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            if !Path::new(&path).is_dir() {
                return None;
            }
            Some(FolderEntry { name, path: path.to_string_lossy().into_owned() })
        })
        .collect();
    out.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    out
}

/// Finder-style order: case-insensitive, and digit runs compare by value ("img2" < "img10").
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let na = take_number(&mut ai);
                let nb = take_number(&mut bi);
                let ord = na
                    .trim_start_matches('0')
                    .len()
                    .cmp(&nb.trim_start_matches('0').len())
                    .then_with(|| na.trim_start_matches('0').cmp(nb.trim_start_matches('0')));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(ca), Some(cb)) => {
                let ord = ca.to_lowercase().cmp(cb.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                ai.next();
                bi.next();
            }
        }
    }
}

fn take_number(it: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut s = String::new();
    while let Some(&c) = it.peek() {
        if !c.is_ascii_digit() {
            break;
        }
        s.push(c);
        it.next();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering;

    #[test]
    fn digits_compare_by_value() {
        assert_eq!(natural_cmp("img2.jpg", "img10.jpg"), Ordering::Less);
        assert_eq!(natural_cmp("IMG_0010", "img_9"), Ordering::Greater);
        assert_eq!(natural_cmp("Apple", "banana"), Ordering::Less);
    }

    #[test]
    fn listing_skips_hidden_and_unknown_and_sorts_like_finder() {
        let dir = crate::testutil::temp_dir("listing");
        for name in ["img10.jpg", "img2.jpg", "B.png", ".hidden.jpg", "notes.txt", "clip.MOV"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        std::fs::create_dir(dir.join("sub")).unwrap();
        let l = super::list_folder(&dir.to_string_lossy());
        let names: Vec<&str> = l.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["B.png", "clip.MOV", "img2.jpg", "img10.jpg"]);
        assert_eq!(l.folders.len(), 1);
        assert_eq!(l.files[1].kind, crate::formats::Kind::Video);
        assert!(!l.truncated);
    }

    #[test]
    fn more_name_orders() {
        assert_ne!(natural_cmp("img007", "img7"), Ordering::Equal, "same value: still a fixed order");
        assert_eq!(natural_cmp("a", "a1"), Ordering::Less);
        assert_eq!(natural_cmp("x99999999999999999999999", "x100000000000000000000000"), Ordering::Less, "longer than any number type");
        assert_ne!(natural_cmp("Šuma", "šuma"), Ordering::Equal, "same letters: still a fixed order");
    }

    #[test]
    fn the_folder_tree_lists_only_visible_folders() {
        let dir = crate::testutil::temp_dir("tree");
        for d in ["2025", "2024", ".git", "Album 10", "Album 9"] {
            std::fs::create_dir(dir.join(d)).unwrap();
        }
        std::fs::write(dir.join("photo.jpg"), b"x").unwrap();
        let names: Vec<String> = super::list_tree_children(&dir.to_string_lossy()).into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["2024", "2025", "Album 9", "Album 10"]);
        assert!(super::list_tree_children("/no/such/folder").is_empty());
        assert!(super::list_folder("/no/such/folder").files.is_empty());
    }
}
