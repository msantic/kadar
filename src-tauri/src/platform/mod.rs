//! Everything that talks to the operating system, one folder per system, behind the same names.
//! Shared code (thumbnail queue, cache, export geometry, optimize naming, file serving) calls
//! `platform::image`, `platform::system`, `platform::clipboard`, `platform::drag`,
//! `platform::capture` and `platform::recorder`, and never a system API directly. A new system
//! (Windows, Linux; see the Roadmap in README.md) adds its own folder with the same modules and
//! the same public functions and types; the compiler then checks that nothing is missing.
//!
//! What each module must offer:
//! - `image`: decode at a size, thumbnails, video frames and length, image size, camera date,
//!   all header details as JSON, PNG bytes for the clipboard, and drawing a turned and scaled
//!   part (`draw_turned`). Results are `Rgba` pixels or the system's own `Frame`. (A system's
//!   own capture code may use more helpers from its `image`; they are not shared.)
//! - `system`: Trash, show in the file manager, open in the default app, open a web link,
//!   "is this a cloud file not on disk yet", the number of fast processor cores, and
//!   `forget_trashed` (clean up after Undo put a file back). The Mac's
//!   also names Finder and the Trash for its menu bar (`FILE_MANAGER`, `TRASH`); other systems
//!   have no menu bar, and the window takes its words from `src/platform.ts`.
//! - `clipboard`: copy files (plus a picture for one image), paths, or text.
//! - `drag`: drag files out of the window into other apps, Copy only.
//! - `capture`: the app list, screen access, resize another app's window, a window screenshot.
//! - `recorder`: record a window or the screen with sound, and the microphone list.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{capture, clipboard, drag, image, recorder, system, FEATURES};

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::{capture, clipboard, drag, image, recorder, system, FEATURES};

/// What this system's build can do, for the window: tabs that are not ready yet stay hidden.
#[derive(serde::Serialize, Clone, Copy)]
pub struct Features {
    /// "mac", "windows" or "linux".
    pub system: &'static str,
    /// The Screenshot tab works.
    pub screenshot: bool,
    /// The Record tab works.
    pub record: bool,
}

/// "~/Pictures" → the full path inside the home folder (HOME, or USERPROFILE on Windows).
/// Screenshots and recordings use it for their save folder; other paths stay as they are.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // Windows capture comes later
pub fn expand_home(dir: &str) -> std::path::PathBuf {
    match dir.strip_prefix('~') {
        Some(rest) => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            std::path::PathBuf::from(home).join(rest.trim_start_matches(['/', '\\']))
        }
        None => std::path::PathBuf::from(dir),
    }
}

/// Pixels in sRGB, 8 bits per channel, RGBA with straight (not premultiplied) alpha. The shared
/// encoders (WebP, JPG, PNG) take this, whichever system decoded the image.
#[derive(Clone)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub opaque: bool,
}

/// The long side to decode at so the image's width ends at most `max_width` (never larger than
/// the original): `w` × `h` are the stored pixel sizes.
pub fn long_side_for_width(w: u32, h: u32, max_width: u32) -> u32 {
    let long = w.max(h);
    if w > max_width { ((long as f64) * (max_width as f64) / (w as f64)).round() as u32 } else { long }
}

/// System drawing works in premultiplied alpha (color already multiplied by opacity); encoders
/// expect straight alpha. Converts RGBA pixels in place. Returns true when every pixel is opaque.
pub fn unpremultiply(data: &mut [u8]) -> bool {
    let mut opaque = true;
    for px in data.as_chunks_mut::<4>().0 {
        let a = px[3] as u32;
        if a == 255 {
            continue;
        }
        opaque = false;
        if let Some(half) = (a > 0).then_some(a / 2) {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + half) / a).min(255) as u8;
            }
        }
    }
    opaque
}

#[cfg(test)]
mod tests {
    #[test]
    fn straight_alpha_from_premultiplied() {
        let mut px = [255, 0, 0, 255, 64, 32, 0, 128, 0, 0, 0, 0];
        assert!(!super::unpremultiply(&mut px));
        assert_eq!(&px[..4], [255, 0, 0, 255], "opaque pixels stay");
        assert_eq!(&px[4..8], [128, 64, 0, 128], "half see-through: color doubled back");
        assert_eq!(&px[8..], [0, 0, 0, 0], "fully clear stays clear");
        let mut solid = [1, 2, 3, 255];
        assert!(super::unpremultiply(&mut solid));
    }

    #[test]
    fn decode_size_fits_the_width() {
        assert_eq!(super::long_side_for_width(4000, 3000, 1600), 1600);
        assert_eq!(super::long_side_for_width(3000, 4000, 1500), 2000, "a tall photo: the width decides");
        assert_eq!(super::long_side_for_width(800, 600, 1600), 800, "never larger");
    }

    #[test]
    fn save_folders_expand_the_home_sign() {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap();
        assert_eq!(super::expand_home("~/Pictures"), std::path::Path::new(&home).join("Pictures"));
        assert_eq!(super::expand_home("/tmp/x"), std::path::Path::new("/tmp/x"));
    }
}
