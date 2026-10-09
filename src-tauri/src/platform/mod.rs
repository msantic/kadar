//! Everything that talks to the operating system, one folder per system, behind the same names.
//! Shared code (thumbnail queue, cache, export geometry, optimize naming, file serving) calls
//! `platform::image`, `platform::system`, `platform::clipboard`, `platform::drag`,
//! `platform::capture` and `platform::recorder`, and never a system API directly. A new system
//! (Windows, Linux; see the Roadmap in README.md) adds its own folder with the same modules and
//! the same public functions and types; the compiler then checks that nothing is missing.
//!
//! What each module must offer:
//! - `image`: decode at a size, thumbnails, video frames and length, image size, camera date,
//!   all header details as JSON, PNG bytes for the clipboard, crop, and drawing a turned and
//!   scaled part (`draw_turned`). Results are `Rgba` pixels or the system's own `Frame`.
//! - `system`: Trash, show in the file manager, open in the default app, open a web link,
//!   "is this a cloud file not on disk yet", the number of fast processor cores, and the names
//!   the system gives its file manager and trash (`FILE_MANAGER`, `TRASH`) for the menus.
//! - `clipboard`: copy files (plus a picture for one image), paths, or text.
//! - `drag`: drag files out of the window into other apps, Copy only.
//! - `capture`: the app list, screen access, resize another app's window, a window screenshot.
//! - `recorder`: record a window or the screen with sound, and the microphone list.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{capture, clipboard, drag, image, recorder, system};

/// Pixels in sRGB, 8 bits per channel, RGBA with straight (not premultiplied) alpha. The shared
/// encoders (WebP, JPG, PNG) take this, whichever system decoded the image.
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub opaque: bool,
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
}
