# Kadar

Fast image viewer and image/video tool for macOS (Apple Silicon, macOS 15+). About 15 MB installed.

- **Viewer** — folder tree, favorites, thumbnail grid, full-size view for images and videos.
- **Optimize** — drop files or folders; get web-ready copies in an `optimized/` folder next to them.
  Images → WebP, JPG or PNG at a max width. Videos (MOV, MP4, MKV, WebM, AVI) → H.264 MP4 at 480p–1080p.
- **Record** — one window or the whole screen, with system sound and a microphone, to MP4.
- **Screenshot** — one app window to PNG or WebP, with resize, trim and scale.

## Run and build

Needs Rust (`~/.cargo/bin`), Node, and Xcode command line tools.

```bash
npm install
npm run dev     # run with live reload
npm run build   # signed Kadar.app and .dmg in src-tauri/target/release/bundle/
```

The first run builds a small ffmpeg (a few minutes, once). See below.

## How it is built

Tauri 2: a Rust program (`src-tauri/`) and the window content as plain TypeScript (`src/`), shown by the Mac's own WebKit. The window calls Rust commands; Rust sends events back (thumbnail ready, file progress).

| Part | Rust side | Mac framework / tool |
|---|---|---|
| Viewer | `fs_scan.rs`, `thumbs.rs`, `protocol.rs`, `watch.rs`, `favorites.rs` | ImageIO (thumbnails, sizes), AVFoundation (video frames) |
| Optimize | `optimize.rs`, `video.rs` | ImageIO decode → libwebp / mozjpeg / oxipng; small ffmpeg for video |
| Record | `recorder.rs` | ScreenCaptureKit records to a file; small ffmpeg mixes audio and makes the MP4 |
| Screenshot | `capture.rs` | Window list from CoreGraphics; system `screencapture` tool |

Mac-specific code lives in `macos.rs`, `recorder.rs` and `capture.rs`.

**Small ffmpeg.** `scripts/build-ffmpeg.sh` builds an 8 MB ffmpeg with only H.264 (x264), AAC and the needed readers and filters. The Mac's own H.264/HEVC encoders were tested and gave visibly worse video at the same file size. x264 is GPL, so this ffmpeg is GPL.

**Local files in the window** are served as `viewer-file://viewer/<path>` (with byte ranges for video).

**Signing.** Release builds are signed with the Prelako Developer ID (`src-tauri/tauri.conf.json`). A stable signature keeps the Screen Recording and microphone permissions across rebuilds. Not notarized yet; other Macs will warn on first open.

## Command-line optimizer

The original small tool, separate from the app:

```bash
node index.mjs <INPUT-FOLDER> [<MAX-WIDTH>]   # JPG/PNG → WebP in <INPUT-FOLDER>/optimized/
```
