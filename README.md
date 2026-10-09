# Kadar

Fast image viewer and image/video tool. Today for macOS (Apple Silicon, macOS 15+), about 15 MB
installed. Windows and Linux are planned: see [Roadmap](#roadmap-windows-and-linux).

- **Viewer** — folder tree, favorites, thumbnail grid, full-size view for images and videos.
- **Optimize** — drop files or folders; get web-ready copies in an `optimized/` folder next to them.
  Images → WebP, JPG or PNG at a max width. Videos (MOV, MP4, MKV, WebM, AVI) → H.264 MP4 at 480p–1080p.
- **Record** — one window or the whole screen, with system sound and a microphone, to MP4.
- **Screenshot** — one app window to PNG or WebP, with resize, trim and scale.

## Documentation

| Guide | For |
|---|---|
| [User guide](docs/user-guide.md) | Every feature, key and setting, tab by tab. |
| [Architecture](docs/architecture.md) | How the Rust side and the window fit together; data on disk; speed design. |
| [Development](docs/development.md) | Setup, checks, build, install, signing, ffmpeg, known traps, speed measuring. |
| [Decisions](docs/decisions.md) | Lasting choices and why they were made. |

Every code file starts with a comment that says what it is for, and every public function has a
doc comment. `npm run check` fails when one is missing.

## Run and build

Needs Rust (`~/.cargo/bin`), Node, and Xcode command line tools.

```bash
npm install
npm run dev     # run with live reload
npm run check   # types, window checks, docs check, Rust code checker, Rust checks
npm run build   # all checks, then signed Kadar.app and .dmg in src-tauri/target/release/bundle/
```

The first run builds a small ffmpeg (a few minutes, once). See below.

## How it is built

Tauri 2: a Rust program (`src-tauri/`) and the window content as plain TypeScript (`src/`), shown by the Mac's own WebKit. The window calls Rust commands; Rust sends events back (thumbnail ready, file progress).

| Part | Rust side | Mac framework / tool |
|---|---|---|
| Viewer | `fs_scan.rs`, `thumbs.rs`, `protocol.rs`, `watch.rs`, `favorites.rs` | ImageIO (thumbnails, sizes), AVFoundation (video frames) |
| Optimize | `optimize.rs`, `video.rs` | ImageIO decode → libwebp / mozjpeg / oxipng; small ffmpeg for video |
| Record | `platform/macos/recorder.rs` | ScreenCaptureKit records to a file; small ffmpeg mixes audio and makes the MP4 |
| Screenshot | `platform/macos/capture.rs` | Window list from CoreGraphics; system `screencapture` tool |

All code that calls the operating system lives in `src-tauri/src/platform/`, one folder per system (`platform/macos/` today). The window asks `src/platform.ts` for the command key and the system's words.

**Small ffmpeg.** `scripts/build-ffmpeg.sh` builds an 8 MB ffmpeg with only H.264 (x264), AAC and the needed readers and filters. The Mac's own H.264/HEVC encoders were tested and gave visibly worse video at the same file size. x264 is GPL, so this ffmpeg is GPL.

**Local files in the window** are served as `viewer-file://viewer/<path>` (with byte ranges for video).

**Signing.** Release builds are signed with the Prelako Developer ID (`src-tauri/tauri.conf.json`). A stable signature keeps the Screen Recording and microphone permissions across rebuilds. `scripts/notarize.sh` makes a notarized installer to share (see docs/development.md).

## Roadmap: Windows and Linux

**Final goal:** every feature (Viewer, Optimize, Export for Web, Screenshot, Record) on macOS,
Windows and Linux, and each download stays small.

**First step (decided 2026-10-09):** Windows, with the Viewer, Optimize and Export for Web.
Screenshot, Record and Linux come after it. Code written for the first step must not block them.

### Rules for all new work, starting now

1. **Each system's own tools first.** The Mac uses ImageIO and AVFoundation; Windows uses its
   own image and video tools (WIC, Media Foundation); Linux uses the standard system libraries.
   Do not bundle a large cross-platform image or video library to save code. Size matters more.
2. **One shared core, one thin layer per system.** Everything that calls the operating system
   lives behind one Rust folder per system (`src-tauri/src/platform/macos/`, later `windows/`
   and `linux/`) with the same modules and functions; `platform/mod.rs` lists them. Shared code (thumbnail queue, cache, export
   geometry, optimize naming, file serving, sorting) never calls a system API directly. New
   Mac-only code goes into the Mac layer from now on.
3. **Shared libraries stay shared.** libwebp, mozjpeg, oxipng, notify and the small ffmpeg work
   on all three. ffmpeg is built once per system with the same flags.
4. **One download per system.** The Mac download does not grow because of Windows or Linux.
5. **Keys and words follow the system.** ⌘ on the Mac, Ctrl on Windows and Linux. "Finder" on
   the Mac, "File Explorer" on Windows, "Files" on Linux. The window code asks one helper for
   the key and the words; it never names ⌘ or Finder directly.
6. **Every check runs on every system.** Build machines run `npm run check` on macOS, Windows
   and Linux before a release.

### What each Mac part becomes

| Part | macOS (today) | Windows | Linux |
|---|---|---|---|
| Read images, thumbnails, size, camera data | ImageIO | WIC (built in) | gdk-pixbuf (comes with WebKitGTK) |
| HEIC photos | ImageIO | WIC + Microsoft HEIF add-on (free, often present) | libheif (system package) |
| RAW photos, big-view preview | ImageIO | WIC + Microsoft Raw Image add-on (free, often present) | libraw (system package) |
| Photoshop (PSD) preview | ImageIO | Open question: no built-in reader | Open question |
| Video frame and length | AVFoundation | Media Foundation | the bundled ffmpeg |
| Copy files and picture | NSPasteboard | Windows clipboard (file list + PNG) | GTK clipboard (file list + PNG) |
| Drag files out | NSDraggingSession | OLE drag (Copy only) | GTK drag (Copy only) |
| Trash and Put Back | NSFileManager | Recycle Bin | freedesktop Trash |
| Show in file manager, open in default app | `open`, Finder | File Explorer, default app | file manager over D-Bus, `xdg-open` |
| Skip online-only cloud files | "dataless" file flag | "recall on access" file attribute | not needed |
| Thumbnail workers | performance cores | performance cores | all cores |
| Open from the file manager | Apple open event | start arguments + single instance | start arguments + single instance |
| Menu bar | app menu at the top | menu in the window | menu in the window |
| Browser engine | WebKit (built in) | WebView2 (built into Windows 10/11) | WebKitGTK (system package; video needs GStreamer) |
| Screenshot of a window | `screencapture`, window list | Windows Graphics Capture | X11 window capture; Wayland asks the user to pick |
| Record a window with sound | ScreenCaptureKit | Windows Graphics Capture + loopback sound, ffmpeg | PipeWire through the desktop portal |
| Resize another app's window | AppleScript | Windows window API | X11 only; hidden on Wayland |
| Signing and trust | Developer ID + notarization | code-signing certificate (yearly cost) | none; .deb, .rpm, AppImage |

### Expected download size

- macOS: 15 MB, as today.
- Windows: about 15–20 MB (WebView2 and the image reader are part of Windows).
- Linux .deb / .rpm: about 15 MB; the system libraries are listed as requirements.
- Linux AppImage (runs without install): 40–60 MB, because it must include those libraries.

### Order of work

1. **Prepare on the Mac.** Done 2026-10-09: all Mac calls are behind `src-tauri/src/platform/macos/`,
   the Mac crates build only for macOS, and the window asks `src/platform.ts` for keys and words.
2. **Build machines.** Builds and checks run on macOS, Windows and Linux for every change.
3. **Windows: Viewer, Optimize, Export for Web.** (The first step.)
4. **Windows installer and signing.**
5. **Linux: Viewer, Optimize, Export for Web.**
6. **Screenshot** on Windows, then Linux.
7. **Record** on Windows, then Linux.

### Build machines (office server)

Builds for Windows and Linux run on the office server (`10.10.10.4`, Ubuntu 24.04), all driven
from the Mac over SSH, as the BIMTLY Showroom does. Its runbook is
`~/dev/bimtly/devops/conf/office/vm/README.md` (the `bimtly` repo).

- **Windows: the existing `winbuild` machine.** Windows 11 in a virtual machine on the office
  server, reached as `ssh marko@10.10.10.4`, then `ssh build@192.168.122.12` (PowerShell). It has
  Git, Node 22, Python, Visual Studio 2022 Build Tools with the Windows SDK, and WebView2. Kadar
  needs only Rust added (rustup, MSVC). The machine runs on demand: `make start` / `make stop` in
  its role folder on the server, because it shares the server with production work.
- **Linux: a new small virtual machine** (Ubuntu 24.04 desktop, no graphics card), made with the
  same tools as `winbuild`. Not on the server itself: the server runs production, and its package
  setup already has a known conflict.
- **From the Mac:** one script sends the work to the machine (the pushed commit from GitHub, or a
  git bundle for work that is not pushed, as the Showroom runbook describes), runs
  `npm run check` and the build there, and copies the installer back.
- **The Windows video tool:** the small ffmpeg must be built for Windows once; cross-built on the
  Linux machine, or built on `winbuild` with MSYS2. Decide when the Windows step starts.

### Open questions for the owner

- Windows signing: a yearly certificate, or Microsoft's signing service, or none at first
  (Windows then shows an "unknown publisher" warning).
- Photoshop files on Windows and Linux: skip them, or add a small PSD reader.
- Which Linux systems to test: Ubuntu only, or also Fedora.

