//! Dragging files out of Kadar on Windows: not ready yet (an OLE drag with Copy only comes next).
//! The window shows the message; nothing else changes.

use tauri::WebviewWindow;

/// Not ready on Windows.
pub fn start(_window: &WebviewWindow, _paths: Vec<String>, _icon: String) -> Result<(), String> {
    Err("Dragging files out is not available on Windows yet.".into())
}
