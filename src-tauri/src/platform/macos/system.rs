//! Files and apps on the Mac: the Trash (NSFileManager, so Finder's Put Back works), Finder and
//! the default app (the `open` tool), cloud files not on disk yet, and the fast processor cores.

use std::os::macos::fs::MetadataExt;
use std::path::Path;
use std::process::Command;

use objc2_foundation::{NSFileManager, NSString, NSURL};

/// The file manager's name in menus: "Show in Finder".
pub const FILE_MANAGER: &str = "Finder";
/// The trash's name in menus: "Move to Trash".
pub const TRASH: &str = "Trash";

/// Moves files to the Trash. Returns, per moved file, (where it was, where it is in the Trash).
/// An error only when no file moved; then it is the system's message for the last failure.
pub fn trash(paths: &[String]) -> Result<Vec<(String, String)>, String> {
    let fm = NSFileManager::defaultManager();
    let mut moved = Vec::new();
    let mut last_error = None;
    for path in paths {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let mut in_trash = None;
        match fm.trashItemAtURL_resultingItemURL_error(&url, Some(&mut in_trash)) {
            Ok(()) => {
                if let Some(t) = in_trash.and_then(|u| u.path()).map(|p| p.to_string()) {
                    moved.push((path.clone(), t));
                }
            }
            Err(e) => last_error = Some(e.localizedDescription().to_string()),
        }
    }
    match last_error {
        Some(e) if moved.is_empty() => Err(e),
        _ => Ok(moved),
    }
}

/// After Undo moved a file out of the Trash. The Mac's Trash keeps no separate record of it, so
/// there is nothing to clean up.
pub fn forget_trashed(_trashed: &str) {}

/// Shows the file selected in a Finder window. Does not wait; errors are ignored.
pub fn reveal(path: &str) {
    let _ = Command::new("open").arg("-R").arg(path).spawn();
}

/// Opens the file in its default app and waits for the answer. Err: a message to show.
pub fn open_default(path: &str) -> Result<(), String> {
    match Command::new("open").arg(path).status() {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("No app can open this file.".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Opens a folder in Finder or a file in its default app. Does not wait; errors are ignored.
pub fn open(path: &str) {
    let _ = Command::new("open").arg(path).spawn();
}

/// Opens a web link or a System Settings link. The caller checks the scheme first.
pub fn open_url(url: &str) -> Result<(), String> {
    Command::new("open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// True for a cloud file (iCloud and others) whose content is not on this Mac yet: macOS marks it
/// "dataless", and reading it would download all of it.
pub fn is_online_only(path: &Path) -> bool {
    const SF_DATALESS: u32 = 0x4000_0000;
    std::fs::metadata(path).is_ok_and(|m| m.st_flags() & SF_DATALESS != 0)
}

/// Number of performance cores (Apple Silicon has fast and efficient ones); None when unknown.
pub fn performance_cores() -> Option<usize> {
    let mut cores: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let name = c"hw.perflevel0.physicalcpu";
    let ok = unsafe {
        libc::sysctlbyname(name.as_ptr(), (&raw mut cores).cast(), &mut size, std::ptr::null_mut(), 0)
    } == 0;
    (ok && cores > 0).then_some(cores as usize)
}

#[cfg(test)]
mod tests {
    #[test]
    fn local_files_are_not_online_only() {
        let dir = crate::testutil::temp_dir("system-online");
        let f = dir.join("a.jpg");
        std::fs::write(&f, b"x").unwrap();
        assert!(!super::is_online_only(&f));
        assert!(!super::is_online_only(&dir.join("missing.jpg")));
    }

    #[test]
    fn this_mac_reports_its_fast_cores() {
        let n = super::performance_cores().expect("Apple Silicon reports performance cores");
        assert!(n >= 1);
    }

    #[test]
    fn trash_reports_failure_when_nothing_moved() {
        assert!(super::trash(&["/no/such/file.jpg".into()]).is_err());
    }
}
