//! The Mac side of `platform`: ImageIO, AVFoundation, CoreGraphics, ScreenCaptureKit and AppKit.
//! Each module here has the same name and public items as its twin for every other system.

/// Window screenshots (`screencapture`), the app list, and resizing another app's window.
pub mod capture;
/// Copy files, pictures, paths and text (NSPasteboard).
pub mod clipboard;
/// Drag files out to other apps (NSDraggingSession, Copy only).
pub mod drag;
/// Decode, thumbnails, video frames, camera data and drawing (ImageIO, AVFoundation, CoreGraphics).
pub mod image;
/// Window or screen recording with sound (ScreenCaptureKit), and the microphone list.
pub mod recorder;
/// Trash, Finder, the default app, cloud files and processor cores.
pub mod system;

/// Everything works on the Mac.
pub const FEATURES: crate::platform::Features = crate::platform::Features { system: "mac", screenshot: true, record: true };
