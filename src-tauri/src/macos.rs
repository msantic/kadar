//! Image and video work through the Mac's own frameworks. ImageIO decodes at reduced size
//! (a 50 MP JPEG never decodes in full for a 512 px thumbnail), and AVFoundation reads one
//! video frame without a bundled ffmpeg.

use std::path::Path;

use objc2::rc::autoreleasepool;
use objc2_av_foundation::{AVAsset, AVAssetImageGenerator};
use objc2_core_foundation::{
    CFBoolean, CFDictionary, CFMutableData, CFNumber, CFRetained, CFString, CFType, CFURL, CGSize,
};
use objc2_core_foundation::{CGPoint, CGRect};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGInterpolationQuality,
};
use objc2_core_media::CMTime;
use objc2_foundation::{NSString, NSURL};
use objc2_image_io::{
    kCGImagePropertyExifDateTimeDigitized, kCGImagePropertyExifDateTimeOriginal,
    kCGImagePropertyExifDictionary, kCGImageDestinationLossyCompressionQuality, kCGImagePropertyOrientation,
    kCGImagePropertyPixelHeight, kCGImagePropertyPixelWidth,
    kCGImageSourceCreateThumbnailFromImageAlways, kCGImageSourceCreateThumbnailWithTransform,
    kCGImageSourceShouldCache, kCGImageSourceThumbnailMaxPixelSize, CGImageDestination,
    CGImageSource,
};

/// A decoded image, either from ImageIO (CF-owned) or AVFoundation (ObjC-owned).
pub enum Frame {
    Cf(CFRetained<CGImage>),
    Objc(objc2::rc::Retained<CGImage>),
}

impl Frame {
    pub fn image(&self) -> &CGImage {
        match self {
            Frame::Cf(i) => i,
            Frame::Objc(i) => i,
        }
    }
}

fn options(pairs: &[(&CFString, &CFType)]) -> CFRetained<CFDictionary<CFString, CFType>> {
    let keys: Vec<&CFString> = pairs.iter().map(|p| p.0).collect();
    let values: Vec<&CFType> = pairs.iter().map(|p| p.1).collect();
    CFDictionary::from_slices(&keys, &values)
}

fn source(path: &Path) -> Result<CFRetained<CGImageSource>, String> {
    let url = CFURL::from_file_path(path).ok_or("bad path")?;
    let no_cache = options(&[(unsafe { kCGImageSourceShouldCache }, CFBoolean::new(false))]);
    unsafe { CGImageSource::with_url(&url, Some(no_cache.as_ref())) }
        .ok_or_else(|| "cannot open image".to_string())
}

/// Scaled image no larger than `max_px` on its long side, with EXIF rotation applied.
pub fn image_thumbnail(path: &Path, max_px: u32) -> Result<Frame, String> {
    let src = source(path)?;
    let max = CFNumber::new_i32(max_px as i32);
    let opts = options(&[
        (unsafe { kCGImageSourceCreateThumbnailFromImageAlways }, CFBoolean::new(true)),
        (unsafe { kCGImageSourceCreateThumbnailWithTransform }, CFBoolean::new(true)),
        (unsafe { kCGImageSourceThumbnailMaxPixelSize }, &max),
    ]);
    unsafe { src.thumbnail_at_index(0, Some(opts.as_ref())) }
        .map(Frame::Cf)
        .ok_or_else(|| "cannot decode image".to_string())
}

/// One frame near the 1 s mark (or the first frame of a shorter clip).
pub fn video_frame(path: &Path, max_px: u32) -> Result<Frame, String> {
    autoreleasepool(|_| unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let asset = AVAsset::assetWithURL(&url);
        let generator = AVAssetImageGenerator::assetImageGeneratorWithAsset(&asset);
        generator.setAppliesPreferredTrackTransform(true);
        generator.setMaximumSize(CGSize { width: max_px as f64, height: max_px as f64 });

        let duration = asset.duration();
        let seconds = if duration.timescale > 0 {
            duration.value as f64 / duration.timescale as f64
        } else {
            0.0
        };
        let at = if seconds > 1.0 { 1.0 } else { 0.0 };
        // The blocking call is right here: it runs on a thumbnail worker thread, never the UI thread.
        #[allow(deprecated)]
        generator
            .copyCGImageAtTime_actualTime_error(CMTime::with_seconds(at, 600), std::ptr::null_mut())
            .map(Frame::Objc)
            .map_err(|e| e.localizedDescription().to_string())
    })
}

/// Writes `frame` to `dest` as JPEG, or PNG when it has transparency. Returns the extension used.
pub fn write_thumbnail(frame: &Frame, dest_without_ext: &Path) -> Result<&'static str, String> {
    let image = frame.image();
    let alpha = CGImage::alpha_info(Some(image));
    let has_alpha = [
        CGImageAlphaInfo::PremultipliedLast,
        CGImageAlphaInfo::PremultipliedFirst,
        CGImageAlphaInfo::Last,
        CGImageAlphaInfo::First,
        CGImageAlphaInfo::Only,
    ]
    .contains(&alpha);
    let (uti, ext) = if has_alpha { ("public.png", "png") } else { ("public.jpeg", "jpg") };

    // Write to a temp name and rename, so a reader never sees a half-written file.
    let tmp = dest_without_ext.with_extension("part");
    let url = CFURL::from_file_path(&tmp).ok_or("bad path")?;
    let dest = unsafe { CGImageDestination::with_url(&url, &CFString::from_str(uti), 1, None) }
        .ok_or("cannot create file")?;
    let quality = CFNumber::new_f64(0.8);
    let props = options(&[(unsafe { kCGImageDestinationLossyCompressionQuality }, &quality)]);
    unsafe { dest.add_image(image, Some(props.as_ref())) };
    if !unsafe { dest.finalize() } {
        let _ = std::fs::remove_file(&tmp);
        return Err("cannot write thumbnail".into());
    }
    std::fs::rename(&tmp, dest_without_ext.with_extension(ext)).map_err(|e| e.to_string())?;
    Ok(ext)
}

/// Pixel size as shown (EXIF rotation applied), read from the header without decoding.
pub fn image_size(path: &Path) -> Option<(u32, u32)> {
    let src = source(path).ok()?;
    let props = unsafe { src.properties_at_index(0, None) }?;
    let props: CFRetained<CFDictionary<CFString, CFType>> = unsafe { CFRetained::cast_unchecked(props) };
    let num = |key: &CFString| -> Option<i64> {
        props.get(key)?.downcast::<CFNumber>().ok()?.as_i64()
    };
    let w = num(unsafe { kCGImagePropertyPixelWidth })?;
    let h = num(unsafe { kCGImagePropertyPixelHeight })?;
    let orientation = num(unsafe { kCGImagePropertyOrientation }).unwrap_or(1);
    // Orientations 5–8 rotate by 90°, so width and height swap.
    if (5..=8).contains(&orientation) {
        Some((h as u32, w as u32))
    } else {
        Some((w as u32, h as u32))
    }
}

pub fn video_duration_ms(path: &Path) -> Option<f64> {
    autoreleasepool(|_| unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let d = AVAsset::assetWithURL(&url).duration();
        (d.timescale > 0).then(|| d.value as f64 * 1000.0 / d.timescale as f64)
    })
}

/// Pixels in sRGB, 8 bits per channel, RGBA with straight (not premultiplied) alpha.
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub opaque: bool,
}

/// Decodes `frame` into sRGB RGBA. Wide-gamut photos (Display P3) are converted to sRGB,
/// which is what browsers assume for images without a color profile.
pub fn to_rgba(frame: &Frame) -> Result<Rgba, String> {
    let image = frame.image();
    render_rgba(image, CGImage::width(Some(image)), CGImage::height(Some(image)))
}

/// Draws `image` into a `w` × `h` sRGB RGBA buffer, scaling with high quality when sizes differ.
pub fn render_rgba(image: &CGImage, w: usize, h: usize) -> Result<Rgba, String> {
    let mut data = vec![0u8; w * h * 4];
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB })).ok_or("no sRGB")?;
    let ctx = unsafe {
        CGBitmapContextCreate(
            data.as_mut_ptr().cast(),
            w,
            h,
            8,
            w * 4,
            Some(&space),
            CGImageAlphaInfo::PremultipliedLast.0,
        )
    }
    .ok_or("cannot create bitmap")?;
    CGContext::set_interpolation_quality(Some(&ctx), CGInterpolationQuality::High);
    let rect = CGRect { origin: CGPoint { x: 0.0, y: 0.0 }, size: CGSize { width: w as f64, height: h as f64 } };
    CGContext::draw_image(Some(&ctx), rect, Some(image));
    drop(ctx);

    // The Mac draws premultiplied alpha; encoders expect straight alpha.
    let mut opaque = true;
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a == 255 {
            continue;
        }
        opaque = false;
        if a > 0 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    Ok(Rgba { width: w as u32, height: h as u32, data, opaque })
}

/// Cuts `rect` (in pixels, from the top-left) out of `frame`.
pub fn crop(frame: &Frame, x: f64, y: f64, w: f64, h: f64) -> Option<Frame> {
    let rect = CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } };
    CGImage::with_image_in_rect(Some(frame.image()), rect).map(Frame::Cf)
}

/// Full image, EXIF rotation applied, scaled down so its width is at most `max_width`.
pub fn decode_for_web(path: &Path, max_width: u32) -> Result<Rgba, String> {
    let (w, h) = image_size(path).ok_or("cannot read image")?;
    let long = w.max(h);
    let long = if w > max_width {
        ((long as f64) * (max_width as f64) / (w as f64)).round() as u32
    } else {
        long
    };
    to_rgba(&image_thumbnail(path, long)?)
}

/// The image as PNG bytes, for the clipboard (web pages and chats paste PNG). PNG files are
/// used as they are; other formats are decoded at full size, with EXIF rotation applied.
pub fn png_bytes(path: &Path) -> Option<Vec<u8>> {
    if crate::formats::ext_of(&path.to_string_lossy()) == "png" {
        return std::fs::read(path).ok();
    }
    let (w, h) = image_size(path)?;
    let frame = image_thumbnail(path, w.max(h)).ok()?;
    let data = CFMutableData::new(None, 0)?;
    let dest = unsafe { CGImageDestination::with_data(&data, &CFString::from_str("public.png"), 1, None) }?;
    unsafe { dest.add_image(frame.image(), None) };
    if !unsafe { dest.finalize() } {
        return None;
    }
    Some(data.to_vec())
}


/// When the photo was taken, from its camera data (EXIF), as milliseconds since 1970.
/// The camera writes local time without a zone; it is read as this Mac's local time.
pub fn date_taken_ms(path: &Path) -> Option<f64> {
    let src = source(path).ok()?;
    let props = unsafe { src.properties_at_index(0, None) }?;
    let props: CFRetained<CFDictionary<CFString, CFType>> = unsafe { CFRetained::cast_unchecked(props) };
    let exif = props.get(unsafe { kCGImagePropertyExifDictionary })?.downcast::<CFDictionary>().ok()?;
    let exif: CFRetained<CFDictionary<CFString, CFType>> = unsafe { CFRetained::cast_unchecked(exif) };
    let text = [unsafe { kCGImagePropertyExifDateTimeOriginal }, unsafe { kCGImagePropertyExifDateTimeDigitized }]
        .iter()
        .find_map(|key| exif.get(key)?.downcast::<CFString>().ok())?
        .to_string();
    parse_exif_date(&text)
}

/// "2025:01:03 15:47:35" (local time) → milliseconds since 1970.
fn parse_exif_date(text: &str) -> Option<f64> {
    let n: Vec<i32> = text
        .split(|c: char| c == ':' || c == ' ' || c == '-' || c == 'T')
        .filter(|s| !s.is_empty())
        .take(6)
        .map(|s| s.trim().parse().ok())
        .collect::<Option<_>>()?;
    let [y, mo, d, h, mi, s] = <[i32; 6]>::try_from(n).ok()?;
    if y < 1900 || !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None; // "0000:00:00 00:00:00" and other empty values
    }
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    tm.tm_year = y - 1900;
    tm.tm_mon = mo - 1;
    tm.tm_mday = d;
    tm.tm_hour = h;
    tm.tm_min = mi;
    tm.tm_sec = s;
    tm.tm_isdst = -1; // let the system decide summer time
    let secs = unsafe { libc::mktime(&mut tm) };
    (secs != -1).then_some(secs as f64 * 1000.0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn exif_dates() {
        assert!(super::parse_exif_date("2025:01:03 15:47:35").is_some());
        assert_eq!(super::parse_exif_date("0000:00:00 00:00:00"), None);
        assert_eq!(super::parse_exif_date("garbage"), None);
        let a = super::parse_exif_date("2025:01:03 15:47:35").unwrap();
        let b = super::parse_exif_date("2025:01:03 15:47:45").unwrap();
        assert_eq!(b - a, 10_000.0);
    }
}
