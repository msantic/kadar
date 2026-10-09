# Kadar — notes for AI coding sessions

Read README.md first: it has what Kadar does and which file does what. This file has the rules and traps.

## Decisions (do not re-open without the owner asking)

- **Mac only, Apple Silicon, macOS 15+.** No Windows or Linux code paths. macOS 15 is needed for screen recording to a file and microphone capture.
- **Small app size matters most.** Prefer Mac frameworks (ImageIO, AVFoundation, ScreenCaptureKit, CoreGraphics) over new libraries. Check the `.app` size after adding a dependency (`npm run build` prints it; about 15 MB now).
- **Video uses the self-built ffmpeg on purpose.** Apple's H.264 and HEVC encoders were tested: same file size, visibly blockier video. Do not move video encoding to AVFoundation.
- **Release builds are signed with the Prelako Developer ID.** A stable signature keeps the Screen Recording and microphone permissions. Do not change the identity or the app id `com.msantic.kadar`.

## Commands

- `npm run dev` — run with live reload. `npm run build` — signed `.app` and `.dmg` in `src-tauri/target/release/bundle/`.
- Rust tools are in `~/.cargo/bin`, which is not on the agent shell PATH. The npm scripts add it. For cargo directly, call `~/.cargo/bin/cargo` (run it in `src-tauri/`).
- Kadar is installed in /Applications. To update it: `npm run build`, then `ditto src-tauri/target/release/bundle/macos/Kadar.app /Applications/Kadar.app` (quit Kadar first). Finder's "Open With" uses that copy.
- `npm run check` runs all checks: types, the window checks (`src/**/*.test.ts`, vitest) and the Rust checks (`cargo test`). `npm run build` runs them first and stops on a failure. Add a check with every new behavior. `cargo build` must stay free of warnings.
- Rust checks make their own folders and images (`testutil.rs`); never point a check at the owner's files.

## How the parts connect

- The window code (`src/`) calls Rust commands with `invoke('name', { camelCaseArgs })`. Every command is in `src-tauri/src/commands.rs` and listed in `lib.rs`.
- The viewer and screenshot screens were written for Electron. `src/bridge.ts` gives them the same `window.viewer` / `window.optimizer` objects, backed by Rust. Keep that shape, or change the screens and the bridge together.
- Local files reach the window as `viewer-file://viewer/<percent-encoded path>`, served by `protocol.rs`.
- Long work reports progress as events: `viewer:thumb:ready`, `file-progress`, `record-progress`.

## Traps already hit

- **Blank window in dev:** Vite must listen on `127.0.0.1` (see `vite.config.ts`), and `devUrl` must match. "localhost" gives IPv6 only, and the window connects over IPv4.
- **Empty thumbnails** while the window sits behind other windows: WebKit pauses animation frames in hidden windows. Not a Rust bug.
- **After moving folders, run `cargo clean`.** The build cache keeps absolute paths and fails.
- **ScreenCaptureKit in `cargo test`** aborts with CGS_REQUIRE_INIT. Call `NSApplicationLoad()` first.
- **loudnorm before AAC** needs `aresample=48000` after it. loudnorm outputs 192 kHz, and the AAC encoder rejects it.
- **Files opened from Finder arrive before setup.** macOS sends them while the app still launches. Anything the open handler uses must be managed on the Builder, not in `setup()`, or the app aborts at launch.
- **Changing the ffmpeg build flags:** bump `BUILD_ID` in `scripts/build-ffmpeg.sh`, or old copies stay in use.

## Checking the running app

- Take a picture of Kadar's own windows only: find the window id with CGWindowList (owner "kadar"), then `screencapture -l <id> -x -o out.png`. A right-click menu is its own Kadar window (layer above 0); capture it the same way.
- Never capture the whole screen or a screen area (`screencapture -R`). Other apps' windows can cover Kadar and show the owner's private content. This happened once.
- Do not send synthetic clicks. They do not reach Kadar and can land in other apps. To test a flow, add a temporary call in `src/main.ts`, check, and remove it.

## Measuring speed

- Measure with `npx tauri dev --release` (add `~/.cargo/bin` to PATH); the debug build is many times slower at images.
- Results on 10,000 photos (2026-10-09, 10 performance cores): folder opens in ~70 ms, first screen of thumbnails ~0.2 s, scrolling steady 60 fps, big view 5 ms, next image instant.
- Test scripts that change the dev copy's session cannot put it back: the viewer writes its in-memory session again after the script. Use the test folder in the scratchpad, and say so.

## Safety

- Before you delete any folder, list its contents. Git-ignored folders can hold the owner's files. One was lost this way.
- Commit only when asked. Never push without asking.
