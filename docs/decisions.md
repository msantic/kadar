# Kadar decisions

Lasting choices, with the reason for each. Do not reverse one without the owner's agreement. Add
a new entry when you make a choice that a later developer could question. Newest entries last.

Each entry: the decision, the date, why, and what follows from it.

---

## Platform and stack

### Rust and Tauri, not Electron (2026-10-08)

Kadar started as an Electron app. It was about 200 MB for a small viewer and tool, and it started
slowly. It was rewritten as a Tauri 2 app: a Rust program plus the window content in plain
TypeScript, shown by the Mac's own WebKit. The app is now about 15 MB.

- No Node.js runs in the app. Node is only a build tool.
- The command-line optimizer from the Electron era was removed.

### Mac only, Apple Silicon, macOS 15 or later (2026-10-08)

The owner uses only Macs. macOS 15 is the first version that records the screen straight to a
file (ScreenCaptureKit recording output) and captures the microphone with it.

- No Windows or Linux code paths, no cross-platform layers.
- Mac frameworks are fine to use directly.

### Mac frameworks before new libraries (2026-10-08)

A small app matters most. ImageIO decodes images and makes thumbnails; AVFoundation reads videos;
ScreenCaptureKit records; CoreGraphics crops and draws; AppKit does the clipboard, drag and
Trash. Libraries are added only where the Mac has nothing good: libwebp, mozjpeg, oxipng.

- Check the `.app` size after you add a dependency.

### Plain TypeScript in the window, no framework (2026-10-08)

The window is small and speed matters. A framework adds size and a layer between the code and
the page. The viewer uses a small store, an event bus and plain DOM code.

### The name Kadar (2026-10-08)

"Kadar" means a film frame or a shot. It fits a viewer, a recorder and a screenshot tool. The
GitHub project was renamed to match. The app id is `com.msantic.kadar`.

## Video

### A small self-built ffmpeg for video, not Apple's encoders (2026-10-08)

Apple's H.264 and HEVC encoders were tested against x264. At the same file size, Apple's video
was visibly blockier. Kadar ships a self-built ffmpeg of about 8 MB with only x264, AAC and the
filters it needs.

- This ffmpeg is GPL because of x264.
- Do not move video encoding to AVFoundation.

### Record in HEVC, deliver H.264 MP4 (2026-10-09)

ScreenCaptureKit writes the raw recording. H.264 cannot encode a 5K screen, so the raw capture
uses HEVC. The finish step then makes an H.264 MP4 that plays everywhere, mixes system sound and
microphone into one track, and evens the loudness.

- Silent tracks break the loudness filter, so the finish step retries without it.

### Record a chosen window by its window number (2026-10-09)

Matching windows by app name or title failed for some apps (for example Visual Studio Code). The
recorder now takes the window number of the app's largest window and finds it by that number.

## Viewer behavior

### Behave like Finder (2026-10-09)

One click selects, double-click or Space opens the big view, Return renames, arrows and Shift
and ⌘ work as in Finder, and names sort as Finder sorts them ("img2" before "img10").
The owner uses Finder all day, so Kadar must not need new habits.

### Kadar reopens where you left it (2026-10-09)

Folder, scroll place, selection, open big view, sort and filter come back after a restart.
They are saved in the window's storage; damaged saves fall back to defaults one value at a time.

### Thumbnails: newest request first, one worker per fast core (2026-10-09)

After a fast scroll, the thumbnails on screen now matter more than the ones scrolled past. The
queue serves the newest request first. One worker per performance core was the fastest setting
measured (10 cores: about 320 thumbnails a second). Thumbnails are made at twice the shown size
for Retina screens. The cache stays under 1 GB.

### Camera dates only when you sort by Date Taken (2026-10-09)

Reading camera data costs time on large folders, so Kadar reads it only for the Date Taken sort,
and keeps it in a cache. Files kept only in the cloud are skipped, so sorting never downloads
them.

### RAW and Photoshop files get a full-size JPG copy for the big view (2026-10-09)

WebKit cannot show them. The Mac decodes them once into a cached JPG (or PNG with transparency).

### Drag out: native, from mouse movement, Copy only (2026-10-09)

The page's own drag wiped the Mac's drag clipboard, so other apps refused the drop. Kadar starts
the Mac drag itself from mouse movement and allows only Copy. With Move allowed, Finder moved the
owner's original file away.

### Trash with Undo, kept in memory only (2026-10-09)

Move to Trash uses the Mac's Trash, so Finder's Put Back also works. Kadar keeps the last 50
Trash and rename steps for ⌘Z until it quits. Undo never writes over a file that took the old
name in the meantime.

### Commands on files never run on a selection you cannot see (2026-10-09)

A menu key such as ⌘⌫ pressed in the Optimize, Record or Screenshot tab only brings the Viewer
to the front; it does not act on the files. While Export for Web is open, the Viewer's menu
commands do nothing. Both stop a key press from changing files the user does not see.

### The Optimize button left the toolbar (2026-10-09)

The owner found it in the way. Optimize is in the right-click menu and on ⇧⌘O.

### Not the default viewer for now (2026-10-09)

Kadar registers as an alternate viewer for its file types, so it shows in Finder's Open With.
The owner chose not to make it the default yet.

## Optimize and Export

### Results go into an "optimized" folder next to the originals (2026-10-08)

The originals are never changed. Names are cleaned (lower case, dashes, no accents). Existing
results are skipped, so a second run is fast. When two files in one folder share a clean name
with different types (photo.jpg and photo.png), each result name gets the source type
(photo-jpg.webp) so they never share a result.

### "Smaller by" never says 100% (2026-10-09)

A tiny result rounded to "100% smaller", which reads as an empty file. The figure stops at 99%.

## Build and release

### Signed with the Prelako Developer ID; not notarized yet (2026-10-08)

macOS ties the Screen Recording and microphone permissions to the signature. A stable signature
keeps them across rebuilds. Do not change the identity or the app id.

### Every check must pass before a build (2026-10-09)

`npm run build` runs types, window checks, the documentation check, the Rust code checker with
warnings as errors, and the Rust checks. A failed check stops the build.

### Full documentation coverage (2026-10-09)

The owner asked for full documentation. Every code file has a header, every public item has a
doc comment (enforced by `scripts/check-docs.mjs`), and the `docs/` folder has a user guide, an
architecture guide, a development guide and this record.

## Ways of working

### Pictures of Kadar's own windows only (2026-10-09)

A screen-area capture once showed the owner's private content from another app. Checks of the
running app take pictures of Kadar's windows only, by window number.

### List a folder before deleting it (2026-10-08)

A git-ignored output folder with the owner's files was deleted without a look and could not be
recovered. Always list a folder's contents first.
