//! Copy to the Windows clipboard. Ctrl+C: the files themselves (a file list, as File Explorer
//! copies them), plus a PNG picture for a single image, so it pastes into File Explorer, chats and
//! web pages. Ctrl+Shift+C: the full paths as text.

use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT};
use windows::Win32::UI::Shell::DROPFILES;

use super::backslashes;
use super::image;
use crate::formats::{kind_of, Kind};

/// The clipboard belongs to the window's thread; run there and wait for the result.
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

/// Movable global memory holding `bytes`, as the clipboard wants it.
fn global(bytes: &[u8]) -> Result<HGLOBAL, String> {
    // SAFETY: the block is allocated with the exact size, filled while locked, then unlocked.
    unsafe {
        let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.message())?;
        let ptr = GlobalLock(mem) as *mut u8;
        if ptr.is_null() {
            let _ = GlobalFree(Some(mem));
            return Err("The clipboard memory could not be used.".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(mem);
        Ok(mem)
    }
}

/// Empties the clipboard and puts each (format, bytes) on it. Retries while another app holds
/// the clipboard for a moment.
fn put(items: Vec<(u32, Vec<u8>)>) -> Result<(), String> {
    // SAFETY: open, fill, close on one thread; the clipboard owns each block it accepts.
    unsafe {
        let mut opened = OpenClipboard(None).is_ok();
        for _ in 0..10 {
            if opened {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            opened = OpenClipboard(None).is_ok();
        }
        if !opened {
            return Err("Another app is using the clipboard.".into());
        }
        let result = (|| {
            EmptyClipboard().map_err(|e| e.message())?;
            for (format, bytes) in items {
                let mem = global(&bytes)?;
                if SetClipboardData(format, Some(HANDLE(mem.0))).is_err() {
                    let _ = GlobalFree(Some(mem));
                    return Err("The clipboard did not accept the data.".to_string());
                }
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

/// Text as the clipboard's UTF-16 text with its ending zero.
fn utf16_bytes(text: &str) -> Vec<u8> {
    text.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect()
}

/// Puts the full paths on the clipboard as text, one per line.
pub fn copy_paths(app: &AppHandle, paths: Vec<String>) -> Result<(), String> {
    copy_text(app, paths.iter().map(|p| backslashes(p)).collect::<Vec<_>>().join("\r\n"))
}

/// Puts plain text on the clipboard.
pub fn copy_text(app: &AppHandle, text: String) -> Result<(), String> {
    on_main(app, move || put(vec![(CF_UNICODETEXT.0 as u32, utf16_bytes(&text))]))?
}

/// The file list File Explorer reads (CF_HDROP): a DROPFILES header, then each path in UTF-16,
/// each ending in a zero, and one more zero at the end.
fn file_list(paths: &[String]) -> Vec<u8> {
    let header = std::mem::size_of::<DROPFILES>();
    let mut bytes = vec![0u8; header];
    let drop = DROPFILES { pFiles: header as u32, fWide: true.into(), ..Default::default() };
    // SAFETY: DROPFILES is plain data and `bytes` holds exactly its size.
    unsafe { std::ptr::write_unaligned(bytes.as_mut_ptr() as *mut DROPFILES, drop) };
    for p in paths {
        bytes.extend(utf16_bytes(&backslashes(p)));
    }
    bytes.extend([0, 0]);
    bytes
}

/// Puts the files on the clipboard as a file list; a single image also goes on as a PNG picture.
pub fn copy_files(app: &AppHandle, paths: Vec<String>) -> Result<(), String> {
    // A picture only for one image: a picture of each of many photos would be very large.
    let png = match paths.as_slice() {
        [one] if kind_of(one) == Kind::Image => image::png_bytes(std::path::Path::new(one)),
        _ => None,
    };
    on_main(app, move || {
        let mut items = vec![(CF_HDROP.0 as u32, file_list(&paths))];
        if let Some(bytes) = png {
            // SAFETY: registers (or finds) the shared "PNG" format by name.
            let format = unsafe { RegisterClipboardFormatW(w!("PNG")) };
            items.push((format, bytes));
        }
        put(items)
    })?
}

#[cfg(test)]
mod tests {
    #[test]
    fn file_lists_end_with_two_zeros() {
        let bytes = super::file_list(&["C:/a.jpg".into()]);
        let header = std::mem::size_of::<super::DROPFILES>();
        let text: Vec<u16> = bytes[header..].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(String::from_utf16_lossy(&text[..8]), "C:\\a.jpg");
        assert_eq!(&text[8..], [0, 0]);
    }
}
