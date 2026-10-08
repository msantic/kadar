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
- `npx tsc` checks the window code. `~/.cargo/bin/cargo test` and `cargo build` must stay free of warnings.

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
- **Changing the ffmpeg build flags:** bump `BUILD_ID` in `scripts/build-ffmpeg.sh`, or old copies stay in use.

## Checking the running app

- Take a picture of the window only: find its window id with CGWindowList (owner "kadar"), then `screencapture -l <id> -x -o out.png`. Never capture the whole screen.
- Do not send synthetic clicks. They do not reach Kadar and can land in other apps. To test a flow, add a temporary call in `src/main.ts`, check, and remove it.

## Safety

- Before you delete any folder, list its contents. Git-ignored folders can hold the owner's files. One was lost this way.
- Commit only when asked. Never push without asking.
