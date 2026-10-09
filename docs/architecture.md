# Kadar architecture

For a developer (or AI session) who must change Kadar safely. Read `CLAUDE.md` first: it has the
decisions you must not re-open and the traps already hit. Build and run steps are in
[development.md](development.md).

Kadar is a macOS-only (Apple Silicon, macOS 15+) Tauri 2 app with four tabs: **Viewer**,
**Optimize**, **Record** and **Screenshot**.

## 1. The big picture

Two parts run in one app process:

- **Rust core** (`src-tauri/src`): files, thumbnails, encoding, recording, clipboard, drag, menu.
  It uses Mac frameworks through `objc2-*` crates and one bundled program, `ffmpeg`.
- **Window** (`src/`, `index.html`): plain TypeScript, no framework, shown in WKWebView. Vite
  serves it in dev (`127.0.0.1:1420`) and bundles it into `dist/` for release.

They talk in three ways:

| Way | Direction | How | Example |
|---|---|---|---|
| Commands | window → Rust | `invoke('name', { camelCaseArgs })`; Rust `#[tauri::command]` in `commands.rs`, listed in `lib.rs` | `invoke('list_folder', { dirPath })` |
| Events | Rust → window | `app.emit("name", payload)`; window `listen()` | `viewer:thumb:ready`, `file-progress` |
| `viewer-file://` | window → Rust | custom URI scheme for `<img>` / `<video>` bytes, served by `protocol.rs` | `viewer-file://viewer/Users/me/a%20b.jpg` |

```
 ┌──────────────────────── WKWebView (src/) ────────────────────────┐
 │ main.ts (tabs) ── bridge.ts: window.viewer / window.optimizer    │
 │   viewer/*  optimize.ts  recorder.ts  screenshot.ts              │
 └──────┬──────────────────────▲─────────────────────────┬──────────┘
        │ invoke(cmd, args)     │ emit(event, payload)    │ <img src="viewer-file://viewer/...">
        ▼                       │                         ▼
 ┌──────────────────────── Rust core (src-tauri/src) ───────────────┐
 │ commands.rs ──► fs_scan, thumbs, taken, favorites, watch,        │
 │                 export, optimize/video, recorder, capture,       │
 │                 clipboard, drag             protocol.rs (+ RAW/  │
 │ menu.rs ── "menu" event ──► window          PSD previews)        │
 └──────┬───────────────────────────────────────────────┬───────────┘
        ▼                                               ▼
  ImageIO / AVFoundation / ScreenCaptureKit /     bundled ffmpeg (x264 + AAC),
  CoreGraphics / AppKit (pasteboard, drag)        `screencapture`, `osascript`, `open`
```

**Command threads.** Commands marked `#[tauri::command(async)]` run on Tauri's worker threads and
may block. Commands without `(async)` run on the main thread; keep them quick (`take_opened`,
`get_roots`, `fav_*`, `watch_folder`, `thumb_cancel`, `capture_permissions`, `open_external`, ...).

**`viewer-file://` details** (`protocol.rs`):

- The path is percent-decoded from the URL. The window builds it with `fileUrl()` in `viewer/ipc.ts`.
- Byte ranges are supported (`bytes=a-b`, `bytes=a-`, `bytes=-n`); video needs them. An open-ended
  range returns at most 4 MB, so video starts fast. No `Range` header returns the whole file.
- RAW and PSD files (`formats::needs_preview`) are served as a full-size JPG (PNG if transparent)
  made once with ImageIO and cached in `thumb-cache/pv/`. One global lock makes one copy at a time.
- Each request runs on `spawn_blocking`. Only image and video files are served (`formats::kind_of`);
  any other path gets 403, so the page cannot read other files on the Mac.
- The window runs under a content security policy (`tauri.conf.json` › `security.csp`): scripts
  and styles from the app only, images and media from the app, `data:` and `viewer-file:`,
  connections only to Tauri's IPC. `devCsp` adds the Vite reload socket. Tauri must not add
  hashes to `style-src` (`dangerousDisableAssetCspModification`), or the inline SVG styles in
  `index.html` stop working.

## 2. Rust modules

All code that calls the operating system lives in `src/platform/`, one folder per system
(`platform/macos/`, `platform/windows/` since 2026-10-09; Linux follows the Roadmap in README.md; Windows details in [windows.md](windows.md)). `platform/mod.rs`
lists what every system must offer and holds the shared pixel type `Rgba` and `unpremultiply`.
The shared modules below call `platform::image`, `platform::system`, `platform::clipboard`,
`platform::drag`, `platform::capture` and `platform::recorder`, never a system API directly. The
Mac crates (objc2, libc, ...) are listed for macOS builds only in `Cargo.toml`.

| File | Job | Mac framework / crate | Threads |
|---|---|---|---|
| `main.rs` | Calls `kadar_lib::run()` | — | main |
| `lib.rs` | Builds the app: plugins, `viewer-file` scheme, menu, managed state, command list; handles `RunEvent::Opened`; saves window state on move/resize | tauri, `tauri-plugin-window-state`, `tauri-plugin-dialog` | main; one short thread per move/resize (500 ms debounce) |
| `commands.rs` | Every command; put back, rename and meta live here directly; trash and opening go to `platform::system` | — | Tauri worker or main (see above) |
| `formats.rs` | Image / video / unsupported by extension only; MIME types; which files need a preview | — | any |
| `fs_scan.rs` | Folder listing (skips dot files, stops at 50,000 entries), tree children, Finder-style natural sort | std::fs | command thread |
| `watch.rs` | Watches the open folder (not recursive), 200 ms quiet time, emits `viewer:fs:changed` | `notify` (FSEvents) | notify thread + one debounce thread |
| `thumbs.rs` | Thumbnail queue, workers, disk cache, eviction | `platform::image`; `sha1_smol` | one worker per performance core + hourly sweep thread |
| `taken.rs` | "Date Taken" from EXIF, cached in a JSON file | `platform::image` | scoped threads, one per core |
| `favorites.rs` | Favorite folders, loaded lazily, saved atomically | serde_json, uuid | caller |
| `protocol.rs` | `viewer-file://` handler, ranges, RAW/PSD previews, media files only | `platform::image` | `spawn_blocking` per request |
| `platform/macos/image.rs` | ImageIO thumbnails, sizes, EXIF date, all properties as JSON, AVFoundation frame and duration, RGBA render, crop, `draw_turned` (export drawing), PNG bytes | ImageIO, CoreGraphics, AVFoundation | any (AVFoundation in `autoreleasepool`) |
| `export.rs` | Export for Web: single, reference (Compare), batch, save next to source; the crop and turn geometry | `platform::image::draw_turned`; encoders from `optimize.rs` | command thread; batch on scoped threads, one per core |
| `optimize.rs` | Optimize tab: expand drops, encode images (WebP / mozjpeg / oxipng), queue videos | `webp`, `mozjpeg`, `oxipng`, `slug` | one video thread + one image thread per core |
| `video.rs` | Runs bundled `ffmpeg`, parses progress; counts audio tracks | ffmpeg (child process) | caller + one stderr reader thread |
| `platform/macos/recorder.rs` | Screen / window recording to an HEVC file, then the final MP4 | ScreenCaptureKit, AVFoundation (mic), ffmpeg | command thread waits on SCK callbacks (15 s timeout) |
| `platform/macos/capture.rs` | Window list, screenshot via `screencapture -l <id>`, resize via AppleScript, permissions | CoreGraphics window list, `screencapture`, `osascript` | command thread |
| `platform/macos/clipboard.rs` | Copy files (file URLs + PNG for one image), paths or text | AppKit NSPasteboard | runs on main thread and waits |
| `platform/macos/drag.rs` | Native file drag out of Kadar, Copy only | AppKit NSDraggingSession | main thread (not awaited) |
| `platform/macos/system.rs` | Trash, reveal in Finder, open default app / URL, "dataless" cloud files, performance cores, menu words | NSFileManager, `open`, `sysctl` | caller |
| `menu.rs` | Menu bar; forwards clicks as a `menu` event; words from `platform::system` | tauri menu | main |
| `sync.rs` | Poison-tolerant `lock`, `wait`, `into_inner` | std | — |
| `testutil.rs` | Temp folders and generated PNGs for checks (`#[cfg(test)]` only) | oxipng | — |

### Thumbnails (`thumbs.rs`)

```
grid render ─► ThumbLoader.request() ─(1 rAF batch)─► thumb_request(requestId, files, 256)
                                                        │
                    cached ◄── lookup <hash>.jpg|png ◄──┤ (hit: touch mtime for LRU)
                                                        └─► queue.extend(jobs.rev())
 workers: pop_back() ─► ImageIO / AVFoundation ─► write .part ─► rename ─► emit viewer:thumb:ready
```

- **Order: newest request first.** New jobs are appended reversed; workers `pop_back()`. After a
  fast scroll, the rows on screen now come before the rows passed on the way, and each batch still
  starts at its top-left.
- **Workers:** `hw.perflevel0.physicalcpu` (performance cores), clamped to 2–12. Fallback:
  `available_parallelism() - 2`. The comment records ~320 thumbnails/s with 10 workers.
- **Size:** the window asks for 256; Rust makes `256 × PIXEL_RATIO (2)` = 512 px on the long side,
  EXIF rotation applied. Video: one frame at 1 s (or the first frame).
- **Cache:** `<app data>/thumb-cache/<2 hex>/<16 hex>.jpg` (PNG when the image has alpha), JPEG
  quality 0.8. Key = SHA-1 of `path:mtimeMs:size:THUMB_VERSION:targetSize`. Bump `THUMB_VERSION`
  when output changes.
- **Eviction:** a sweep thread runs at start and every hour. Over 1 GB, it deletes the least
  recently used files (by mtime) down to 800 MB. RAW previews in `pv/` count too.
- **Events:** `viewer:thumb:ready {requestId, srcPath, cachePath}` and
  `viewer:thumb:error {requestId, srcPath, message}`. The window does not ask again for a failed
  file until the folder reloads; a request that fails as a whole is asked again. A panic in a decoder is caught (`catch_unwind`) and reported as
  an error; the worker lives on.
- **Cancel:** `thumb_cancel` drops queued jobs of that request; running jobs finish and the window
  ignores them. The window uses one request id per folder and cancels it on folder change.

### Folder listing, watching, Date Taken, favorites

- `list_folder` returns `{ folders, files, truncated }`. Files carry `kind`, `ext`, `size`,
  `mtimeMs`, `createdMs`. Symlinks are followed. Sorting in Rust is by name only; the window
  re-sorts.
- `watch_folder` replaces the previous watcher. Dropping the watcher ends the debounce thread.
- `taken_dates(files)` returns dates in the same order. Misses are read on all cores from the EXIF
  header (`DateTimeOriginal`, then `DateTimeDigitized`, read as local time). iCloud "dataless"
  files are skipped so they do not download. Cache: `date-taken-cache.json`, keyed by path, valid
  while `mtimeMs` matches; rewritten (tmp + rename) after each batch of misses.
- Favorites: `viewer-favorites.json` (`{ version: 1, favorites: [...] }`). Adding an existing path
  returns the existing entry. A file that cannot be read is renamed to `.json.damaged` before the
  next save. Double-click a favorite in the sidebar to rename it (`fav_rename`).
- The Date Taken cache drops entries of deleted files once it holds more than 50,000 entries.

### Big view file serving

The big view (`lightbox.ts`) sets `img.src = viewer-file://...` of the original file. WebKit
decodes JPG, PNG, HEIC, WebP, AVIF, GIF, TIFF, BMP, SVG itself. RAW / PSD go through the preview
cache above. Video uses `<video>` with range requests.

### Export for Web and Optimize

**Export for Web** (`export.rs`, window `viewer/export/export.ts`):

- `export_image`: rotate (quarter turns), crop (fractions of the rotated image), scale to a max
  width (never up), encode WebP / JPG (quality 1–100) / PNG (oxipng level 2). The decoded source
  stays in a one-slot cache (`LAST`) while settings change. Result goes to
  `<app cache>/export/<nanos>/<slug>.<ext>`; the folder is emptied each run so WebKit never shows a
  stale cached file.
- `export_reference`: same pixels, PNG level 0, into `export-reference/` — the "Original" side of
  Compare.
- `export_batch(paths, options, run)`: one image per core, centered `aspect` crop, no rotation.
  Emits `export-progress {run, done, total}`. A newer `run` number stops older runs at their next
  file. Unique names (`-2`, `-3`) in `export-batch/<nanos>/`.
- `export_save` / `export_save_many`: copy into `optimized/` next to the source; never overwrite.
- `export_copy` / `export_copy_many`: clipboard (see below).

**Optimize** (`optimize.rs`, `video.rs`, window `optimize.ts`):

- `optimize_expand` walks dropped folders (sorted, skips dot files and any `optimized` folder).
- `optimize_files` emits `file-progress {file, status, percent?, outPath?, error?}` with status
  `processing | done | skipped | error`. Existing outputs are skipped. Output:
  `<folder>/optimized/<slug>.<ext>`, written as `.part` then renamed.
- Images: ImageIO decode at the target width (`decode_for_web`), quality 80.
- Videos: one at a time, next to the image work: `ffmpeg -c:v libx264 -crf 23 -preset fast`,
  AAC 128k, `+faststart`; presets `same | 1080p | 720p | 480p` fit inside a box, never upscale.
- `ffmpeg` sits next to the app binary (`Contents/MacOS/ffmpeg`). `scripts/build-ffmpeg.sh`
  builds FFmpeg 7.1.1 + x264 with only the needed demuxers, decoders, encoders and filters (about
  8 MB, GPL). It reruns only when `BUILD_ID` changes or with `--force`.

### Recorder and Screenshot

**Recorder** (`platform/macos/recorder.rs`, window `recorder.ts`):

1. `record_start` gets `SCShareableContent`. Whole screen: first display, Kadar's own windows
   excluded. One app: `capture::largest_window_id(name)` finds the app's largest window by window
   number, then the matching `SCWindow`. (App names from the window list can differ from SCK's
   names, for example "Code".)
2. Config: full Retina size (even numbers), 60 fps, cursor, 48 kHz stereo system audio (own audio
   excluded), optional microphone by device id.
3. `SCRecordingOutput` writes `recording-<ms>-capture.mp4` in **HEVC** (H.264 fails above ~4K, for
   example on a 5K screen).
4. A delegate class `KadarRecordingDelegate` reports finish or failure. A failure also emits
   `record-failed` at once, so the window does not show a dead recording.
5. `record_stop` stops the stream, waits for the delegate, then `finish()`:
   - 0 audio tracks → `-an`; 1 → map it; 2 → `amix` (system + mic).
   - "Level audio" adds `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000` (loudnorm outputs 192 kHz,
     which AAC rejects).
   - **Retry:** if the leveled run fails (silent track breaks AAC), it runs again without leveling.
   - Normal: x264 CRF 18 medium, AAC 192k → `recording-<ms>.mp4`. Raw: CRF 12 slow, 320k, constant
     60 fps → `recording-<ms>-raw.mp4`. Progress: `record-progress` (0–99). The capture file is
     deleted on success.

**Screenshot** (`platform/macos/capture.rs`, window `screenshot.ts`): the window list (layer 0, ≥ 50 × 50, not
Kadar) gives app names. `capture_take` runs `screencapture -l <windowId> -x [-o]` into
`screenshot-<ms>.png`. Trim (points × Retina ratio), scale and WebP/PNG encoding happen in Rust
when asked. `capture_resize_window` moves and sizes the app's front window with AppleScript
(needs Accessibility; `NSAppleEventsUsageDescription` in `Info.plist`).

### Clipboard, drag-out, trash, rename, Open With, menu, window state

- **Clipboard** (`platform/macos/clipboard.rs`): runs on the main thread and waits. ⌘C writes one pasteboard
  item per file (file URL); a single image also gets PNG bytes, so it pastes into web pages and
  chats. ⇧⌘C writes the paths as text, one per line. `copy_text` writes plain text (Edit › Copy
  in a text field).
- **Drag-out** (`platform/macos/drag.rs`): native `NSDraggingSession` with file URLs and a thumbnail icon.
  The grid starts it from `mousemove` after 5 px with the button down, never from the page's
  `dragstart`: the page's own drag shares the Mac drag pasteboard and wipes the files, so every app
  refuses the drop. The source allows **Copy only**; with Move or Generic, Finder moves the
  owner's file away.
- **Trash** (`trash_files`): `NSFileManager.trashItemAtURL`, returns `[original, inTrash]` pairs.
  **Put back** renames each file back and never replaces an existing file, then calls `platform::system::forget_trashed` (Windows deletes the bin's `$I` record; the Mac has none). Both feed Undo. On Windows, `trash` uses IFileOperation with a progress sink to learn each file's place in the Recycle Bin, and skips files that are gone.
- **Rename** (`rename_file`): rejects empty names, `/`, NUL, `.`/`..`, and names already taken;
  a case-only change is allowed.
- **Open With from Finder** (Mac): `RunEvent::Opened` pushes paths into `OpenedFiles` (managed on the
  Builder, before `setup`, because macOS can send files during launch), emits `open-paths`, and
  focuses the window. The window listens first, then calls `take_opened` once at start, so no file
  is missed. On Windows and Linux, files arrive as start arguments (`files_from_args`); a second
  start is caught by `tauri-plugin-single-instance`, which hands its files to the running Kadar
  (`commands::hand_over`, the same path the Mac event takes).
- **Menu bar** (`menu.rs`, Mac only; Windows and Linux use `src/shortcuts.ts`): Kadar, File, Edit, View (with Sort By), Go, Window. A click emits
  `menu` with the item id; `main.ts` switches tabs for `tab:*` and forwards the rest to the viewer
  bus. From another tab, only commands that open or arrange the viewer run; commands on files
  only bring the Viewer to the front. While Export for Web is open, the viewer ignores menu
  commands. Edit › Undo, Copy and Select All are Kadar's own items: in a focused text field
  `main.ts` does the text action; otherwise they act on the viewer's files. Redo, Cut and Paste
  are the Mac's standard items.
- **Open folders:** a third file association claims `public.folder` (rank Alternate), so Kadar
  shows in Finder's Open With for folders and takes folders dropped on its Dock icon.
- **Window state:** `tauri-plugin-window-state` restores size and place. It saves only on a normal
  quit, so `lib.rs` also saves 500 ms after the last move/resize.

### Lock handling (`sync.rs`)

A thread that panics while holding a `Mutex` poisons it, and `lock().unwrap()` then panics in every
later caller. One bad image could stop all thumbnails until restart. The data under Kadar's locks
(queues, lists, caches) stays valid after such a panic, so `sync::lock`, `sync::wait` and
`sync::into_inner` take the inner value and carry on. Use them for every new lock.

## 3. Window modules (TypeScript)

| File | Job |
|---|---|
| `main.ts` | Installs the bridges; tab switching; lazy-loads Viewer, Record, Screenshot on first visit (Optimize is set up at once because the viewer's "Optimize" uses it); remembers the tab; routes `menu` events; takes files opened from Finder; shows unhandled promise errors as a toast |
| `bridge.ts` | `window.viewer` (typed `ViewerAPI` in `viewer/types.ts`) and `window.optimizer` (Screenshot). Each method is one `invoke` or one `listen` |
| `optimize.ts` | Optimize tab: drop events from the webview, queue list, `file-progress`; `optimizePaths()` for the viewer |
| `shortcuts.ts` | Windows and Linux only: maps keys to the Mac menu bar's command names (Ctrl keys, Delete, F2, Alt+arrows) and stops the browser engine's own keys; `main.ts` runs them when no other code took the key |
| `paths.ts` | Path helpers for `/` and `\` paths (base name, parent, join, path bar parts) |
| `platform.ts` | The system the window runs on: command key (⌘ / Ctrl), key labels for tips, words (Finder / File Explorer / Files, Trash / Recycle Bin); `data-word` elements in `index.html` are filled at start | 
| `recorder.ts` | Record tab: targets, mics, 3-2-1 countdown with Dock badge, start/stop, `record-*` events |
| `screenshot.ts`, `shared.ts` | Screenshot tab; shared helpers for Record and Screenshot (presets, resize, save folder, `persist()` of form fields) |
| `viewer/index.ts` | Builds the viewer: toolbar (path, filter, sort, size slider), grid, big view, export; folder load, history (back / forward / up), sort + filter view, live refresh, toast, menu commands, session restore |
| `viewer/bus.ts` | In-window event bus (`on` / `emit`), typed by `BusEvents` |
| `viewer/store.ts` | One shared state object; `getState`, `setState(patch)`, `subscribe((s, prev) => …)` |
| `viewer/session.ts` | State kept between launches in localStorage (`kadar:viewer-session`), saved 250 ms after the last change and on `pagehide` |
| `viewer/selection.ts` | Finder-style selection and the actions on it: copy, trash, export, optimize, open |
| `viewer/undo.ts` | ⌘Z stack (50 steps, in memory): trash → put back, rename → rename back |
| `viewer/sort.ts`, `filter.ts` | Pure sort (name, taken, modified, created, size, kind; ties by name) and name filter (all words, accents ignored) |
| `viewer/grid/grid.ts` | Virtual grid: cell pool, keys, click/shift/cmd selection, rename in place, drag-out, context menu |
| `viewer/grid/grid-layout.ts` | Pure layout math: columns, cell size (+24 px label), row height; zoom 80–320, default 160 |
| `viewer/grid/grid-cell.ts` | One reusable cell element |
| `viewer/grid/thumb-loader.ts` | Batches thumbnail requests per animation frame; known cache paths; one request id per folder |
| `viewer/lightbox/lightbox.ts` | Big view: fit / 100% / pinch zoom at pointer, pan, swipe, video, preload of neighbours |
| `viewer/info/info.ts` | Info panel in the big view (file, camera, place, color) from `image_properties` |
| `viewer/export/export.ts` | Export for Web UI: crop frame, settings, Result and Compare views, batch sheet |
| `viewer/context-menu.ts` | Right-click menu, a native Tauri menu built per click |
| `viewer/sidebar/*` | Favorites list and the Locations tree (Home, Pictures, Desktop, Downloads, Movies) |
| `viewer/ipc.ts`, `types.ts`, `testing.ts` | `api = window.viewer`, `fileUrl()`; shared types; test helper `entry()` |

**Bus events** (`BusEvents`): `folder:request`, `folder:go`, `folder:refresh`, `lightbox:open`,
`lightbox:close`, `lightbox:step`, `toast`, `rename:start`, `export:open`, `menu`, `info:toggle`,
`info:show`, `thumb:ready`.

### Open folder → grid

1. `folder:request` (tree, favorite, path bar, double-click) → `openFolder()` resets the session's
   place, selection and filter, then `loadFolder()`.
2. `loadFolder` sets `currentFolder`, calls `list_folder`, reads Date Taken only if that sort is
   active, then `setState({ entries: view() })`. Each `await` is followed by a "still the same
   folder?" check, so a slow folder cannot overwrite a newer one.
3. `view()` = subfolder tiles (by name) + files sorted by the session sort, both through the filter.
4. The grid's `subscribe` sees new `entries`, sets the canvas height, and renders only the visible
   rows plus 2 overscan rows, reusing pooled cells positioned with `transform`.
5. Missing thumbnails go to `ThumbLoader.request()`; `viewer:thumb:ready` fills the cell.
6. `watch_folder` starts; `viewer:fs:changed` → `refresh()` relists and skips the redraw when
   nothing visible changed.

### Selection model

- `selection: Set<path>` — every selected file.
- `selectedPath` — the focused file; arrows and the big view start here.
- `anchorPath` — where a Shift range starts.
- Click = only this; ⌘-click = toggle; Shift-click / Shift-arrow = range from the anchor; ⌘A = all.
- `selectedPaths()` returns the selection in grid order, or the focused file alone.
- All three are kept by path (not index), so they survive re-sorts and reloads, and are written to
  the session. `restoreSelection()` drops paths that no longer exist.

### Keys: window or menu

`menu.rs` explains the rule: the window handles most keys itself and calls `preventDefault()`;
WebKit then does not pass the key on to the menu, so **one key press never runs twice**. The menu
catches keys the window does not handle.

- **Window:** grid (arrows, Home/End, Page Up/Down, Space, Return = rename, Esc, ⌘A, ⌘C, ⇧⌘C, ⌘O,
  ⌘↓, ⌘⌫, ⌘E, ⇧⌘O), `index.ts` (⌘F, ⌘↑, ⌘[, ⌘], ⌘Z), big view (Esc, arrows, Space, Return, I,
  0, 1, +, −, ⌘C, ⌘E), Export (Esc, ⌘C, ⌘S, R — capture phase, stops other listeners).
- **Menu:** ⌘1–⌘4 (tabs), ⌘R, ⌘I, ⌘= / ⌘−, Sort By, Open Folder, and any key while focus is in a
  text field (for example ⌘E while typing in the filter).

When you add a key: handle it in the window **or** give it a menu accelerator that the window does
not also handle — or make sure the window calls `preventDefault()`.

## 4. Data on disk

`<app data>` and `<app config>` are `~/Library/Application Support/com.msantic.kadar/`.
`<app cache>` is `~/Library/Caches/com.msantic.kadar/`.

| What | Where |
|---|---|
| Thumbnail cache (1 GB cap) | `<app data>/thumb-cache/<2 hex>/<16 hex>.jpg\|png` |
| RAW / PSD previews (same cap) | `<app data>/thumb-cache/pv/<16 hex>.jpg\|png` |
| Date Taken cache | `<app data>/date-taken-cache.json` |
| Favorites | `<app data>/viewer-favorites.json` |
| Export temp results | `<app cache>/export/`, `export-reference/`, `export-batch/` (emptied each run) |
| Window size and place | window-state plugin's file in `<app config>` |
| Optimize / Export Save output | `optimized/` next to the source file |
| Recordings / Screenshots (defaults) | `~/Movies/Recordings`, `~/Pictures/Screenshots` |

**localStorage** (WebKit storage of the app):

| Key | Content |
|---|---|
| `kadar:viewer-session` | folder, `topPath`/`topIndex`, `selectedPath`, `selectedPaths`, `anchorPath`, `bigView`, `expanded` tree folders, `sortBy`, `sortDescending`, `filter` |
| `kadar:export` | Export for Web settings: aspect, width, format, quality |
| `kadar:info-open` | `'1'` / `'0'` |
| `persist:active-tab` | last tab |
| `persist:viewer-thumb-size` | grid zoom |
| `persist:<element id>` | Optimize, Record and Screenshot form fields (`shared.ts` `persist()`) |
| `recorder-save-dir`, `screenshot-save-dir` | chosen output folders |

## 5. Speed design

- **Lazy tabs:** only the active tab's code loads (`import()` in `main.ts`).
- **Virtual grid:** only visible rows ± 2 exist as DOM cells; cells are pooled and moved with
  `transform`. Folder entries are plain data.
- **Thumbnails:** ImageIO decodes at reduced size (a 50 MP JPEG never decodes in full); one worker
  per performance core; newest request first; disk cache keyed by path + mtime + size; requests
  batched per animation frame.
- **2× pixel ratio:** thumbnails are made at 512 px for a 256 request, sharp on Retina.
- **Big view:** the previous and next images are created and `decode()`d early, so arrow keys
  show them at once.
- **Date Taken** reads only EXIF headers, on all cores, only when that sort is used, then caches.
- **Measured** (`CLAUDE.md`, 10,000 photos, release build): folder opens in ~70 ms, first screen of
  thumbnails ~0.2 s, scrolling 60 fps, big view 5 ms, next image instant. Measure with
  `npx tauri dev --release`; debug builds are many times slower.

## 6. Build and bundle

- `src-tauri/tauri.conf.json`: id `com.msantic.kadar`, one window `main` (overlay title bar),
  `minimumSystemVersion` `15.0`, targets `app` + `dmg`, `externalBin: ["bin/ffmpeg"]` (Tauri
  picks `bin/ffmpeg-aarch64-apple-darwin`), file associations for images (incl. RAW, PSD) and
  videos as "Alternate" viewer.
- Signing: `Developer ID Application: Prelako d.o.o. (FC2M54RD3H)`, `Entitlements.plist` (audio
  input for the hardened runtime). Do not change the identity or app id: the signature keeps the
  Screen Recording and microphone permissions. `scripts/notarize.sh` makes the notarized installer.
- `Info.plist` adds the microphone and Apple Events prompt texts.
- Capabilities (`capabilities/default.json`): `core:default`, window dragging, badge label, menu.
- Release profile: `opt-level 3`, LTO, one codegen unit, stripped. App size ~15 MB matters.
- Windows: `npx tauri build --bundles nsis` on the office server's Windows machine makes an
  unsigned per-user installer (`kadar.exe`, `ffmpeg.exe`); `npm run share:windows` runs it from the
  Mac. `icons/icon.ico` is the Windows icon. Details: [windows.md](windows.md).
- Steps: [development.md](development.md).

## 7. Tests

- **Rust:** `#[cfg(test)] mod tests` at the end of each module (rename and put back, listing and
  natural sort, ranges and percent-decoding, export geometry and naming, optimize output names,
  EXIF dates, ffmpeg duration parsing, poisoned locks, ...). `testutil.rs` makes an empty folder per
  check under the system temp folder (`kadar-checks/<name>-<pid>`) and generated PNGs. Never point
  a check at the owner's files. ScreenCaptureKit in `cargo test` needs `NSApplicationLoad()` first.
- **Window:** `src/**/*.test.ts` with vitest in a jsdom page (`vitest.config.ts`); `testing.ts`
  has `entry()` for fake files. Files: `sort`, `filter`, `selection`, `undo`, `session` (damaged
  saves), `format` (sizes, "smaller by"), `grid/grid-layout`, `grid/thumb-loader` (with a fake
  `ipc`), `info/info` (the panel with a fake `window.viewer`).
- **Test media:** `src-tauri/tests/data/clip.mov` is a 1-second 320×240 H.264 + AAC clip (9 KB),
  made once with a full ffmpeg. The video checks run the bundled ffmpeg from `src-tauri/bin/`
  on it, so run `scripts/build-ffmpeg.sh` once before `cargo test` on a fresh clone.
- **`npm run check`** runs, in order: `tsc`, `vitest run`, `node scripts/check-docs.mjs`, then in
  `src-tauri`: `cargo clippy --all-targets -- -D warnings` and `cargo test`. `npm run build` runs
  it first and stops on a failure. `cargo build` must stay free of warnings.
- **`scripts/check-docs.mjs`** fails when a `.ts` file in `src/` or a `.rs` file in
  `src-tauri/src` has no header comment, or an exported TS item / `pub` Rust item has no doc comment
  right above it (attributes in between are allowed; Rust stops at `#[cfg(test)] mod tests`).
  Run it alone with `node scripts/check-docs.mjs`.
