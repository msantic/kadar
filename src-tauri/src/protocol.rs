//! viewer-file://viewer/<percent-encoded absolute path>
//! Serves local images and videos to the page. Supports byte ranges, which video needs.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

use crate::formats::mime_of;

/// Largest slice sent for an open-ended range ("bytes=N-"), so video starts fast.
const MAX_OPEN_RANGE: u64 = 4 * 1024 * 1024;

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let path = percent_decode(request.uri().path());
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    tauri::async_runtime::spawn_blocking(move || {
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
