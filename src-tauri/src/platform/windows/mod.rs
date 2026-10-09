//! The Windows side of `platform`: Windows Imaging Component (WIC) for images, the Explorer shell
//! for video frames, the Recycle Bin and opening files, and the Windows clipboard. Each module
//! has the same name and public items as its twin for every other system.
//!
//! Not on Windows yet (Roadmap in README.md): Screenshot and Record. Their modules answer with a
//! clear message, and the window hides both tabs (`FEATURES`).

/// Screenshot placeholders until Windows Graphics Capture is added.
pub mod capture;
/// Copy files, pictures, paths and text (the Windows clipboard).
pub mod clipboard;
/// Drag files out to other apps.
pub mod drag;
/// Decode, thumbnails, camera data and drawing (WIC), video frames and length (Explorer shell).
pub mod image;
/// Recording placeholders until Windows Graphics Capture is added.
pub mod recorder;
/// Recycle Bin, File Explorer, the default app, cloud files and processor cores.
pub mod system;

/// The Viewer, Optimize and Export for Web work on Windows; Screenshot and Record come later.
pub const FEATURES: crate::platform::Features = crate::platform::Features { system: "windows", screenshot: false, record: false };

/// Starts COM on this thread once (multithreaded), as WIC and the shell need. A thread that
/// already runs COM another way (the window's main thread) keeps it.
pub(crate) fn com() {
    thread_local! {
        static STARTED: () = {
            // SAFETY: plain COM start; a second start on the same thread is harmless.
            let _ = unsafe { ::windows::Win32::System::Com::CoInitializeEx(None, ::windows::Win32::System::Com::COINIT_MULTITHREADED) };
        };
    }
    STARTED.with(|_| {});
}

/// A Windows path for shell calls, which want backslashes: "C:/a/b.jpg" → "C:\a\b.jpg".
pub(crate) fn backslashes(path: &str) -> String {
    path.replace('/', "\\")
}
