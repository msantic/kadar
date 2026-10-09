use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::formats::{ext_of, kind_of, Kind};

const MAX_ENTRIES: usize = 50_000;

#[derive(Serialize)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
}

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

pub fn mtime_ms(meta: &fs::Metadata) -> f64 {
    ms(meta.modified())
}

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
}
