//! "Export for web": rotate, crop, scale to a width, encode as WebP, JPG or PNG.
//! Every change of a setting makes the real result (into a temp file), so the window shows the
//! exact size and, on request, the compressed picture. Copy and Save reuse that result.
//! Many images at once use the same settings (`export_batch`), on all cores.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGInterpolationQuality,
};
use serde::{Deserialize, Serialize};

use crate::macos::{self, Frame, Rgba};
use crate::optimize;

/// The crop box the user drew. Out-of-range values are clamped, so the box always holds a pixel.
#[derive(Deserialize, Clone, Copy)]
pub struct Crop {
    /// Part of the rotated image, as fractions 0..1 of its width and height.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The export settings from the window. Steps run in this order: turn, crop, scale, encode.
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
    /// Without `crop`: cut this width/height shape from the center (batch export). None keeps all.
    #[serde(default)]
    pub aspect: Option<f64>,
}

/// One made result: its size in pixels and in bytes, and where the file is.
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
    let mut last = crate::sync::lock(&LAST);
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
    let c = opts.crop.unwrap_or_else(|| centered(rw, rh, opts.aspect));
    // At least one pixel stays inside: a box at the far edge would leave no room, and an empty
    // range makes `clamp` below panic.
    let cx = (c.x.clamp(0.0, 1.0) * rw).round().min(rw - 1.0);
    let cy = (c.y.clamp(0.0, 1.0) * rh).round().min(rh - 1.0);
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

    let opaque = macos::unpremultiply(&mut data);
    Ok(Rgba { width: ow as u32, height: oh as u32, data, opaque })
}

/// The largest centered part with the shape `aspect` (width / height), as fractions.
fn centered(rw: f64, rh: f64, aspect: Option<f64>) -> Crop {
    let Some(r) = aspect.filter(|r| *r > 0.0) else { return Crop { x: 0.0, y: 0.0, w: 1.0, h: 1.0 } };
    let (mut w, mut h) = (rw, rw / r);
    if h > rh {
        h = rh;
        w = rh * r;
    }
    Crop { x: (rw - w) / 2.0 / rw, y: (rh - h) / 2.0 / rh, w: w / rw, h: h / rh }
}

fn encode(pixels: Rgba, opts: &ExportOptions) -> Result<Vec<u8>, String> {
    let q = opts.quality.clamp(1, 100) as f32;
    match opts.format {
        optimize::ImageFormat::Webp => Ok(optimize::encode_webp(&pixels, q)),
        optimize::ImageFormat::Jpg => optimize::encode_jpeg_q(&pixels, q),
        optimize::ImageFormat::Png => optimize::encode_png(pixels, 2),
    }
}

/// Empties the results folder and makes a new subfolder for this run. A new folder name each
/// time, so the window never shows an older result from its cache.
fn fresh_run_dir(dir: &Path) -> Result<PathBuf, String> {
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let p = entry.path();
            let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        }
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let run = dir.join(stamp.to_string());
    std::fs::create_dir_all(&run).map_err(|e| e.to_string())?;
    Ok(run)
}

/// `photos/My Photo.HEIC` → `my-photo.webp`; a second "my-photo" in the same run gets "-2".
fn result_name(source: &str, format: optimize::ImageFormat, taken: &Mutex<HashSet<String>>) -> String {
    let stem = Path::new(source).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let base = match slug::slugify(&stem) {
        s if s.is_empty() => "image".to_string(),
        s => s,
    };
    let mut taken = crate::sync::lock(taken);
    let mut name = format!("{base}.{}", format.ext());
    let mut n = 2;
    while !taken.insert(name.clone()) {
        name = format!("{base}-{n}.{}", format.ext());
        n += 1;
    }
    name
}

fn write(path: &Path, bytes: &[u8], width: u32, height: u32) -> Result<ExportResult, String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(ExportResult { width, height, bytes: bytes.len() as u64, path: path.to_string_lossy().into_owned() })
}

/// Makes the result into `dir` and returns its size. Old results there are removed.
pub fn export(path: &str, opts: &ExportOptions, dir: &Path) -> Result<ExportResult, String> {
    let pixels = {
        let guard = decoded(path)?;
        let d = guard.as_ref().ok_or("cannot read image")?;
        render(d.frame.image(), opts)?
    };
    let (width, height) = (pixels.width, pixels.height);
    let bytes = encode(pixels, opts)?;
    let run = fresh_run_dir(dir)?;
    let out = run.join(result_name(path, opts.format, &Mutex::new(HashSet::new())));
    write(&out, &bytes, width, height)
}

/// The same rotation, crop and size as `export`, without compression (fast PNG): the
/// "Original" side of the Compare view. Written into its own folder, so the result stays.
pub fn export_reference(path: &str, opts: &ExportOptions, dir: &Path) -> Result<ExportResult, String> {
    let pixels = {
        let guard = decoded(path)?;
        let d = guard.as_ref().ok_or("cannot read image")?;
        render(d.frame.image(), opts)?
    };
    let (width, height) = (pixels.width, pixels.height);
    let bytes = optimize::encode_png(pixels, 0)?;
    let run = fresh_run_dir(dir)?;
    write(&run.join("original.png"), &bytes, width, height)
}

/// The latest batch run; an older run stops at its next file. 0 means "none": a stop request.
static BATCH_RUN: AtomicU64 = AtomicU64::new(0);

/// Stops the running batch at its next file, for example when Export for Web closes.
pub fn stop_batch() {
    BATCH_RUN.store(0, Ordering::SeqCst);
}

/// The outcome for one source: a result or an error ("stopped" when a newer run took over).
#[derive(Serialize)]
pub struct BatchItem {
    pub source: String,
    pub result: Option<ExportResult>,
    pub error: Option<String>,
}

/// Exports many images with the same settings, on all cores. `progress(done, total)` follows
/// each file. A newer run (another `run` number) stops this one; its results are then None.
pub fn export_batch(
    paths: &[String],
    opts: &ExportOptions,
    dir: &Path,
    run: u64,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<Vec<BatchItem>, String> {
    BATCH_RUN.store(run, Ordering::SeqCst);
    let run_dir = fresh_run_dir(dir)?;
    let names = Mutex::new(HashSet::new());
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<Result<ExportResult, String>>>> = Mutex::new((0..paths.len()).map(|_| None).collect());
    let workers = thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(paths.len().max(1));
    thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                if BATCH_RUN.load(Ordering::SeqCst) != run {
                    break;
                }
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(path) = paths.get(i) else { break };
                let one = (|| {
                    let (w, h) = macos::image_size(Path::new(path)).ok_or("cannot read image")?;
                    let frame = macos::image_thumbnail(Path::new(path), w.max(h))?;
                    let pixels = render(frame.image(), opts)?;
                    let (pw, ph) = (pixels.width, pixels.height);
                    let bytes = encode(pixels, opts)?;
                    write(&run_dir.join(result_name(path, opts.format, &names)), &bytes, pw, ph)
                })();
                crate::sync::lock(&results)[i] = Some(one);
                progress(done.fetch_add(1, Ordering::Relaxed) + 1, paths.len());
            });
        }
    });
    let results = crate::sync::into_inner(results);
    Ok(paths
        .iter()
        .zip(results)
        .map(|(source, r)| match r {
            Some(Ok(result)) => BatchItem { source: source.clone(), result: Some(result), error: None },
            Some(Err(e)) => BatchItem { source: source.clone(), result: None, error: Some(e) },
            None => BatchItem { source: source.clone(), result: None, error: Some("stopped".into()) },
        })
        .collect())
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

    fn opts(turns: u8, crop: Option<super::Crop>, max_width: Option<u32>, format: crate::optimize::ImageFormat) -> super::ExportOptions {
        super::ExportOptions { turns, crop, max_width, format, quality: 80, aspect: None }
    }

    #[test]
    fn export_rotates_crops_and_scales() {
        use crate::optimize::ImageFormat::{Jpg, Png, Webp};
        let dir = crate::testutil::temp_dir("export");
        let src = dir.join("photo.png");
        crate::testutil::write_png(&src, 400, 300);
        let src = src.to_string_lossy().into_owned();
        let out = dir.join("out");

        let r = super::export(&src, &opts(0, None, None, Png), &out).unwrap();
        assert_eq!((r.width, r.height), (400, 300));
        let r = super::export(&src, &opts(1, None, None, Webp), &out).unwrap();
        assert_eq!((r.width, r.height), (300, 400), "a quarter turn swaps width and height");
        let half = Some(super::Crop { x: 0.25, y: 0.0, w: 0.5, h: 0.5 });
        let r = super::export(&src, &opts(0, half, None, Jpg), &out).unwrap();
        assert_eq!((r.width, r.height), (200, 150));
        let r = super::export(&src, &opts(0, None, Some(100), Webp), &out).unwrap();
        assert_eq!((r.width, r.height), (100, 75), "scales down to the width, keeping the shape");
        let r = super::export(&src, &opts(0, None, Some(4000), Webp), &out).unwrap();
        assert_eq!(r.width, 400, "never scales up");
        assert!(std::path::Path::new(&r.path).is_file());
        assert_eq!(std::fs::metadata(&r.path).unwrap().len(), r.bytes);
    }

    #[test]
    fn centered_shapes() {
        let c = super::centered(400.0, 300.0, None);
        assert_eq!((c.x, c.y, c.w, c.h), (0.0, 0.0, 1.0, 1.0), "no shape: the whole image");
        let c = super::centered(400.0, 300.0, Some(1.0));
        assert_eq!((c.x, c.y, c.w, c.h), (0.125, 0.0, 0.75, 1.0), "a square from a wide image");
        let c = super::centered(300.0, 400.0, Some(16.0 / 9.0));
        assert!((c.w - 1.0).abs() < 1e-9 && (c.h * 400.0 - 300.0 * 9.0 / 16.0).abs() < 1e-9, "16:9 from a tall image");
        assert!((c.y - (1.0 - c.h) / 2.0).abs() < 1e-9, "in the middle");
        let c = super::centered(400.0, 300.0, Some(0.0));
        assert_eq!(c.w, 1.0, "a bad shape is ignored");
    }

    #[test]
    fn crops_at_the_edge_or_out_of_range_do_not_crash() {
        use crate::optimize::ImageFormat::Png;
        let dir = crate::testutil::temp_dir("export-edges");
        let src = dir.join("photo.png");
        crate::testutil::write_png(&src, 40, 30);
        let src = src.to_string_lossy().into_owned();
        let out = dir.join("out");
        let edge = Some(super::Crop { x: 1.0, y: 1.0, w: 0.5, h: 0.5 });
        let r = super::export(&src, &opts(0, edge, None, Png), &out).unwrap();
        assert_eq!((r.width, r.height), (1, 1));
        let wild = Some(super::Crop { x: -3.0, y: -1.0, w: 9.0, h: 9.0 });
        let r = super::export(&src, &opts(3, wild, None, Png), &out).unwrap();
        assert_eq!((r.width, r.height), (30, 40), "clamped to the whole, turned image");
        assert!(super::export(&dir.join("gone.png").to_string_lossy(), &opts(0, None, None, Png), &out).is_err());
    }

    #[test]
    fn result_names_are_clean_and_unique() {
        use crate::optimize::ImageFormat::{Jpg, Webp};
        let taken = std::sync::Mutex::new(std::collections::HashSet::new());
        assert_eq!(super::result_name("/a/My Photo.HEIC", Webp, &taken), "my-photo.webp");
        assert_eq!(super::result_name("/b/my photo.jpg", Webp, &taken), "my-photo-2.webp");
        assert_eq!(super::result_name("/b/my photo.jpg", Jpg, &taken), "my-photo.jpg");
        assert_eq!(super::result_name("/c/Šuma.png", Webp, &taken), "suma.webp");
        assert_eq!(super::result_name("/c/★.png", Webp, &taken), "image.webp", "no letters left");
    }

    #[test]
    fn saving_never_overwrites() {
        let dir = crate::testutil::temp_dir("export-save");
        let src = dir.join("photo.png");
        crate::testutil::write_png(&src, 50, 40);
        let result = dir.join("photo.webp");
        std::fs::write(&result, b"data").unwrap();
        let a = super::save_next_to(&src.to_string_lossy(), &result.to_string_lossy()).unwrap();
        let b = super::save_next_to(&src.to_string_lossy(), &result.to_string_lossy()).unwrap();
        assert!(a.ends_with("optimized/photo.webp"));
        assert!(b.ends_with("optimized/photo-2.webp"));
    }

    #[test]
    fn batch_exports_all_with_a_centered_shape_and_unique_names() {
        use crate::optimize::ImageFormat::Webp;
        let dir = crate::testutil::temp_dir("export-batch");
        let wide = dir.join("photo.png");
        let tall = dir.join("photo.jpg"); // same name stem as photo.png
        crate::testutil::write_png(&wide, 400, 200);
        crate::testutil::write_png(&tall, 200, 400);
        let paths = vec![wide.to_string_lossy().into_owned(), tall.to_string_lossy().into_owned()];
        let mut o = opts(0, None, Some(100), Webp);
        o.aspect = Some(1.0);
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let items = super::export_batch(&paths, &o, &dir.join("out"), 7, &|_, total| {
            assert_eq!(total, 2);
            calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(calls.into_inner(), 2);
        for item in &items {
            let r = item.result.as_ref().expect("exported");
            assert_eq!((r.width, r.height), (100, 100), "square from the center, scaled to 100");
        }
        let names: std::collections::HashSet<_> = items.iter().map(|i| i.result.as_ref().unwrap().path.clone()).collect();
        assert_eq!(names.len(), 2, "no name is used twice");
        assert!(names.iter().any(|n| n.ends_with("/photo-2.webp")), "the second photo gets -2");
    }
}
