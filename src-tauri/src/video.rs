//! Video compression with the small bundled ffmpeg: H.264 (x264) + AAC 128 kb/s MP4.
//! The Mac's own H.264 encoder was tested and gave visibly worse video at the same size,
//! so Kadar ships this tool instead. It is built by `scripts/build-ffmpeg.sh`.

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

use serde::Deserialize;

/// The optimizer's video size: keep the size, or fit inside 1080p, 720p or 480p. Smaller videos
/// are never made bigger. The window sends "same", "1080p", "720p" or "480p".
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Preset {
    #[serde(rename = "same")]
    Same,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "480p")]
    P480,
}

impl Preset {
    /// Scale filter: fit inside the preset box (never scale up), even sizes as H.264 needs.
    fn filter(self) -> String {
        let fit = |w: u32, h: u32| {
            format!(
                "scale='min({w},iw)':'min({h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
            )
        };
        match self {
            Preset::Same => "scale=trunc(iw/2)*2:trunc(ih/2)*2".into(),
            Preset::P1080 => fit(1920, 1080),
            Preset::P720 => fit(1280, 720),
            Preset::P480 => fit(854, 480),
        }
    }
}

/// The tool sits next to the app's own program file, in the app bundle and in dev builds.
fn ffmpeg_path() -> PathBuf {
    let name = format!("ffmpeg{}", std::env::consts::EXE_SUFFIX);
    // Checks run from a build folder with no tool next to them: use the built one directly.
    if cfg!(test) {
        let built = if cfg!(target_os = "windows") { "ffmpeg-x86_64-pc-windows-msvc.exe" } else { "ffmpeg-aarch64-apple-darwin" };
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(built);
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(&name)))
        .unwrap_or_else(|| PathBuf::from(name))
}

/// Makes a web MP4 of `src` at `dest` (H.264 quality 23, AAC 128 kb/s). Blocks until done;
/// `progress` gets 1–99 percent. The error is the tool's last log line.
pub fn compress(src: &Path, dest: &Path, preset: Preset, progress: &dyn Fn(u32)) -> Result<(), String> {
    let filter = preset.filter();
    let args = [
        "-vf", &filter,
        "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
    ];
    let args: Vec<&OsStr> = args.iter().map(OsStr::new).collect();
    encode(src, dest, &args, progress)
}

/// Runs the tool on `src` with `args`, writing `dest`. Writes under a temp name and renames at
/// the end, so a stopped run never leaves a broken file that later runs would skip.
pub fn encode(src: &Path, dest: &Path, args: &[&OsStr], progress: &dyn Fn(u32)) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension("part.mp4");

    let mut child = Command::new(ffmpeg_path())
        .args(["-y", "-hide_banner", "-nostdin", "-i"])
        .arg(src)
        .args(args)
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(&tmp)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start the video tool: {e}"))?;

    // ffmpeg prints "Duration: 00:01:23.45" on stderr; keep the log for error messages.
    let duration_ms = Arc::new(AtomicU64::new(0));
    let mut stderr = child.stderr.take().ok_or("the video tool gave no log")?;
    let log = {
        let duration_ms = duration_ms.clone();
        thread::spawn(move || {
            let mut text = String::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                text.push_str(&String::from_utf8_lossy(&buf[..n]));
                if duration_ms.load(Ordering::Relaxed) == 0 {
                    if let Some(ms) = parse_duration(&text) {
                        duration_ms.store(ms, Ordering::Relaxed);
                    }
                }
            }
            text
        })
    };

    // Progress lines on stdout: "out_time_us=12345678".
    let mut last = 0;
    let stdout = child.stdout.take().ok_or("the video tool gave no progress")?;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<u64>().ok()) else { continue };
        if let Some(p) = (us / 1000 * 100).checked_div(duration_ms.load(Ordering::Relaxed)) {
            let p = p.min(99) as u32;
            if p > last {
                last = p;
                progress(p);
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let log = log.join().unwrap_or_default();
    if status.success() {
        std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
    } else {
        let _ = std::fs::remove_file(&tmp);
        let reason = log.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("video tool failed");
        Err(reason.trim().to_string())
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // used by the Mac recorder
/// Number of audio tracks in `path`, read from the tool's description of the file.
pub fn audio_track_count(path: &Path) -> usize {
    let Ok(out) = Command::new(ffmpeg_path()).args(["-hide_banner", "-nostdin", "-i"]).arg(path).output() else {
        return 0;
    };
    String::from_utf8_lossy(&out.stderr)
        .lines()
        .filter(|l| l.trim_start().starts_with("Stream #") && l.contains(": Audio:"))
        .count()
}

fn parse_duration(log: &str) -> Option<u64> {
    let rest = &log[log.find("Duration: ")? + 10..];
    let stamp = rest.split(',').next()?.trim();
    let mut parts = stamp.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(((h * 3600.0 + m * 60.0 + s) * 1000.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(parse_duration("  Duration: 00:00:32.08, start: 0.0"), Some(32_080));
        assert_eq!(parse_duration("  Duration: 01:02:03.50, start"), Some(3_723_500));
        assert_eq!(parse_duration("  Duration: N/A, start"), None);
        assert_eq!(parse_duration("no duration here"), None);
    }

    #[test]
    fn presets_fit_inside_their_box_and_never_grow() {
        assert_eq!(Preset::Same.filter(), "scale=trunc(iw/2)*2:trunc(ih/2)*2");
        let p720 = Preset::P720.filter();
        assert!(p720.contains("min(1280,iw)") && p720.contains("min(720,ih)"), "{p720}");
        assert!(p720.contains("force_divisible_by=2"), "H.264 needs even sizes");
        assert!(Preset::P1080.filter().contains("min(1920,iw)"));
        assert!(Preset::P480.filter().contains("min(854,iw)"));
        let names: Vec<Preset> = serde_json::from_str(r#"["same","1080p","720p","480p"]"#).unwrap();
        assert_eq!(names, [Preset::Same, Preset::P1080, Preset::P720, Preset::P480]);
    }

    /// The 1-second clip (320×240, H.264 + AAC) in tests/data, made once with a full ffmpeg.
    fn clip() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("data").join("clip.mov")
    }

    #[test]
    #[cfg_attr(target_os = "windows", ignore = "the Windows ffmpeg is not built yet (Roadmap)")]
    fn compresses_a_clip_to_mp4() {
        let dir = crate::testutil::temp_dir("video-compress");
        let dest = dir.join("out").join("clip.mp4");
        let calls = std::cell::Cell::new(0);
        compress(&clip(), &dest, Preset::P720, &|p| {
            assert!(p <= 99, "100% is for the caller to show when done");
            calls.set(calls.get() + 1);
        })
        .expect("compressed");
        assert!(dest.is_file());
        assert!(!dest.with_extension("part.mp4").exists(), "the temp file is renamed");
        assert_eq!(audio_track_count(&dest), 1, "the sound is kept");
        let info = Command::new(ffmpeg_path()).args(["-hide_banner", "-i"]).arg(&dest).output().unwrap();
        assert!(String::from_utf8_lossy(&info.stderr).contains("320x240"), "a small clip is not made bigger");
    }

    #[test]
    #[cfg_attr(target_os = "windows", ignore = "the Windows ffmpeg is not built yet (Roadmap)")]
    fn a_failed_run_leaves_no_file_and_says_why() {
        let dir = crate::testutil::temp_dir("video-fail");
        let src = dir.join("broken.mov");
        std::fs::write(&src, b"this is not a video").unwrap();
        let dest = dir.join("broken.mp4");
        let err = compress(&src, &dest, Preset::Same, &|_| {}).unwrap_err();
        assert!(!err.is_empty());
        assert!(!dest.exists() && !dest.with_extension("part.mp4").exists());
        assert_eq!(audio_track_count(&src), 0);
        assert_eq!(audio_track_count(&clip()), 1);
    }
}
