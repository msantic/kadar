//! Which files Kadar handles, decided by the file name extension only (no file is opened). The
//! folder list, thumbnails, the `viewer-file://` protocol and the clipboard all ask here.

use serde::Serialize;

/// What a file is to Kadar. The window gets it as "image", "video" or "unsupported".
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Video,
    Unsupported,
}

// Only formats the page can show full size. HEIC/HEIF display natively in WebKit on macOS.
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "tif", "tiff", "svg", "heic", "heif",
];

// Camera RAW and Photoshop files: the Mac decodes them, the page cannot. The big view gets a
// JPG copy of them (see protocol.rs).
const PREVIEW_EXTS: &[&str] = &[
    "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "rwl",
    "pef", "srw", "3fr", "iiq", "erf", "mos", "mrw", "x3f", "psd",
];

const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "webm"];

/// True for files the page cannot show itself, so the big view needs a JPG copy.
pub fn needs_preview(name: &str) -> bool {
    PREVIEW_EXTS.contains(&ext_of(name).as_str())
}

/// The text after the last dot, in lower case; empty when there is no dot.
pub fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) => name[i + 1..].to_lowercase(),
        None => String::new(),
    }
}

/// Image, video or unsupported, from the extension. Camera RAW and Photoshop files count as images.
pub fn kind_of(name: &str) -> Kind {
    let ext = ext_of(name);
    if IMAGE_EXTS.contains(&ext.as_str()) || PREVIEW_EXTS.contains(&ext.as_str()) {
        Kind::Image
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        Kind::Video
    } else {
        Kind::Unsupported
    }
}

/// The MIME type to serve the file with; "application/octet-stream" for anything not listed.
pub fn mime_of(path: &str) -> &'static str {
    match ext_of(path).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}
