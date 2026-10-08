//! Video compression with the small bundled ffmpeg: H.264 (x264) + AAC 128 kb/s MP4.
//! The Mac's own H.264 encoder was tested and gave visibly worse video at the same size,
//! so Kadar ships this tool instead. It is built by `app/scripts/build-ffmpeg.sh`.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

use serde::Deserialize;

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
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("ffmpeg")))
        .unwrap_or_else(|| PathBuf::from("ffmpeg"))
}

pub fn compress(src: &Path, dest: &Path, preset: Preset, progress: &dyn Fn(u32)) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write under a temp name; rename at the end so a stopped run leaves no broken .mp4.
    let tmp = dest.with_extension("part.mp4");

    let mut child = Command::new(ffmpeg_path())
        .args(["-y", "-hide_banner", "-nostdin", "-i"])
        .arg(src)
        .args([
            "-vf", &preset.filter(),
            "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats",
        ])
        .arg(&tmp)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start the video tool: {e}"))?;

    // ffmpeg prints "Duration: 00:01:23.45" on stderr; keep the log for error messages.
    let duration_ms = Arc::new(AtomicU64::new(0));
    let mut stderr = child.stderr.take().expect("stderr is piped");
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
    for line in BufReader::new(child.stdout.take().expect("stdout is piped")).lines().map_while(Result::ok) {
        let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<u64>().ok()) else { continue };
        let total = duration_ms.load(Ordering::Relaxed);
        if total > 0 {
            let p = (us / 1000 * 100 / total).min(99) as u32;
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
    }
}
