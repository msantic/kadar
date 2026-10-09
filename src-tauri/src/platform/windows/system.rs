//! Files and apps on Windows: the Recycle Bin (IFileOperation, so Explorer's Restore works and
//! Kadar learns where each file went, for Undo), File Explorer and the default app (the shell),
//! cloud files not on disk yet (OneDrive "recall on access"), and the fast processor cores.

use std::cell::RefCell;
use std::path::Path;
use std::process::Command;

use windows::core::{implement, ComObject, Ref, Result as WinResult, HRESULT, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::Storage::FileSystem::{GetFileAttributesW, FILE_ATTRIBUTE_OFFLINE, INVALID_FILE_ATTRIBUTES};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
    SHCreateItemFromParsingName, ShellExecuteW, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION,
    FOF_NOERRORUI, FOF_SILENT, SIGDN_FILESYSPATH,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use super::{backslashes, com};

/// "Recall on data access": a cloud file (OneDrive and others) whose content is not on disk.
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

/// Collects (where it was, where it is in the Recycle Bin) for each file the shell moved.
#[implement(IFileOperationProgressSink)]
struct TrashSink {
    moved: RefCell<Vec<(String, String)>>,
}

fn item_path(item: &IShellItem) -> Option<String> {
    // SAFETY: the shell returns a string we own and free once.
    unsafe {
        let p: PWSTR = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s
    }
}

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for TrashSink_Impl {
    fn StartOperations(&self) -> WinResult<()> { Ok(()) }
    fn FinishOperations(&self, _hr: HRESULT) -> WinResult<()> { Ok(()) }
    fn PreRenameItem(&self, _f: u32, _i: Ref<'_, IShellItem>, _n: &PCWSTR) -> WinResult<()> { Ok(()) }
    fn PostRenameItem(&self, _f: u32, _i: Ref<'_, IShellItem>, _n: &PCWSTR, _hr: HRESULT, _c: Ref<'_, IShellItem>) -> WinResult<()> { Ok(()) }
    fn PreMoveItem(&self, _f: u32, _i: Ref<'_, IShellItem>, _d: Ref<'_, IShellItem>, _n: &PCWSTR) -> WinResult<()> { Ok(()) }
    fn PostMoveItem(&self, _f: u32, _i: Ref<'_, IShellItem>, _d: Ref<'_, IShellItem>, _n: &PCWSTR, _hr: HRESULT, _c: Ref<'_, IShellItem>) -> WinResult<()> { Ok(()) }
    fn PreCopyItem(&self, _f: u32, _i: Ref<'_, IShellItem>, _d: Ref<'_, IShellItem>, _n: &PCWSTR) -> WinResult<()> { Ok(()) }
    fn PostCopyItem(&self, _f: u32, _i: Ref<'_, IShellItem>, _d: Ref<'_, IShellItem>, _n: &PCWSTR, _hr: HRESULT, _c: Ref<'_, IShellItem>) -> WinResult<()> { Ok(()) }
    fn PreDeleteItem(&self, _f: u32, _i: Ref<'_, IShellItem>) -> WinResult<()> { Ok(()) }
    fn PostDeleteItem(&self, _f: u32, item: Ref<'_, IShellItem>, hr: HRESULT, created: Ref<'_, IShellItem>) -> WinResult<()> {
        if hr.is_ok() {
            if let (Some(from), Some(to)) = (item.as_ref().and_then(item_path), created.as_ref().and_then(item_path)) {
                self.moved.borrow_mut().push((from, to));
            }
        }
        Ok(())
    }
    fn PreNewItem(&self, _f: u32, _d: Ref<'_, IShellItem>, _n: &PCWSTR) -> WinResult<()> { Ok(()) }
    fn PostNewItem(&self, _f: u32, _d: Ref<'_, IShellItem>, _n: &PCWSTR, _t: &PCWSTR, _a: u32, _hr: HRESULT, _c: Ref<'_, IShellItem>) -> WinResult<()> { Ok(()) }
    fn UpdateProgress(&self, _total: u32, _sofar: u32) -> WinResult<()> { Ok(()) }
    fn ResetTimer(&self) -> WinResult<()> { Ok(()) }
    fn PauseTimer(&self) -> WinResult<()> { Ok(()) }
    fn ResumeTimer(&self) -> WinResult<()> { Ok(()) }
}

/// Moves files to the Recycle Bin. Returns, per moved file, (where it was, where it is in the
/// Recycle Bin), with the paths as the window sent them. An error only when no file moved.
pub fn trash(paths: &[String]) -> Result<Vec<(String, String)>, String> {
    com();
    // SAFETY: plain shell COM calls; every interface lives until the end of this function.
    let moved = unsafe {
        let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(|e| e.message())?;
        op.SetOperationFlags(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOFX_RECYCLEONDELETE)
            .map_err(|e| e.message())?;
        let object = ComObject::new(TrashSink { moved: RefCell::new(Vec::new()) });
        let sink: IFileOperationProgressSink = object.to_interface();
        // A file that is gone already (moved away in File Explorer) is skipped; the rest still move.
        let mut queued = 0;
        let mut last_error = None;
        for path in paths {
            let item: WinResult<IShellItem> = SHCreateItemFromParsingName(&HSTRING::from(backslashes(path)), None);
            let item = item.and_then(|item| op.DeleteItem(&item, &sink));
            match item {
                Ok(()) => queued += 1,
                Err(e) => last_error = Some(e.message()),
            }
        }
        if queued == 0 {
            return Err(last_error.unwrap_or_else(|| "Nothing to move.".into()));
        }
        let result = op.PerformOperations();
        let collected = object.moved.take();
        if collected.is_empty() {
            result.map_err(|e| e.message())?;
        }
        collected
    };
    // The shell reports Windows paths; give back the window's own spelling of each source.
    Ok(moved
        .into_iter()
        .map(|(from, to)| {
            let original = paths.iter().find(|p| backslashes(p).eq_ignore_ascii_case(&from)).cloned().unwrap_or(from);
            (original, to)
        })
        .collect())
}

/// Shows the file selected in a File Explorer window. Does not wait; errors are ignored.
pub fn reveal(path: &str) {
    use std::os::windows::process::CommandExt;
    // Explorer reads `/select,"<path>"` itself; the usual argument quoting would wrap the whole
    // switch in quotes, and Explorer then opens Documents for paths with spaces.
    let _ = Command::new("explorer.exe").raw_arg(format!("/select,\"{}\"", backslashes(path))).spawn();
}

/// After Undo moved a file out of the Recycle Bin: removes the bin's record of it (the `$I` file
/// beside the `$R` file it was), so the Recycle Bin does not list a file that is no longer there.
pub fn forget_trashed(trashed: &str) {
    let path = Path::new(trashed);
    let (Some(dir), Some(name)) = (path.parent(), path.file_name().and_then(|n| n.to_str())) else { return };
    if let Some(rest) = name.strip_prefix("$R") {
        let _ = std::fs::remove_file(dir.join(format!("$I{rest}")));
    }
}

/// Opens with the shell's "open" verb. Err when Windows has no app for it.
fn shell_open(target: &str) -> Result<(), String> {
    com();
    // SAFETY: plain shell call with strings that live until it returns.
    let code = unsafe {
        ShellExecuteW(Some(HWND::default()), &HSTRING::from("open"), &HSTRING::from(target), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
    };
    if code.0 as isize > 32 { Ok(()) } else { Err("No app can open this file.".into()) }
}

/// Opens the file in its default app. Err: a message to show.
pub fn open_default(path: &str) -> Result<(), String> {
    shell_open(&backslashes(path))
}

/// Opens a folder in File Explorer or a file in its default app. Errors are ignored.
pub fn open(path: &str) {
    let _ = shell_open(&backslashes(path));
}

/// Opens a web link. The caller checks the scheme first.
pub fn open_url(url: &str) -> Result<(), String> {
    shell_open(url)
}

/// True for a cloud file whose content is not on this PC yet: reading it would download it all.
pub fn is_online_only(path: &Path) -> bool {
    let wide = HSTRING::from(path.as_os_str());
    // SAFETY: reads the attributes of a path we pass as a valid string.
    let attrs = unsafe { GetFileAttributesW(&wide) };
    attrs != INVALID_FILE_ATTRIBUTES && attrs & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_OFFLINE.0) != 0
}

/// The number of fast cores: on processors with fast and efficient cores, the cores of the
/// fastest kind; None when Windows does not say.
pub fn performance_cores() -> Option<usize> {
    use windows::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, RelationProcessorCore, SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };
    let mut len = 0u32;
    // SAFETY: the first call only asks for the size; the second fills a buffer of that size, and
    // each record is read inside it by its own length.
    unsafe {
        let _ = GetLogicalProcessorInformationEx(RelationProcessorCore, None, &mut len);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u8; len as usize];
        GetLogicalProcessorInformationEx(RelationProcessorCore, Some(buf.as_mut_ptr().cast()), &mut len).ok()?;
        let mut classes = Vec::new();
        let mut offset = 0usize;
        while offset < len as usize {
            let rec = &*(buf.as_ptr().add(offset) as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX);
            classes.push(rec.Anonymous.Processor.EfficiencyClass);
            offset += rec.Size as usize;
        }
        let fastest = *classes.iter().max()?;
        Some(classes.iter().filter(|c| **c == fastest).count())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn local_files_are_not_online_only() {
        let dir = crate::testutil::temp_dir("system-online");
        let f = dir.join("a.jpg");
        std::fs::write(&f, b"x").unwrap();
        assert!(!super::is_online_only(&f));
    }

    #[test]
    fn this_pc_reports_its_cores() {
        assert!(super::performance_cores().is_some_and(|n| n >= 1));
    }

    #[test]
    fn trash_moves_a_file_and_says_where() {
        let dir = crate::testutil::temp_dir("system-trash");
        let f = dir.join("old.jpg");
        std::fs::write(&f, b"x").unwrap();
        let path = f.to_string_lossy().into_owned();
        let moved = super::trash(std::slice::from_ref(&path)).expect("moved");
        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].0, path, "the window's own spelling comes back");
        assert!(!f.exists());
        assert!(std::path::Path::new(&moved[0].1).exists(), "the file is in the Recycle Bin");
        // Put it back, as Undo does, so the check leaves no trace in the Recycle Bin.
        std::fs::rename(&moved[0].1, &f).unwrap();
        super::forget_trashed(&moved[0].1);
        let record = std::path::Path::new(&moved[0].1).with_file_name(
            std::path::Path::new(&moved[0].1).file_name().unwrap().to_string_lossy().replacen("$R", "$I", 1),
        );
        assert!(!record.exists(), "the bin forgets the file");
        assert!(super::trash(&[dir.join("gone.jpg").to_string_lossy().into_owned()]).is_err());
    }
}
