//! viewer-file://viewer/<percent-encoded absolute path>
//! Serves local images and videos to the page. Supports byte ranges, which video needs.
//! RAW and Photoshop files are served as a full-size JPG copy, made once and cached.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::formats::{mime_of, needs_preview};
use crate::macos;

/// Bump when the copies change, so old ones are not reused.
const PREVIEW_VERSION: u32 = 1;
/// One copy at a time: the big view and its early loading may ask for the same file at once.
static PREVIEW_LOCK: Mutex<()> = Mutex::new(());

/// Largest slice sent for an open-ended range ("bytes=N-"), so video starts fast.
const MAX_OPEN_RANGE: u64 = 4 * 1024 * 1024;

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let path = percent_decode(request.uri().path());
    // Copies live in the thumbnail cache, so its size limit covers them too.
    let preview_dir = ctx.app_handle().path().app_data_dir().ok().map(|d| d.join("thumb-cache").join("pv"));
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    tauri::async_runtime::spawn_blocking(move || {
        let path = match (&preview_dir, needs_preview(&path)) {
            (Some(dir), true) => preview(Path::new(&path), dir).map(|p| p.to_string_lossy().into_owned()),
            _ => Some(path),
        };
        let Some(path) = path else {
            responder.respond(Response::builder().status(StatusCode::UNPROCESSABLE_ENTITY).body(Vec::new()).unwrap());
            return;
        };
        let response = serve(&path, range.as_deref()).unwrap_or_else(|status| {
            Response::builder().status(status).body(Vec::new()).unwrap()
        });
        responder.respond(response);
    });
}

fn serve(path: &str, range: Option<&str>) -> Result<Response<Vec<u8>>, StatusCode> {
    let mut file = File::open(path).map_err(|_| StatusCode::NOT_FOUND)?;
    let len = file.metadata().map_err(|_| StatusCode::NOT_FOUND)?.len();
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime_of(path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let Some((start, end)) = range.and_then(|r| parse_range(r, len)) else {
        let mut body = Vec::with_capacity(len as usize);
        file.read_to_end(&mut body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return builder
            .header(header::CONTENT_LENGTH, body.len())
            .body(body)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    };

    let mut body = vec![0u8; (end - start + 1) as usize];
    file.seek(SeekFrom::Start(start)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    file.read_exact(&mut body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    builder
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
        .header(header::CONTENT_LENGTH, body.len())
        .body(body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Full-size JPG (or PNG with transparency) of a RAW or Photoshop file, EXIF rotation applied.
fn preview(src: &Path, dir: &Path) -> Option<PathBuf> {
    let meta = std::fs::metadata(src).ok()?;
    let mtime = meta.modified().ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis();
    let key = sha1_smol::Sha1::from(format!("{}:{mtime}:{}:{PREVIEW_VERSION}", src.display(), meta.len()))
        .digest()
        .to_string();
    let base = dir.join(&key[..16]);
    let _guard = PREVIEW_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for ext in ["jpg", "png"] {
        let p = base.with_extension(ext);
        if p.is_file() {
            return Some(p);
        }
    }
    std::fs::create_dir_all(dir).ok()?;
    let (w, h) = macos::image_size(src)?;
    let frame = macos::image_thumbnail(src, w.max(h)).ok()?;
    let ext = macos::write_thumbnail(&frame, &base).ok()?;
    Some(base.with_extension(ext))
}

/// "bytes=START-END", "bytes=START-" or "bytes=-SUFFIX" → inclusive (start, end).
fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => {
            let start: u64 = s.parse().ok()?;
            (start, (start + MAX_OPEN_RANGE - 1).min(len - 1))
        }
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(parse_range("bytes=10-", 100), Some((10, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=200-", 100), None);
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("/Users/a%20b/%C5%A1.jpg"), "/Users/a b/š.jpg");
        assert_eq!(percent_decode("/x%2"), "/x%2");
    }
}

