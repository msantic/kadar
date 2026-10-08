use serde::Serialize;

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

const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "webm"];

pub fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) => name[i + 1..].to_lowercase(),
        None => String::new(),
    }
}

pub fn kind_of(name: &str) -> Kind {
    let ext = ext_of(name);
    if IMAGE_EXTS.contains(&ext.as_str()) {
        Kind::Image
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        Kind::Video
    } else {
        Kind::Unsupported
    }
}

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
