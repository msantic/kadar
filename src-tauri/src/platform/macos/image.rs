//! Image and video work through the Mac's own frameworks. ImageIO decodes at reduced size
//! (a 50 MP JPEG never decodes in full for a 512 px thumbnail), and AVFoundation reads one
//! video frame without a bundled ffmpeg.

use std::path::Path;

use objc2::rc::autoreleasepool;
use objc2_av_foundation::{AVAsset, AVAssetImageGenerator};
use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFMutableData, CFNumber, CFRetained, CFString, CFType, CFURL, CGSize,
};
use objc2_core_foundation::{CGPoint, CGRect};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGInterpolationQuality,
};
use objc2_core_media::CMTime;
use objc2_foundation::{NSString, NSURL};

use crate::platform::{unpremultiply, Rgba};
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

// SAFETY: a CGImage never changes after it is made, and CoreGraphics allows its use from any
// thread. Export for Web keeps the last decoded image between calls on different threads.
unsafe impl Send for Frame {}

impl Frame {
    /// The image, whichever framework made it.
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

/// Video length in ms, from AVFoundation. None when the Mac cannot read the file.
pub fn video_duration_ms(path: &Path) -> Option<f64> {
    autoreleasepool(|_| unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let d = AVAsset::assetWithURL(&url).duration();
        (d.timescale > 0).then(|| d.value as f64 * 1000.0 / d.timescale as f64)
    })
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

    let opaque = unpremultiply(&mut data);
    Ok(Rgba { width: w as u32, height: h as u32, data, opaque })
}

/// Width and height in pixels.
pub fn frame_size(frame: &Frame) -> (u32, u32) {
    let image = frame.image();
    (CGImage::width(Some(image)) as u32, CGImage::height(Some(image)) as u32)
}

/// Cuts `rect` = (x, y, w, h) in pixels of the unturned `frame`, turns it `turns` quarter turns
/// clockwise and scales it to `out_w` × `out_h` with high quality, into sRGB pixels.
pub fn draw_turned(frame: &Frame, rect: (f64, f64, f64, f64), turns: u8, out_w: usize, out_h: usize) -> Result<Rgba, String> {
    let (x, y, w, h) = rect;
    let rect = CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } };
    let cropped = CGImage::with_image_in_rect(Some(frame.image()), rect).ok_or("cannot crop")?;
    let mut data = vec![0u8; out_w * out_h * 4];
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB })).ok_or("no sRGB")?;
    let ctx = unsafe {
        CGBitmapContextCreate(data.as_mut_ptr().cast(), out_w, out_h, 8, out_w * 4, Some(&space), CGImageAlphaInfo::PremultipliedLast.0)
    }
    .ok_or("cannot create bitmap")?;
    let ctx = Some(&*ctx);
    CGContext::set_interpolation_quality(ctx, CGInterpolationQuality::High);
    let (owf, ohf) = (out_w as f64, out_h as f64);
    // Drawing space is y-up. Turn the context so the unturned crop lands turned clockwise.
    match turns % 4 {
        1 => { CGContext::translate_ctm(ctx, 0.0, ohf); CGContext::rotate_ctm(ctx, -std::f64::consts::FRAC_PI_2); }
        2 => { CGContext::translate_ctm(ctx, owf, ohf); CGContext::rotate_ctm(ctx, std::f64::consts::PI); }
        3 => { CGContext::translate_ctm(ctx, owf, 0.0); CGContext::rotate_ctm(ctx, std::f64::consts::FRAC_PI_2); }
        _ => {}
    }
    let (dw, dh) = if turns % 2 == 1 { (ohf, owf) } else { (owf, ohf) };
    CGContext::draw_image(ctx, CGRect { origin: CGPoint { x: 0.0, y: 0.0 }, size: CGSize { width: dw, height: dh } }, Some(&cropped));
    let opaque = unpremultiply(&mut data);
    Ok(Rgba { width: out_w as u32, height: out_h as u32, data, opaque })
}

/// Cuts `rect` (in pixels, from the top-left) out of `frame`.
pub fn crop(frame: &Frame, x: f64, y: f64, w: f64, h: f64) -> Option<Frame> {
    let rect = CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } };
    CGImage::with_image_in_rect(Some(frame.image()), rect).map(Frame::Cf)
}

/// Full image, EXIF rotation applied, scaled down so its width is at most `max_width`.
pub fn decode_for_web(path: &Path, max_width: u32) -> Result<Rgba, String> {
    let (w, h) = image_size(path).ok_or("cannot read image")?;
    to_rgba(&image_thumbnail(path, crate::platform::long_side_for_width(w, h, max_width))?)
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
        .split([':', ' ', '-', 'T'])
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


/// Every detail the Mac reads from an image header (size, color, camera, lens, GPS, ...) as JSON,
/// for the info panel. Groups keep their names, for example "{Exif}" and "{GPS}".
pub fn image_properties(path: &Path) -> Option<serde_json::Value> {
    let src = source(path).ok()?;
    let props = unsafe { src.properties_at_index(0, None) }?;
    Some(cf_to_json(&props))
}

fn cf_to_json(value: &CFType) -> serde_json::Value {
    use serde_json::Value;
    if let Some(s) = value.downcast_ref::<CFString>() {
        return Value::String(s.to_string());
    }
    if let Some(b) = value.downcast_ref::<CFBoolean>() {
        return Value::Bool(b.as_bool());
    }
    if let Some(n) = value.downcast_ref::<CFNumber>() {
        return if n.is_float_type() {
            n.as_f64().and_then(serde_json::Number::from_f64).map_or(Value::Null, Value::Number)
        } else {
            n.as_i64().map_or(Value::Null, |i| Value::Number(i.into()))
        };
    }
    if let Some(d) = value.downcast_ref::<CFDictionary>() {
        let d: &CFDictionary<CFType, CFType> = unsafe { &*(d as *const CFDictionary as *const CFDictionary<CFType, CFType>) };
        let (keys, values) = d.to_vecs();
        let map = keys
            .iter()
            .zip(values.iter())
            .filter_map(|(k, v)| Some((k.downcast_ref::<CFString>()?.to_string(), cf_to_json(v))))
            .collect();
        return Value::Object(map);
    }
    if let Some(a) = value.downcast_ref::<CFArray>() {
        let a: &CFArray<CFType> = unsafe { &*(a as *const CFArray as *const CFArray<CFType>) };
        return Value::Array((0..a.len()).filter_map(|i| a.get(i)).map(|v| cf_to_json(&v)).collect());
    }
    Value::Null
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

    use crate::testutil::{temp_dir, write_png};
    use std::path::{Path, PathBuf};

    fn clip() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/clip.mov")
    }

    #[test]
    fn reads_sizes_properties_and_pixels() {
        let dir = temp_dir("macos-image");
        let png = dir.join("a.png");
        write_png(&png, 120, 80);
        assert_eq!(super::image_size(&png), Some((120, 80)));
        assert_eq!(super::image_size(&dir.join("gone.png")), None);

        let props = super::image_properties(&png).expect("properties");
        assert_eq!(props["PixelWidth"], 120);
        assert_eq!(props["PixelHeight"], 80);
        assert_eq!(super::date_taken_ms(&png), None, "no camera data");

        let small = super::decode_for_web(&png, 60).unwrap();
        assert_eq!((small.width, small.height), (60, 40));
        assert_eq!(small.data.len(), 60 * 40 * 4);
        assert!(small.opaque);
        let same = super::decode_for_web(&png, 1000).unwrap();
        assert_eq!(same.width, 120, "never scales up");

        assert_eq!(super::png_bytes(&png).unwrap(), std::fs::read(&png).unwrap(), "a PNG is used as it is");
        let frame = super::image_thumbnail(&png, 120).unwrap();
        let cut = super::crop(&frame, 10.0, 10.0, 30.0, 20.0).unwrap();
        let rgba = super::to_rgba(&cut).unwrap();
        assert_eq!((rgba.width, rgba.height), (30, 20));
    }

    #[test]
    fn writes_thumbnails_as_jpg_or_png() {
        let dir = temp_dir("macos-thumb");
        let png = dir.join("a.png");
        write_png(&png, 50, 50);
        let frame = super::image_thumbnail(&png, 50).unwrap();
        let ext = super::write_thumbnail(&frame, &dir.join("out")).unwrap();
        assert_eq!(ext, "jpg", "no transparency: JPG, smaller");
        assert!(dir.join("out.jpg").is_file());
    }

    #[test]
    fn reads_video_frames_and_length() {
        let frame = super::video_frame(&clip(), 160).expect("a frame");
        let rgba = super::to_rgba(&frame).unwrap();
        assert_eq!((rgba.width, rgba.height), (160, 120));
        let ms = super::video_duration_ms(&clip()).unwrap();
        assert!((900.0..=1100.0).contains(&ms), "{ms}");
        assert!(super::video_frame(Path::new("/no/such.mov"), 100).is_err());
    }

}
