//! Screenshot of one app window, with optional resize before and trim/scale after.
//! Windows come from the Mac's window list; the picture comes from the system `screencapture`
//! tool, which macOS counts as Kadar for the Screen Recording permission.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_graphics::{
    kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowNumber, kCGWindowOwnerName,
    kCGWindowOwnerPID, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
    CGWindowListCopyWindowInfo, CGWindowListOption,
};
use serde::{Deserialize, Serialize};

use crate::{macos, optimize};

struct WindowInfo {
    id: u32,
    owner: String,
    width: f64,
    height: f64,
}

fn number(d: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<f64> {
    d.get(key)?.downcast::<CFNumber>().ok()?.as_f64()
}

/// Normal app windows (layer 0) on screen, front to back. Kadar's own windows are left out.
fn windows() -> Vec<WindowInfo> {
    let options = CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let Some(list) = CGWindowListCopyWindowInfo(options, kCGNullWindowID) else { return Vec::new() };
    // The list holds one dictionary per window.
    let list: CFRetained<CFArray<CFDictionary<CFString, CFType>>> = unsafe { CFRetained::cast_unchecked(list) };
    let own_pid = std::process::id() as f64;
    let mut out = Vec::new();
    for i in 0..list.len() {
        let Some(d) = list.get(i) else { continue };
        if number(&d, unsafe { kCGWindowLayer }) != Some(0.0) || number(&d, unsafe { kCGWindowOwnerPID }) == Some(own_pid) {
            continue;
        }
        let owner = d
            .get(unsafe { kCGWindowOwnerName })
            .and_then(|v| v.downcast::<CFString>().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let bounds = d.get(unsafe { kCGWindowBounds }).and_then(|v| v.downcast::<CFDictionary>().ok());
        let (width, height) = bounds
            .map(|b| {
                let b: CFRetained<CFDictionary<CFString, CFType>> = unsafe { CFRetained::cast_unchecked(b) };
                (
                    number(&b, &CFString::from_static_str("Width")).unwrap_or(0.0),
                    number(&b, &CFString::from_static_str("Height")).unwrap_or(0.0),
                )
            })
            .unwrap_or((0.0, 0.0));
        let Some(id) = number(&d, unsafe { kCGWindowNumber }) else { continue };
        if owner.is_empty() || width < 50.0 || height < 50.0 {
            continue;
        }
        out.push(WindowInfo { id: id as u32, owner, width, height });
    }
    out
}

pub fn running_apps() -> Vec<String> {
    let mut names: Vec<String> = windows().into_iter().map(|w| w.owner).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

#[derive(Serialize)]
pub struct Permissions {
    screen: &'static str,
    microphone: &'static str,
}

/// Asks macOS once for Screen Recording access; later calls only report the state.
pub fn permissions() -> Permissions {
    let screen = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess();
    Permissions { screen: if screen { "granted" } else { "denied" }, microphone: "granted" }
}

fn expand_home(dir: &str) -> PathBuf {
    match dir.strip_prefix('~') {
        Some(rest) => PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(rest.trim_start_matches('/')),
        None => PathBuf::from(dir),
    }
}

fn applescript_text(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Moves and resizes the app's front window. Needs Accessibility access for Kadar.
pub fn resize_window(app: &str, width: i32, height: i32, x: i32, y: i32) -> Result<(), String> {
    let name = applescript_text(app);
    let script = format!(
        r#"tell application "System Events"
  tell process "{name}"
    set frontmost to true
    set size of window 1 to {{{width}, {height}}}
    set position of window 1 to {{{x}, {y}}}
  end tell
end tell"#
    );
    let out = Command::new("osascript").arg("-e").arg(script).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotOptions {
    pub app_name: String,
    pub output_dir: String,
    pub format: String,
    pub shadow: bool,
    #[serde(default)]
    pub trim_px: u32,
    #[serde(default = "full_scale")]
    pub scale: u32,
}

fn full_scale() -> u32 {
    100
}

pub fn take(opts: &ShotOptions) -> Result<String, String> {
    // The app's largest window, when it has several.
    let window = windows()
        .into_iter()
        .filter(|w| w.owner == opts.app_name)
        .max_by(|a, b| (a.width * a.height).total_cmp(&(b.width * b.height)))
        .ok_or_else(|| format!("No open window found for \"{}\". Make sure the app is open and visible.", opts.app_name))?;

    let dir = expand_home(&opts.output_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let out = dir.join(format!("screenshot-{stamp}"));
    // The plain capture keeps this name; edited ones are written next to it, then it is removed.
    let raw = out.with_extension("png");

    let mut cmd = Command::new("screencapture");
    cmd.arg("-l").arg(window.id.to_string()).arg("-x");
    if !opts.shadow {
        cmd.arg("-o");
    }
    let status = cmd.arg(&raw).status().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&raw).map(|m| m.len()).unwrap_or(0);
    if !status.success() || size == 0 {
        let _ = std::fs::remove_file(&raw);
        return Err("The screenshot is empty. Allow Kadar in System Settings → Privacy & Security → Screen Recording.".into());
    }

    let plain = opts.trim_px == 0 && opts.scale >= 100 && opts.format == "png";
    if plain {
        return Ok(raw.to_string_lossy().into_owned());
    }
    let edited = out.with_extension(format!("edit.{}", opts.format));
    let dest = out.with_extension(&opts.format);
    let result = finish(&raw, &edited, &window, opts)
        .and_then(|()| std::fs::rename(&edited, &dest).map_err(|e| e.to_string()));
    // A PNG result replaced the plain capture already; any other leftover goes.
    if result.is_err() {
        let _ = std::fs::remove_file(&edited);
    }
    if result.is_err() || dest != raw {
        let _ = std::fs::remove_file(&raw);
    }
    result.map(|()| dest.to_string_lossy().into_owned())
}

/// Trim, scale and encode the raw capture. Trim is in screen points, so it scales with Retina.
fn finish(raw: &Path, dest: &Path, window: &WindowInfo, opts: &ShotOptions) -> Result<(), String> {
    let (w, h) = macos::image_size(raw).ok_or("cannot read the screenshot")?;
    let mut frame = macos::image_thumbnail(raw, w.max(h))?;
    let ratio = (w as f64 / window.width).round().max(1.0);
    let trim = opts.trim_px as f64 * ratio;
    let (mut cw, mut ch) = (w as f64, h as f64);
    if trim > 0.0 && cw > trim * 2.0 && ch > trim * 2.0 {
        cw -= trim * 2.0;
        ch -= trim * 2.0;
        frame = macos::crop(&frame, trim, trim, cw, ch).ok_or("cannot trim the screenshot")?;
    }
    let scale = opts.scale.clamp(1, 100) as f64 / 100.0;
    let (ow, oh) = (((cw * scale).round() as usize).max(1), ((ch * scale).round() as usize).max(1));
    let pixels = macos::render_rgba(frame.image(), ow, oh)?;

    let bytes = if opts.format == "webp" {
        optimize::encode_webp(&pixels, 90.0)
    } else {
        optimize::encode_png(pixels, 1)?
    };
    std::fs::write(dest, bytes).map_err(|e| e.to_string())
}

