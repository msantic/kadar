# Kadar — status and handover

**Start here.** This page is for a new session (person or AI) that picks up Kadar with no memory
of earlier work. It says what Kadar is, where everything is, what state it is in, what is still
open, and how the owner wants the work done. Last full update: 2026-10-09, before the local
folder was renamed from `~/dev/image-web-optimize` to `~/dev/kadar`.

Read next, in this order: [CLAUDE.md](../CLAUDE.md) (rules and traps, short), the
[README](../README.md) ("Platforms" has the status per system), then the guide for the task:
[architecture](architecture.md), [development](development.md), [windows](windows.md),
[decisions](decisions.md), [user guide](user-guide.md).

---

## What Kadar is

A fast image viewer and image/video tool with four tabs: **Viewer** (folder tree, favorites,
thumbnail grid, big view, info panel, Export for Web, rename, Trash with Undo, drag-out, copy),
**Optimize** (web copies of images and videos), **Record** (one window or the screen, with sound)
and **Screenshot** (one app window). "Kadar" means a film frame or shot. App id
`com.msantic.kadar`.

Built with Tauri 2: Rust in `src-tauri/`, the window in plain TypeScript in `src/`, shown by the
system's own web engine. Small size matters most: each system's own image and video tools, plus a
small self-built ffmpeg for video.

## Where everything is

| What | Where |
|---|---|
| Code | `~/dev/kadar` (until 2026-10-09: `~/dev/image-web-optimize`) |
| GitHub | `github.com/msantic/kadar` (public). Commits on the owner's Mac are pushed to GitHub by a tool on that Mac, usually within minutes; do not push by hand unless asked. |
| Installed Mac app | `/Applications/Kadar.app` (1.0.0, notarized) |
| Mac installer to share | `src-tauri/target/release/bundle/share/Kadar-1.0.0.dmg` (made by `npm run share`) |
| Windows installer to share | `src-tauri/target/release/bundle/windows/Kadar_<version>_x64-setup.exe` (made by `npm run share:windows`) |
| Windows build machine | `winbuild`, a Windows 11 virtual machine on the BIMTLY office server `10.10.10.4`. Off when not in use. See [windows.md](windows.md). |
| Windows copy of the code | `C:\dev\kadar` on `winbuild` (a git clone) |
| Test media | `src-tauri/tests/data/clip.mov` (1 s video); checks make their own images |
| AI session notes (memory) | `~/.claude/projects/-Users-marko-dev-kadar/memory/` (copied from the old folder's notes on 2026-10-09) |
| Rust | `~/.cargo/bin` (not on the AI shell's PATH; the npm scripts add it). Rust is installed; never conclude it is missing. |

## State on 2026-10-09

- **Version 1.0.0**, the first version shared with people. The version line shows at the bottom
  of the sidebar; on the Mac also in Kadar › About Kadar.
- **macOS:** every feature. Notarized installer ready. Installed in `/Applications`.
- **Windows:** Viewer, image and video Optimize, Export for Web, drag-out, one Kadar at a time,
  installer (unsigned by choice). Screenshot and Record are hidden there (not built).
- **Linux:** on hold by the owner's decision. The plan stays in the README.
- **Feature work is finished for now** (owner, 2026-10-09). New work is fixes, speed and
  documentation, unless the owner asks for a feature.
- **Checks:** `npm run check` passes: 46 window checks, 48 Rust checks on the Mac, and 47 Rust
  checks on Windows (run there, see windows.md). Every code file and public function has a
  description; the docs check enforces it.
- **Measured speed** (10,000 photos, Mac): folder opens in about 70 ms, first thumbnails in about
  0.2 s, scrolling at 60 fps, big view in 5 ms.

## Open items (only when the owner asks)

1. **Windows installer 1.0.0.** The one made on 2026-10-09 says 0.1.0 and has no version line.
   Start `winbuild` (ask first), run `npm run share:windows`, stop `winbuild`.
2. **Windows, not yet checked by eye:** Export for Web, the info panel's camera data, HEIC and
   camera RAW photos (these need Microsoft's free HEIF and Raw Image add-ons on the PC).
3. **Photoshop (PSD) files on Windows** show no thumbnail: Windows has no built-in reader. Open
   question: skip for good, or add a small PSD reader.
4. **Screenshot and Record on Windows** (Windows Graphics Capture); **Linux** — both on hold.
5. **Colors on Windows** are read as sRGB; wide-gamut photos look slightly less saturated than
   on the Mac.
6. **Windows on ARM** PCs are not supported (the build is x64 only).
7. **Apple app password:** the owner pasted the notarization password into a chat on
   2026-10-09. Recommended: delete it at appleid.apple.com, make a new one, and store it again
   with `xcrun notarytool store-credentials kadar-notary ...` (see development.md).

## After the folder rename (`~/dev/image-web-optimize` → `~/dev/kadar`)

1. **Rust build cache:** it keeps absolute paths and fails after a move. In `src-tauri/`, run
   `~/.cargo/bin/cargo clean`. This deletes `src-tauri/target/`, including the built installers
   and the ffmpeg build folder (the ffmpeg programs themselves are in `src-tauri/bin/`, which
   stays). Make new installers with `npm run share` when needed.
2. **Check everything:** `npm run check`, then `npm run build`.
3. **AI notes:** already copied to `~/.claude/projects/-Users-marko-dev-kadar/memory/`. The old
   copy under `-Users-marko-dev-image-web-optimize` can be deleted after a new session has
   started in the new folder and found its notes.
4. Nothing in the repository names the old folder; the Windows machine uses `C:\dev\kadar` and
   does not care.

## How the owner wants the work done

These come from the owner's global rules (`~/.claude/CLAUDE.md`, `~/.claude/output-styles/plain.md`)
and from this project's history. Follow them in every message and every change.

- **Writing to the owner:** ASD-STE100 Simplified Technical English. The answer goes in the
  first line. One idea per sentence, 20 words or fewer, active voice, at most three bullets.
  Say what the owner will see or click, never file or function names unless asked. No invented
  labels (no "Phase 2"), no bold labels at the start of a paragraph.
- **The owner does not read code** and runs several sessions at once. Be short. Recommend one
  path; do not list rejected options unless asked.
- **Before any size, cost or effort estimate**, check each system's built-in tools first and
  answer once with the best path. A quick worst-case answer that is corrected one message later
  cost trust once (2026-10-09).
- **Commits:** only when the owner asks ("commit", "go" for a task the owner started, or the
  `/bim-audit-and-commit` command). The owner sometimes says "don't commit" mid-task: then leave
  the files unsaved in git and say so. Never push by hand. Use the shared commit script
  (`CLAUDE_COMMIT_AUTHORIZED=1 ~/.claude/scripts/git-locked.sh commit -m "..." -- <files>`) with
  only the files you wrote.
- **Safety:**
  - List a folder's contents before you delete it. An unseen folder of the owner's files was
    lost once (2026-10-08).
  - Pictures of the screen: only Kadar's own windows, by window number
    (`screencapture -l <id>`). Never the whole screen or an area. Private content leaked once.
  - Ask before you start or stop the Windows build machine. It shares the server with
    production and with the BIMTLY Showroom.
  - Never print passwords. To give the owner the Windows password for the remote screen, copy it
    to the clipboard without showing it (windows.md).
- **Quality:** every bug fix and new behavior gets an automatic check. Every new file and public
  function gets a description (the docs check fails without it). Update the user guide when the
  owner sees a change, the architecture guide when parts connect differently, and the decisions
  record for lasting choices.
- **Decisions are not re-opened** without the owner: Tauri and Rust, Mac and Windows only, the
  self-built ffmpeg instead of Apple's encoders, the Prelako signing identity, no Windows
  certificate, Linux on hold.

## History in short

| Date | What happened |
|---|---|
| 2025-06 to 2026-03 | A Node.js command-line optimizer, then an Electron app (about 200–330 MB) with Optimize, Record and Screenshot tabs. |
| 2026-10-08 | Rewrite in Rust and Tauri (15 MB). Renamed to Kadar; GitHub repo renamed to msantic/kadar. Viewer, Optimize, Record, Screenshot moved over; Electron and the command-line tool removed. Signed with the Prelako Developer ID. New icon. |
| 2026-10-09 (morning) | Viewer features: remembered state, Finder keys and selection, sort, live folder, filter, rename, Trash with Undo, Date Taken, RAW and PSD, Export for Web (one and many), Compare, info panel, menu bar, drag-out, folder navigation, trackpad gestures, Open With from Finder. Recorder fixes (5K screens, window by number). |
| 2026-10-09 (midday) | Stabilization: crash fixes, about 70 automatic checks, full documentation, docs check, notarized Mac installer. |
| 2026-10-09 (afternoon) | Code split into one part per system. Windows: Viewer, Optimize, Export, video, drag-out, one Kadar at a time, installer. Linux put on hold; feature work declared finished. Version 1.0.0 with the version line in the sidebar. |

The full record of choices and their reasons is in [decisions.md](decisions.md); `git log` has
every step.
