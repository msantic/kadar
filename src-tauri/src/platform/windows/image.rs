//! Image and video work through Windows' own tools. Windows Imaging Component (WIC) decodes
//! JPEG, PNG, TIFF, GIF, BMP and, with Microsoft's free add-ons, HEIC and camera RAW; it scales
//! with high quality and reads the camera data through Windows' photo names
//! ("System.Photo.DateTaken"). Video frames and length come from the Explorer shell, which uses
//! Windows' own video decoders. No image or video library is bundled for this.
//!
//! Colors: pixels are taken as sRGB. Wide-gamut photos (Display P3) show slightly less saturated
//! than on the Mac until color conversion is added.

use std::cell::RefCell;
use std::path::Path;

use serde_json::{json, Map, Value};
use windows::core::HSTRING;
use windows::Win32::Foundation::{FILETIME, GENERIC_READ, SIZE};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppRGBA, IWICBitmapFrameDecode, IWICBitmapSource,
    IWICImagingFactory, IWICMetadataQueryReader, WICBitmapDitherTypeNone, WICBitmapInterpolationModeHighQualityCubic,
    WICBitmapPaletteTypeCustom, WICBitmapTransformFlipHorizontal, WICBitmapTransformFlipVertical,
    WICBitmapTransformOptions, WICBitmapTransformRotate0, WICBitmapTransformRotate180, WICBitmapTransformRotate270,
    WICBitmapTransformRotate90, WICDecodeMetadataCacheOnDemand, WICRect,
};
use windows::Win32::Storage::EnhancedStorage::PKEY_Media_Duration;
use windows::Win32::System::Com::StructuredStorage::{
    PropVariantClear, PropVariantToDouble, PropVariantToFileTime, PropVariantToStringAlloc, PropVariantToUInt32, PROPVARIANT,
};
use windows::Win32::System::Variant::{PSTF_LOCAL, PSTF_UTC};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Time::FileTimeToSystemTime;
use windows::Win32::UI::Shell::{IShellItem2, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_RESIZETOFIT};

use super::{backslashes, com};
use crate::platform::Rgba;

/// A decoded image on Windows: sRGB pixels with straight alpha, already turned upright.
pub type Frame = Rgba;

thread_local! {
    static FACTORY: RefCell<Option<IWICImagingFactory>> = const { RefCell::new(None) };
}

/// WIC's factory for this thread, made once.
fn factory() -> Result<IWICImagingFactory, String> {
    com();
    FACTORY.with(|cell| {
        if let Some(f) = cell.borrow().as_ref() {
            return Ok(f.clone());
        }
        // SAFETY: creates the in-process WIC factory; COM runs on this thread (`com`).
        let f: IWICImagingFactory =
            unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }.map_err(|e| e.message())?;
        *cell.borrow_mut() = Some(f.clone());
        Ok(f)
    })
}

/// The first frame of the file, not decoded yet.
fn first_frame(path: &Path) -> Result<IWICBitmapFrameDecode, String> {
    let f = factory()?;
    let name = HSTRING::from(backslashes(&path.to_string_lossy()));
    // SAFETY: plain WIC calls on a valid factory and path.
    unsafe {
        let decoder = f
            .CreateDecoderFromFilename(&name, None, GENERIC_READ, WICDecodeMetadataCacheOnDemand)
            .map_err(|_| "cannot decode image".to_string())?;
        decoder.GetFrame(0).map_err(|_| "cannot decode image".to_string())
    }
}

/// The frame's camera data, or None for formats without it.
fn metadata(frame: &IWICBitmapFrameDecode) -> Option<IWICMetadataQueryReader> {
    // SAFETY: plain WIC call.
    unsafe { frame.GetMetadataQueryReader().ok() }
}

/// A value WIC returned; cleared when dropped.
struct Prop(PROPVARIANT);

impl Drop for Prop {
    fn drop(&mut self) {
        // SAFETY: clears a value WIC filled, once.
        let _ = unsafe { PropVariantClear(&mut self.0) };
    }
}

impl std::ops::Deref for Prop {
    type Target = PROPVARIANT;
    fn deref(&self) -> &PROPVARIANT {
        &self.0
    }
}

/// One value by its Windows photo name, for example "System.Photo.Orientation". None when the
/// file does not have it.
fn query(reader: &IWICMetadataQueryReader, name: &str) -> Option<Prop> {
    let mut value = Prop(PROPVARIANT::default());
    // SAFETY: WIC fills the value; `Prop` clears it when dropped.
    unsafe { reader.GetMetadataByName(&HSTRING::from(name), &mut value.0).ok()? };
    Some(value)
}

fn as_u32(v: &PROPVARIANT) -> Option<u32> {
    // SAFETY: converts a value WIC returned.
    unsafe { PropVariantToUInt32(v as *const PROPVARIANT).ok() }
}

fn as_f64(v: &PROPVARIANT) -> Option<f64> {
    // SAFETY: converts a value WIC returned.
    unsafe { PropVariantToDouble(v as *const PROPVARIANT).ok() }
}

fn as_string(v: &PROPVARIANT) -> Option<String> {
    // SAFETY: the string is allocated for us; it is copied, then freed once.
    unsafe {
        let p = PropVariantToStringAlloc(v as *const PROPVARIANT).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }
}

/// EXIF orientation 1–8 → the WIC turn that shows the photo upright.
fn upright(orientation: u32) -> WICBitmapTransformOptions {
    match orientation {
        2 => WICBitmapTransformFlipHorizontal,
        3 => WICBitmapTransformRotate180,
        4 => WICBitmapTransformFlipVertical,
        5 => WICBitmapTransformOptions(WICBitmapTransformRotate90.0 | WICBitmapTransformFlipHorizontal.0),
        6 => WICBitmapTransformRotate90,
        7 => WICBitmapTransformOptions(WICBitmapTransformRotate270.0 | WICBitmapTransformFlipHorizontal.0),
        8 => WICBitmapTransformRotate270,
        _ => WICBitmapTransformRotate0,
    }
}

/// Reads `source` as straight-alpha RGBA pixels.
fn pixels(source: &IWICBitmapSource) -> Result<Rgba, String> {
    let f = factory()?;
    // SAFETY: plain WIC calls; the buffer has exactly stride × height bytes.
    unsafe {
        let converter = f.CreateFormatConverter().map_err(|e| e.message())?;
        converter
            .Initialize(source, &GUID_WICPixelFormat32bppRGBA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom)
            .map_err(|e| e.message())?;
        let (mut w, mut h) = (0u32, 0u32);
        converter.GetSize(&mut w, &mut h).map_err(|e| e.message())?;
        let stride = w * 4;
        let mut data = vec![0u8; (stride * h) as usize];
        converter.CopyPixels(std::ptr::null(), stride, &mut data).map_err(|e| e.message())?;
        let opaque = data.as_chunks::<4>().0.iter().all(|px| px[3] == 255);
        Ok(Rgba { width: w, height: h, data, opaque })
    }
}

/// Scaled image no larger than `max_px` on its long side (never larger than the original),
/// turned upright from its camera data.
pub fn image_thumbnail(path: &Path, max_px: u32) -> Result<Frame, String> {
    let frame = first_frame(path)?;
    let f = factory()?;
    // SAFETY: plain WIC calls on objects that live until the end of this function.
    unsafe {
        let (mut w, mut h) = (0u32, 0u32);
        frame.GetSize(&mut w, &mut h).map_err(|e| e.message())?;
        let mut source: IWICBitmapSource = frame.clone().into();
        let long = w.max(h).max(1);
        if long > max_px {
            let scale = max_px as f64 / long as f64;
            let (sw, sh) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
            let scaler = f.CreateBitmapScaler().map_err(|e| e.message())?;
            scaler.Initialize(&source, sw, sh, WICBitmapInterpolationModeHighQualityCubic).map_err(|e| e.message())?;
            source = scaler.into();
        }
        let orientation = metadata(&frame).and_then(|r| query(&r, "System.Photo.Orientation")).and_then(|v| as_u32(&v)).unwrap_or(1);
        if orientation > 1 {
            let turner = f.CreateBitmapFlipRotator().map_err(|e| e.message())?;
            turner.Initialize(&source, upright(orientation)).map_err(|e| e.message())?;
            source = turner.into();
        }
        pixels(&source)
    }
}

/// The shell's picture of a file (for a video: a frame), at most `max_px` on its long side.
fn shell_picture(path: &Path, max_px: u32) -> Result<Frame, String> {
    com();
    let name = HSTRING::from(backslashes(&path.to_string_lossy()));
    // SAFETY: the shell returns a bitmap we own; it is read once and then deleted.
    unsafe {
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&name, None).map_err(|_| "cannot read video".to_string())?;
        let size = SIZE { cx: max_px as i32, cy: max_px as i32 };
        let bitmap: HBITMAP = factory.GetImage(size, SIIGBF_RESIZETOFIT).map_err(|_| "cannot read video".to_string())?;
        let result = bitmap_pixels(bitmap);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        result
    }
}

/// A shell bitmap → RGBA. Shell pictures come as premultiplied BGRA, bottom row first unless
/// asked otherwise; a picture with no alpha at all is fully opaque.
unsafe fn bitmap_pixels(bitmap: HBITMAP) -> Result<Rgba, String> {
    let mut info = BITMAP::default();
    if GetObjectW(HGDIOBJ(bitmap.0), std::mem::size_of::<BITMAP>() as i32, Some((&mut info as *mut BITMAP).cast())) == 0 {
        return Err("cannot read video".into());
    }
    let (w, h) = (info.bmWidth.max(1) as u32, info.bmHeight.unsigned_abs().max(1));
    let mut header = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w as i32,
        biHeight: -(h as i32), // top row first
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
        },
        ..Default::default()
    };
    let mut data = vec![0u8; (w * h * 4) as usize];
    let dc = GetDC(None);
    let rows = GetDIBits(dc, bitmap, 0, h, Some(data.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
    ReleaseDC(None, dc);
    if rows == 0 {
        return Err("cannot read video".into());
    }
    let no_alpha = data.as_chunks::<4>().0.iter().all(|px| px[3] == 0);
    for px in data.as_chunks_mut::<4>().0 {
        px.swap(0, 2); // BGRA → RGBA
        if no_alpha {
            px[3] = 255;
        }
    }
    let opaque = no_alpha || crate::platform::unpremultiply(&mut data);
    Ok(Rgba { width: w, height: h, data, opaque })
}

/// One frame of the video, at most `max_px` on its long side, from the shell's own thumbnail.
pub fn video_frame(path: &Path, max_px: u32) -> Result<Frame, String> {
    shell_picture(path, max_px)
}

/// Writes `frame` next to `dest_without_ext` as `.jpg`, or `.png` when it has transparency.
/// Returns the extension used.
pub fn write_thumbnail(frame: &Frame, dest_without_ext: &Path) -> Result<&'static str, String> {
    let (ext, bytes) = if frame.opaque {
        ("jpg", crate::optimize::encode_jpeg_q(frame, 80.0)?)
    } else {
        ("png", crate::optimize::encode_png(frame.clone(), 0)?)
    };
    std::fs::write(dest_without_ext.with_extension(ext), bytes).map_err(|e| e.to_string())?;
    Ok(ext)
}

/// Width and height in pixels as stored (before any camera turn); None when unreadable.
pub fn image_size(path: &Path) -> Option<(u32, u32)> {
    let frame = first_frame(path).ok()?;
    let (mut w, mut h) = (0u32, 0u32);
    // SAFETY: plain WIC call.
    unsafe { frame.GetSize(&mut w, &mut h).ok()? };
    Some((w, h))
}

/// The video's length in ms, from the shell (System.Media.Duration); None when unknown.
pub fn video_duration_ms(path: &Path) -> Option<f64> {
    com();
    let name = HSTRING::from(backslashes(&path.to_string_lossy()));
    // SAFETY: plain shell calls.
    unsafe {
        let item: IShellItem2 = SHCreateItemFromParsingName(&name, None).ok()?;
        let hundred_ns = item.GetUInt64(&PKEY_Media_Duration).ok()?;
        (hundred_ns > 0).then(|| hundred_ns as f64 / 10_000.0)
    }
}

/// Width and height in pixels.
pub fn frame_size(frame: &Frame) -> (u32, u32) {
    (frame.width, frame.height)
}

/// Cuts `rect` = (x, y, w, h) in pixels of the unturned `frame`, turns it `turns` quarter turns
/// clockwise and scales it to `out_w` × `out_h` with high quality.
pub fn draw_turned(frame: &Frame, rect: (f64, f64, f64, f64), turns: u8, out_w: usize, out_h: usize) -> Result<Rgba, String> {
    let f = factory()?;
    let (x, y, w, h) = rect;
    let clip = WICRect {
        X: (x.round() as i32).clamp(0, frame.width as i32 - 1),
        Y: (y.round() as i32).clamp(0, frame.height as i32 - 1),
        Width: (w.round() as i32).max(1),
        Height: (h.round() as i32).max(1),
    };
    let clip = WICRect {
        Width: clip.Width.min(frame.width as i32 - clip.X),
        Height: clip.Height.min(frame.height as i32 - clip.Y),
        ..clip
    };
    // SAFETY: plain WIC calls; the bitmap copies `frame`'s pixels, which outlive the call.
    unsafe {
        let bitmap = f
            .CreateBitmapFromMemory(frame.width, frame.height, &GUID_WICPixelFormat32bppRGBA, frame.width * 4, &frame.data)
            .map_err(|e| e.message())?;
        let clipper = f.CreateBitmapClipper().map_err(|e| e.message())?;
        clipper.Initialize(&bitmap, &clip).map_err(|e| e.message())?;
        let mut source: IWICBitmapSource = clipper.into();
        let turn = match turns % 4 {
            1 => WICBitmapTransformRotate90,
            2 => WICBitmapTransformRotate180,
            3 => WICBitmapTransformRotate270,
            _ => WICBitmapTransformRotate0,
        };
        if !turns.is_multiple_of(4) {
            let turner = f.CreateBitmapFlipRotator().map_err(|e| e.message())?;
            turner.Initialize(&source, turn).map_err(|e| e.message())?;
            source = turner.into();
        }
        let scaler = f.CreateBitmapScaler().map_err(|e| e.message())?;
        scaler.Initialize(&source, out_w as u32, out_h as u32, WICBitmapInterpolationModeHighQualityCubic).map_err(|e| e.message())?;
        pixels(&scaler.into())
    }
}

/// Full image, turned upright, scaled down so its width is at most `max_width`.
pub fn decode_for_web(path: &Path, max_width: u32) -> Result<Rgba, String> {
    let (w, h) = image_size(path).ok_or("cannot read image")?;
    let long = w.max(h);
    let long = if w > max_width { ((long as f64) * (max_width as f64) / (w as f64)).round() as u32 } else { long };
    image_thumbnail(path, long)
}

/// The image as PNG bytes, for the clipboard. PNG files are used as they are; other formats are
/// decoded at full size and turned upright.
pub fn png_bytes(path: &Path) -> Option<Vec<u8>> {
    if crate::formats::ext_of(&path.to_string_lossy()) == "png" {
        return std::fs::read(path).ok();
    }
    let (w, h) = image_size(path)?;
    let frame = image_thumbnail(path, w.max(h)).ok()?;
    crate::optimize::encode_png(frame, 0).ok()
}

/// A Windows time → ms since 1970.
fn unix_ms(ft: FILETIME) -> f64 {
    let ticks = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    (ticks as f64 - 116_444_736_000_000_000.0) / 10_000.0
}

/// When the photo was taken, from its camera data, as ms since 1970. The camera writes local
/// time without a zone; Windows reads it as this PC's local time, as the Mac does.
pub fn date_taken_ms(path: &Path) -> Option<f64> {
    let frame = first_frame(path).ok()?;
    let value = query(&metadata(&frame)?, "System.Photo.DateTaken")?;
    // SAFETY: converts a value WIC returned.
    let ft = unsafe { PropVariantToFileTime(&*value as *const PROPVARIANT, PSTF_UTC).ok()? };
    Some(unix_ms(ft))
}

/// "2025:01:03 15:47:35" in local time, the way the Mac reports the camera date.
fn exif_text(value: &PROPVARIANT) -> Option<String> {
    // SAFETY: converts a value WIC returned into local time.
    unsafe {
        let ft = PropVariantToFileTime(value as *const PROPVARIANT, PSTF_LOCAL).ok()?;
        let mut t = Default::default();
        FileTimeToSystemTime(&ft, &mut t).ok()?;
        Some(format!("{:04}:{:02}:{:02} {:02}:{:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond))
    }
}

/// GPS degrees, minutes, seconds (three numbers) → decimal degrees.
fn degrees(value: &PROPVARIANT) -> Option<f64> {
    use windows::Win32::System::Com::StructuredStorage::PropVariantToDoubleVectorAlloc;
    // SAFETY: Windows allocates the list for us; it is read, then freed once.
    unsafe {
        let mut ptr: *mut f64 = std::ptr::null_mut();
        let mut count = 0u32;
        PropVariantToDoubleVectorAlloc(value as *const PROPVARIANT, &mut ptr, &mut count).ok()?;
        let parts = std::slice::from_raw_parts(ptr, count as usize).to_vec();
        CoTaskMemFree(Some(ptr as _));
        let d = parts.first().copied()? + parts.get(1).copied().unwrap_or(0.0) / 60.0 + parts.get(2).copied().unwrap_or(0.0) / 3600.0;
        Some(d)
    }
}

/// The details the info panel shows, as JSON in the same shape the Mac gives ("PixelWidth",
/// "{Exif}", "{TIFF}", "{GPS}" ...), so the window reads both the same way.
pub fn image_properties(path: &Path) -> Option<Value> {
    let frame = first_frame(path).ok()?;
    let (mut w, mut h) = (0u32, 0u32);
    // SAFETY: plain WIC call.
    unsafe { frame.GetSize(&mut w, &mut h).ok()? };
    let mut top = Map::new();
    top.insert("PixelWidth".into(), json!(w));
    top.insert("PixelHeight".into(), json!(h));
    let Some(reader) = metadata(&frame) else { return Some(Value::Object(top)) };
    let q = |name: &str| query(&reader, name);
    let num = |name: &str| q(name).and_then(|v| as_f64(&v));
    let text = |name: &str| q(name).and_then(|v| as_string(&v));
    let put = |map: &mut Map<String, Value>, key: &str, value: Option<Value>| {
        if let Some(v) = value {
            map.insert(key.into(), v);
        }
    };

    put(&mut top, "Orientation", q("System.Photo.Orientation").and_then(|v| as_u32(&v)).map(|n| json!(n)));
    put(&mut top, "Depth", q("System.Image.BitDepth").and_then(|v| as_u32(&v)).map(|n| json!(n / 4)));

    let mut tiff = Map::new();
    put(&mut tiff, "Make", text("System.Photo.CameraManufacturer").map(Value::String));
    put(&mut tiff, "Model", text("System.Photo.CameraModel").map(Value::String));
    put(&mut tiff, "Software", text("System.ApplicationName").map(Value::String));

    let mut exif = Map::new();
    put(&mut exif, "DateTimeOriginal", q("System.Photo.DateTaken").and_then(|v| exif_text(&v)).map(Value::String));
    put(&mut exif, "FNumber", num("System.Photo.FNumber").map(|n| json!(n)));
    put(&mut exif, "ExposureTime", num("System.Photo.ExposureTime").map(|n| json!(n)));
    put(&mut exif, "ISOSpeedRatings", num("System.Photo.ISOSpeed").map(|n| json!([n])));
    put(&mut exif, "FocalLength", num("System.Photo.FocalLength").map(|n| json!(n)));
    put(&mut exif, "FocalLenIn35mmFilm", num("System.Photo.FocalLengthInFilm").map(|n| json!(n)));
    put(&mut exif, "ExposureBiasValue", num("System.Photo.ExposureBias").map(|n| json!(n)));
    put(&mut exif, "Flash", q("System.Photo.Flash").and_then(|v| as_u32(&v)).map(|n| json!(n)));
    put(&mut exif, "LensModel", text("System.Photo.LensModel").map(Value::String));

    let mut gps = Map::new();
    put(&mut gps, "Latitude", q("System.GPS.Latitude").and_then(|v| degrees(&v)).map(|n| json!(n)));
    put(&mut gps, "LatitudeRef", text("System.GPS.LatitudeRef").map(Value::String));
    put(&mut gps, "Longitude", q("System.GPS.Longitude").and_then(|v| degrees(&v)).map(|n| json!(n)));
    put(&mut gps, "LongitudeRef", text("System.GPS.LongitudeRef").map(Value::String));
    put(&mut gps, "Altitude", num("System.GPS.Altitude").map(|n| json!(n)));

    for (key, map) in [("{TIFF}", tiff), ("{Exif}", exif), ("{GPS}", gps)] {
        if !map.is_empty() {
            top.insert(key.into(), Value::Object(map));
        }
    }
    Some(Value::Object(top))
}


#[cfg(test)]
mod tests {
    use crate::testutil::{temp_dir, write_png};

    #[test]
    fn reads_sizes_and_pixels() {
        let dir = temp_dir("win-image");
        let png = dir.join("a.png");
        write_png(&png, 120, 80);
        assert_eq!(super::image_size(&png), Some((120, 80)));
        assert_eq!(super::image_size(&dir.join("gone.png")), None);
        let small = super::decode_for_web(&png, 60).unwrap();
        assert_eq!((small.width, small.height), (60, 40));
        assert!(small.opaque);
        let props = super::image_properties(&png).unwrap();
        assert_eq!(props["PixelWidth"], 120);
        assert_eq!(super::date_taken_ms(&png), None, "no camera data");
    }

    #[test]
    fn turns_and_cuts() {
        let dir = temp_dir("win-turn");
        let png = dir.join("a.png");
        write_png(&png, 40, 30);
        let frame = super::image_thumbnail(&png, 40).unwrap();
        let turned = super::draw_turned(&frame, (0.0, 0.0, 40.0, 30.0), 1, 30, 40).unwrap();
        assert_eq!((turned.width, turned.height), (30, 40));
        let part = super::draw_turned(&frame, (10.0, 5.0, 20.0, 10.0), 0, 20, 10).unwrap();
        assert_eq!((part.width, part.height), (20, 10));
    }

    #[test]
    fn writes_thumbnails() {
        let dir = temp_dir("win-thumb");
        let png = dir.join("a.png");
        write_png(&png, 50, 50);
        let frame = super::image_thumbnail(&png, 25).unwrap();
        assert_eq!(super::write_thumbnail(&frame, &dir.join("out")).unwrap(), "jpg");
        assert_eq!(super::image_size(&dir.join("out.jpg")), Some((25, 25)));
    }
}
