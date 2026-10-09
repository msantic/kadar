//! Dragging files out of Kadar on Windows, the same drag File Explorer makes: the shell builds
//! the file list (a shell item array's data object), and `SHDoDragDrop` runs the drag with the
//! shell's own picture under the pointer. Only Copy is allowed, so a drop on another folder never
//! moves the owner's file away (the same rule as on the Mac).
//!
//! The window starts the drag from mouse movement while the button is down (as on the Mac).
//! `SHDoDragDrop` runs on the window's thread until the drop; the command returns at once.

use tauri::WebviewWindow;
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::DROPEFFECT_COPY;
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_DataObject, IShellItemArray, ILFree, SHCreateShellItemArrayFromIDLists, SHDoDragDrop, SHParseDisplayName,
};
use windows::core::HSTRING;

use super::backslashes;

/// The files as one shell data object, as File Explorer puts them on a drag. Err when a file
/// cannot be found.
fn data_object(paths: &[String]) -> Result<IDataObject, String> {
    let mut ids: Vec<*mut ITEMIDLIST> = Vec::with_capacity(paths.len());
    // SAFETY: each item id is made by the shell, used for the array, then freed once below.
    let result = unsafe {
        let mut made = Ok(());
        for p in paths {
            let mut id: *mut ITEMIDLIST = std::ptr::null_mut();
            if let Err(e) = SHParseDisplayName(&HSTRING::from(backslashes(p)), None, &mut id, 0, None) {
                made = Err(e.message());
                break;
            }
            ids.push(id);
        }
        made.and_then(|()| {
            let list: Vec<*const ITEMIDLIST> = ids.iter().map(|id| *id as *const ITEMIDLIST).collect();
            let items: IShellItemArray = SHCreateShellItemArrayFromIDLists(&list).map_err(|e| e.message())?;
            items.BindToHandler(None, &BHID_DataObject).map_err(|e| e.message())
        })
    };
    for id in ids {
        // SAFETY: frees each id the shell made above, once.
        unsafe { ILFree(Some(id)) };
    }
    result
}

/// Starts a file drag at the pointer. Call while the mouse button is down. `_icon` is the Mac's
/// drag picture; Windows draws its own from the files.
pub fn start(window: &WebviewWindow, paths: Vec<String>, _icon: String) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd_raw = hwnd.0 as isize;
    window
        .run_on_main_thread(move || {
            let Ok(data) = data_object(&paths) else { return };
            let hwnd = windows::Win32::Foundation::HWND(hwnd_raw as *mut _);
            // SAFETY: runs the shell's own drag on the window's thread; it returns at the drop.
            let _ = unsafe { SHDoDragDrop(Some(hwnd), &data, None, DROPEFFECT_COPY) };
        })
        .map_err(|e| e.to_string())
}
