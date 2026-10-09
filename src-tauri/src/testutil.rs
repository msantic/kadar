//! Helpers for the checks: an empty folder per check, and small test images made here, so the
//! checks need no files from the owner's Mac.

use std::path::{Path, PathBuf};

/// An empty folder for one check, under the system temp folder; it starts empty every time.
pub fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("kadar-checks").join(format!("{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A `w` × `h` PNG with a color gradient (not one flat color, so encoders have real work).
pub fn write_png(path: &Path, w: u32, h: u32) {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            data.extend_from_slice(&[(x * 255 / w) as u8, (y * 255 / h) as u8, ((x + y) % 256) as u8, 255]);
        }
    }
    let raw = oxipng::RawImage::new(w, h, oxipng::ColorType::RGBA, oxipng::BitDepth::Eight, data).unwrap();
    std::fs::write(path, raw.create_optimized_png(&oxipng::Options::from_preset(0)).unwrap()).unwrap();
}
