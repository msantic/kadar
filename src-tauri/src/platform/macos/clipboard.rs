//! Copy to the Mac clipboard. Cmd+C: the files themselves, plus the picture for a single image,
//! so it pastes into Finder, chats and web pages. Shift+Cmd+C: the full paths as text.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSPasteboard, NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardTypeString,
    NSPasteboardWriting,
};
use objc2_foundation::{NSArray, NSData, NSString, NSURL};
use tauri::AppHandle;

use crate::formats::{kind_of, Kind};
use super::image;

/// The clipboard belongs to the main thread; run there and wait for the result.
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

/// Puts the full paths on the clipboard as text, one per line. Waits for the main thread.
pub fn copy_paths(app: &AppHandle, paths: Vec<String>) -> Result<(), String> {
    copy_text(app, paths.join("\n"))
}

/// Puts plain text on the clipboard, for example the selected text of a field. Waits for the
/// main thread.
pub fn copy_text(app: &AppHandle, text: String) -> Result<(), String> {
    on_main(app, move || {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        unsafe { pb.setString_forType(&NSString::from_str(&text), NSPasteboardTypeString) }
    })?
    .then_some(())
    .ok_or_else(|| "The clipboard did not accept the text.".into())
}

/// Puts the files on the clipboard as file links; a single image also goes on as a PNG picture.
/// Waits for the main thread.
pub fn copy_files(app: &AppHandle, paths: Vec<String>) -> Result<(), String> {
    // A picture only for one image: a picture of each of many photos would be very large.
    let png = match paths.as_slice() {
        [one] if kind_of(one) == Kind::Image => image::png_bytes(std::path::Path::new(one)),
        _ => None,
    };
    on_main(app, move || {
        let items: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = paths
            .iter()
            .map(|path| {
                let item = NSPasteboardItem::new();
                let url = NSURL::fileURLWithPath(&NSString::from_str(path));
                if let Some(s) = url.absoluteString() {
                    unsafe { item.setString_forType(&s, NSPasteboardTypeFileURL) };
                }
                if let Some(bytes) = &png {
                    unsafe { item.setData_forType(&NSData::with_bytes(bytes), NSPasteboardTypePNG) };
                }
                ProtocolObject::from_retained(item)
            })
            .collect();
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        pb.writeObjects(&NSArray::from_retained_slice(&items))
    })?
    .then_some(())
    .ok_or_else(|| "The clipboard did not accept the files.".into())
}
