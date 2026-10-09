//! "Export for web" of one image: rotate, crop, scale to a width, encode as WebP, JPG or PNG.
//! Every change of a setting makes the real result (into a temp file), so the window shows the
//! exact size and, on request, the compressed picture. Copy and Save reuse that result.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGInterpolationQuality,
};
use serde::{Deserialize, Serialize};

use crate::macos::{self, Frame, Rgba};
use crate::optimize;

#[derive(Deserialize, Clone, Copy)]
pub struct Crop {
    /// Part of the rotated image, as fractions 0..1 of its width and height.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// Clockwise quarter turns: 0, 1, 2 or 3.
    pub turns: u8,
    pub crop: Option<Crop>,
    /// Largest output width; None keeps the cropped size. Never scales up.
    pub max_width: Option<u32>,
    pub format: optimize::ImageFormat,
    /// 1..100, for WebP and JPG.
    pub quality: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    /// The encoded result, to show it and to copy or save it.
    pub path: String,
}

/// The decoded source stays in memory while you change settings for the same image.
struct Decoded {
    path: String,
    mtime: SystemTime,
    frame: Frame,
}
// SAFETY: CGImage is immutable and thread-safe.
unsafe impl Send for Decoded {}

static LAST: Mutex<Option<Decoded>> = Mutex::new(None);

fn decoded(path: &str) -> Result<std::sync::MutexGuard<'static, Option<Decoded>>, String> {
    let mtime = std::fs::metadata(path).and_then(|m| m.modified()).map_err(|e| e.to_string())?;
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let fresh = last.as_ref().is_some_and(|d| d.path == path && d.mtime == mtime);
    if !fresh {
        let (w, h) = macos::image_size(Path::new(path)).ok_or("cannot read image")?;
        let frame = macos::image_thumbnail(Path::new(path), w.max(h))?;
        *last = Some(Decoded { path: path.to_string(), mtime, frame });
    }
    Ok(last)
}

/// Rotated-image rectangle → the same rectangle in the unrotated image (pixels, top-left origin).
fn unrotate(x: f64, y: f64, w: f64, h: f64, turns: u8, iw: f64, ih: f64) -> (f64, f64, f64, f64) {
    match turns % 4 {
        1 => (y, ih - x - w, h, w),
        2 => (iw - x - w, ih - y - h, w, h),
        3 => (iw - y - h, x, h, w),
        _ => (x, y, w, h),
    }
}

/// Rotates, crops and scales into straight-alpha sRGB pixels.
fn render(image: &CGImage, opts: &ExportOptions) -> Result<Rgba, String> {
    let (iw, ih) = (CGImage::width(Some(image)) as f64, CGImage::height(Some(image)) as f64);
    let odd = opts.turns % 2 == 1;
    let (rw, rh) = if odd { (ih, iw) } else { (iw, ih) };
    let c = opts.crop.unwrap_or(Crop { x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
    let cx = (c.x.clamp(0.0, 1.0) * rw).round();
    let cy = (c.y.clamp(0.0, 1.0) * rh).round();
    let cw = (c.w.clamp(0.0, 1.0) * rw).round().clamp(1.0, rw - cx);
    let ch = (c.h.clamp(0.0, 1.0) * rh).round().clamp(1.0, rh - cy);

    let (ux, uy, uw, uh) = unrotate(cx, cy, cw, ch, opts.turns, iw, ih);
    let rect = CGRect { origin: CGPoint { x: ux, y: uy }, size: CGSize { width: uw, height: uh } };
    let cropped = CGImage::with_image_in_rect(Some(image), rect).ok_or("cannot crop")?;

    let scale = opts.max_width.map_or(1.0, |m| (m as f64 / cw).min(1.0));
    let ow = ((cw * scale).round() as usize).max(1);
    let oh = ((ch * scale).round() as usize).max(1);

    let mut data = vec![0u8; ow * oh * 4];
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB })).ok_or("no sRGB")?;
    let ctx = unsafe {
        CGBitmapContextCreate(data.as_mut_ptr().cast(), ow, oh, 8, ow * 4, Some(&space), CGImageAlphaInfo::PremultipliedLast.0)
    }
    .ok_or("cannot create bitmap")?;
    let ctx = Some(&*ctx);
    CGContext::set_interpolation_quality(ctx, CGInterpolationQuality::High);
    let (owf, ohf) = (ow as f64, oh as f64);
    // Drawing space is y-up. Turn the context so the unrotated crop lands rotated clockwise.
    match opts.turns % 4 {
        1 => { CGContext::translate_ctm(ctx, 0.0, ohf); CGContext::rotate_ctm(ctx, -std::f64::consts::FRAC_PI_2); }
        2 => { CGContext::translate_ctm(ctx, owf, ohf); CGContext::rotate_ctm(ctx, std::f64::consts::PI); }
        3 => { CGContext::translate_ctm(ctx, owf, 0.0); CGContext::rotate_ctm(ctx, std::f64::consts::FRAC_PI_2); }
        _ => {}
    }
    let (dw, dh) = if odd { (ohf, owf) } else { (owf, ohf) };
    CGContext::draw_image(ctx, CGRect { origin: CGPoint { x: 0.0, y: 0.0 }, size: CGSize { width: dw, height: dh } }, Some(&cropped));

    let mut opaque = true;
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a == 255 {
            continue;
        }
        opaque = false;
        if a > 0 {
            for v in &mut px[..3] {
                *v = ((*v as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    Ok(Rgba { width: ow as u32, height: oh as u32, data, opaque })
}

fn ext(format: optimize::ImageFormat) -> &'static str {
    match format {
        optimize::ImageFormat::Webp => "webp",
        optimize::ImageFormat::Jpg => "jpg",
        optimize::ImageFormat::Png => "png",
    }
}

/// Makes the result into `dir` and returns its size. Old results there are removed.
pub fn export(path: &str, opts: &ExportOptions, dir: &Path) -> Result<ExportResult, String> {
    let pixels = {
        let guard = decoded(path)?;
        let d = guard.as_ref().ok_or("cannot read image")?;
        render(d.frame.image(), opts)?
    };
    let (width, height) = (pixels.width, pixels.height);
    let q = opts.quality.clamp(1, 100) as f32;
    let bytes = match opts.format {
        optimize::ImageFormat::Webp => optimize::encode_webp(&pixels, q),
        optimize::ImageFormat::Jpg => optimize::encode_jpeg_q(&pixels, q)?,
        optimize::ImageFormat::Png => optimize::encode_png(pixels, 2)?,
    };

    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    // A new name each time, so the window never shows an older result from its cache.
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let stem = Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = slug::slugify(&stem);
    let out = dir.join(stamp.to_string()).join(format!("{}.{}", if name.is_empty() { "image" } else { &name }, ext(opts.format)));
    std::fs::create_dir_all(out.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
    Ok(ExportResult { width, height, bytes: bytes.len() as u64, path: out.to_string_lossy().into_owned() })
}

/// Copies a result into the "optimized" folder next to the source; never overwrites.
pub fn save_next_to(source: &str, result: &str) -> Result<String, String> {
    let src = Path::new(source);
    let res = Path::new(result);
    let dir = src.parent().ok_or("No folder")?.join("optimized");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = res.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = res.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut dest: PathBuf = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    std::fs::copy(res, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::unrotate;

    #[test]
    fn rotated_rects_map_back() {
        // A 400 × 300 image; the rotated (90°) view is 300 × 400. Its top-left 100 × 50 strip
        // is the original's bottom-left 50 × 100.
        assert_eq!(unrotate(0.0, 0.0, 100.0, 50.0, 1, 400.0, 300.0), (0.0, 200.0, 50.0, 100.0));
        assert_eq!(unrotate(0.0, 0.0, 100.0, 50.0, 2, 400.0, 300.0), (300.0, 250.0, 100.0, 50.0));
        assert_eq!(unrotate(0.0, 0.0, 100.0, 50.0, 3, 400.0, 300.0), (350.0, 0.0, 50.0, 100.0));
    }
}

