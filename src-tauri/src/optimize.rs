//! Optimizer: makes web-ready copies of images and videos in an `optimized` folder next to each
//! file. Images run in parallel on all cores; videos run one at a time on the Mac's video encoder.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::formats::ext_of;
use crate::{macos, video};

const OUT_DIR: &str = "optimized";

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "heif", "webp", "tif", "tiff", "bmp", "avif",
    // RAW and Photoshop: the Mac decodes them like any other image.
    "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "rwl",
    "pef", "srw", "3fr", "iiq", "erf", "mos", "mrw", "x3f", "psd",
];
const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "avi", "mkv", "webm"];

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Webp,
    Png,
    Jpg,
}

impl ImageFormat {
    fn ext(self) -> &'static str {
        match self {
            ImageFormat::Webp => "webp",
            ImageFormat::Png => "png",
            ImageFormat::Jpg => "jpg",
        }
    }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub max_width: u32,
    pub image_format: ImageFormat,
    pub video_preset: video::Preset,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub file: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn is_image(p: &Path) -> bool {
    IMAGE_EXTS.contains(&ext_of(&p.to_string_lossy()).as_str())
}

fn is_video(p: &Path) -> bool {
    VIDEO_EXTS.contains(&ext_of(&p.to_string_lossy()).as_str())
}

/// Dropped paths → the files to optimize. Folders are searched to any depth, but never inside
/// an `optimized` folder, so earlier results are not optimized again.
pub fn expand(paths: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for p in paths {
        collect(Path::new(p), &mut out);
    }
    out
}

fn collect(path: &Path, out: &mut Vec<String>) {
    if path.is_dir() {
        if path.file_name().is_some_and(|n| n == OUT_DIR) {
            return;
        }
        let Ok(read) = fs::read_dir(path) else { return };
        let mut children: Vec<PathBuf> = read
            .flatten()
            .map(|e| e.path())
            .filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
            .collect();
        children.sort();
        for c in children {
            collect(&c, out);
        }
    } else if is_image(path) || is_video(path) {
        out.push(path.to_string_lossy().into_owned());
    }
}

/// `photos/My Photo.JPG` → `photos/optimized/my-photo.<ext>`
fn out_path(src: &Path, ext: &str) -> PathBuf {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut name = slug::slugify(&stem);
    if name.is_empty() {
        name = "file".into();
    }
    src.parent().unwrap_or(Path::new("/")).join(OUT_DIR).join(format!("{name}.{ext}"))
}

pub fn run(app: &AppHandle, files: Vec<String>, opts: &Options) {
    let emit = |p: Progress| {
        let _ = app.emit("file-progress", p);
    };
    let (images, videos): (Vec<String>, Vec<String>) =
        files.into_iter().partition(|f| is_image(Path::new(f)));

    let next = AtomicUsize::new(0);
    let workers = thread::available_parallelism().map(|n| n.get()).unwrap_or(4);

    // Videos use the hardware encoder, so they run beside the image work, one at a time.
    thread::scope(|scope| {
        scope.spawn(|| {
            for file in &videos {
                run_one(file, &emit, |src, progress| {
                    let dest = out_path(src, "mp4");
                    video::compress(src, &dest, opts.video_preset, progress)?;
                    Ok(dest)
                }, "mp4");
            }
        });

        for _ in 0..workers {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(file) = images.get(i) else { break };
                run_one(file, &emit, |src, _| {
                    let dest = out_path(src, opts.image_format.ext());
                    optimize_image(src, &dest, opts)?;
                    Ok(dest)
                }, opts.image_format.ext());
            });
        }
    });
}

fn run_one(
    file: &str,
    emit: &(impl Fn(Progress) + Sync),
    work: impl FnOnce(&Path, &dyn Fn(u32)) -> Result<PathBuf, String>,
    ext: &str,
) {
    let src = Path::new(file);
    let existing = out_path(src, ext);
    if existing.exists() {
        emit(Progress {
            file: file.into(),
            status: "skipped",
            out_path: Some(existing.to_string_lossy().into_owned()),
            ..Default::default()
        });
        return;
    }
    emit(Progress { file: file.into(), status: "processing", ..Default::default() });
    let progress = |percent: u32| {
        emit(Progress { file: file.into(), status: "processing", percent: Some(percent), ..Default::default() })
    };
    match work(src, &progress) {
        Ok(dest) => emit(Progress {
            file: file.into(),
            status: "done",
            out_path: Some(dest.to_string_lossy().into_owned()),
            ..Default::default()
        }),
        Err(error) => emit(Progress { file: file.into(), status: "error", error: Some(error), ..Default::default() }),
    }
}

pub fn optimize_image(src: &Path, dest: &Path, opts: &Options) -> Result<(), String> {
    let img = macos::decode_for_web(src, opts.max_width)?;
    let bytes = match opts.image_format {
        ImageFormat::Webp => encode_webp(&img, 80.0),
        ImageFormat::Jpg => encode_jpeg_q(&img, 80.0)?,
        ImageFormat::Png => encode_png(img, 2)?,
    };
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write then rename, so a stopped run never leaves a broken file that later runs skip.
    let tmp = dest.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

pub fn encode_webp(img: &macos::Rgba, quality: f32) -> Vec<u8> {
    if img.opaque {
        let rgb = to_rgb(img);
        webp::Encoder::from_rgb(&rgb, img.width, img.height).encode(quality).to_vec()
    } else {
        webp::Encoder::from_rgba(&img.data, img.width, img.height).encode(quality).to_vec()
    }
}

pub fn encode_jpeg_q(img: &macos::Rgba, quality: f32) -> Result<Vec<u8>, String> {
    let rgb = to_rgb(img);
    // mozjpeg reports encoder errors by unwinding; catch them so one bad file fails alone.
    std::panic::catch_unwind(|| -> std::io::Result<Vec<u8>> {
        let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
        comp.set_size(img.width as usize, img.height as usize);
        comp.set_quality(quality);
        let mut started = comp.start_compress(Vec::new())?;
        started.write_scanlines(&rgb)?;
        started.finish()
    })
    .map_err(|_| "JPEG encoder failed".to_string())?
    .map_err(|e| e.to_string())
}

/// Lossless: PNG is picked for transparency or crisp UI art, where lossy compression shows.
/// `level` 0–6: higher is smaller and slower. 2 suits batch work, 1 suits a waiting user.
pub fn encode_png(img: macos::Rgba, level: u8) -> Result<Vec<u8>, String> {
    let raw = oxipng::RawImage::new(img.width, img.height, oxipng::ColorType::RGBA, oxipng::BitDepth::Eight, img.data)
        .map_err(|e| e.to_string())?;
    raw.create_optimized_png(&oxipng::Options::from_preset(level)).map_err(|e| e.to_string())
}

/// Drops alpha. Transparent areas become white, the usual page background.
fn to_rgb(img: &macos::Rgba) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(img.data.len() / 4 * 3);
    for px in img.data.chunks_exact(4) {
        let a = px[3] as u32;
        for &c in &px[..3] {
            rgb.push(((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8);
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_names() {
        assert_eq!(out_path(Path::new("/a/My Photo.JPG"), "webp"), Path::new("/a/optimized/my-photo.webp"));
        assert_eq!(out_path(Path::new("/a/Šuma čađa.png"), "jpg"), Path::new("/a/optimized/suma-cada.jpg"));
    }

    #[test]
    fn optimizes_into_the_optimized_folder_and_skips_its_own_results() {
        let dir = crate::testutil::temp_dir("optimize");
        let src = dir.join("Big Photo.png");
        crate::testutil::write_png(&src, 900, 600);
        let opts = Options { max_width: 300, image_format: ImageFormat::Webp, video_preset: crate::video::Preset::P720 };
        let dest = out_path(&src, "webp");
        optimize_image(&src, &dest, &opts).unwrap();
        assert_eq!(dest, dir.join("optimized/big-photo.webp"));
        assert_eq!(crate::macos::image_size(&dest), Some((300, 200)));

        std::fs::write(dir.join(".hidden.png"), b"x").unwrap();
        std::fs::write(dir.join("readme.txt"), b"x").unwrap();
        let found = expand(&[dir.to_string_lossy().into_owned()]);
        assert_eq!(found, [src.to_string_lossy().into_owned()], "no results, hidden or unknown files");
    }
}
