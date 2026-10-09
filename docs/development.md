# Kadar development guide

How to set up, run, check, build, install and measure Kadar. For how the code is organized, read
[architecture.md](architecture.md). For why things are the way they are, read
[decisions.md](decisions.md).

## Setup

You need:

- A Mac with Apple Silicon and macOS 15 or later.
- Xcode command line tools (`xcode-select --install`).
- Node.js 20 or later, with npm.
- Rust (stable), installed with rustup. It lives in `~/.cargo/bin`. The npm scripts add that
  folder to `PATH`, so you do not need it on your own `PATH`.
- The Rust code checker: `rustup component add clippy`.
- For a release build: the signing certificate "Developer ID Application: Prelako d.o.o.
  (FC2M54RD3H)" in the login keychain.

Then:

```bash
npm install
npm run dev
```

The first `npm run dev` builds the small ffmpeg (a few minutes, once; see [ffmpeg](#ffmpeg)).
Later runs start in seconds.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs Kadar with live reload. Window code reloads at once; Rust changes rebuild and restart the app. |
| `npm run check` | Runs every automatic check (see [Checks](#checks)). |
| `npm run build` | Builds ffmpeg if needed, runs every check, then builds the signed `Kadar.app` and `.dmg` in `src-tauri/target/release/bundle/`. Stops on the first failed check. |
| `node scripts/check-docs.mjs` | Runs only the documentation check. |
| `scripts/build-ffmpeg.sh --force` | Builds ffmpeg again, even when the current copy is up to date. |

For cargo itself, run it in `src-tauri/` as `~/.cargo/bin/cargo …`.

The dev server listens on `127.0.0.1:1420`. Tauri's window loads the page from there in dev
mode. A release build has the page inside the app and needs no server.

## Checks

`npm run check` runs these, in this order, and stops at the first failure:

1. `tsc`: types of all window code.
2. `vitest run`: window checks, `src/**/*.test.ts`, in a jsdom page.
3. `node scripts/check-docs.mjs`: every code file has a header comment, and every exported
   TypeScript item and every `pub` Rust item has a doc comment.
4. `cargo clippy --all-targets -- -D warnings`: the Rust code checker; any warning fails.
5. `cargo test`: Rust checks, in `#[cfg(test)] mod tests` at the end of each module.

Rules for checks:

- Add a check with every new behavior and every bug fix. A bug fix check fails before the fix.
- Rust checks make their own folders and images with `testutil.rs` (`temp_dir`, `write_png`).
  Never point a check at files on the owner's Mac.
- Video checks use `src-tauri/tests/data/clip.mov` (1 second, 320×240, H.264 + AAC) and the
  bundled ffmpeg in `src-tauri/bin/`. That ffmpeg is not in git: on a fresh clone, run
  `scripts/build-ffmpeg.sh` once before `cargo test`.
- Window checks that need Rust replace `window.viewer` with a fake (see `info/info.test.ts`).
- Checks that touch ScreenCaptureKit must call `NSApplicationLoad()` first, or the test program
  aborts with `CGS_REQUIRE_INIT`.

## Documentation rules

- Every new `.ts` file in `src/` and `.rs` file in `src-tauri/src/` starts with a header
  comment: what the file is for, and how it connects to the rest.
- Every exported TypeScript item and `pub` Rust item has a doc comment right above it. Say what
  it does, plus units (ms, px, bytes), what `null` / `None` / an error means, and side effects.
- When you change what the user sees, update [user-guide.md](user-guide.md). When you change how
  parts connect, update [architecture.md](architecture.md). When you make a lasting choice, add it
  to [decisions.md](decisions.md).
- The documentation check enforces the first two rules. The other rules are on you.

## Build and install

```bash
npm run build
# Quit Kadar first.
ditto src-tauri/target/release/bundle/macos/Kadar.app /Applications/Kadar.app
```

- Finder's **Open With** uses the copy in `/Applications`.
- After a change to the file types in `tauri.conf.json`, tell Launch Services:
  `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Kadar.app`
- `npm run build` prints the size of the `.app`. It is about 15 MB. Check it after you add a
  dependency.
- If the `.dmg` step fails with a busy disk image, eject the leftover "Kadar" disk image and
  build again.

## Signing

- Release builds are signed with "Developer ID Application: Prelako d.o.o. (FC2M54RD3H)",
  set in `tauri.conf.json`. The app id is `com.msantic.kadar`.
- macOS ties the Screen Recording and microphone permissions to the signature and the app id.
  Do not change either, or every user must allow Kadar again.
- `Entitlements.plist` allows audio input under the hardened runtime. `Info.plist` holds the
  texts that macOS shows when it asks for the microphone and for Apple Events.
- The app is not notarized. Other Macs warn on the first open (right-click › Open works).

## ffmpeg

- `scripts/build-ffmpeg.sh` builds a small ffmpeg (about 8 MB) with x264, AAC, the readers for
  MOV, MP4, MKV and AVI, and only the filters Kadar uses (scale, amix, loudnorm and a few more).
  It puts it at `src-tauri/bin/ffmpeg-aarch64-apple-darwin`; Tauri ships it inside the app.
- The script writes a build id next to the program and skips the build when the id matches.
  **When you change the build flags, raise `BUILD_ID` in the script**, or old copies stay in use.
- x264 is GPL, so this ffmpeg is GPL.
- The bundled ffmpeg has no test sources (`lavfi`) and no image readers. To make new test media,
  use a full ffmpeg (for example from Homebrew) and commit the small result to `tests/data/`.

## Known traps

| Symptom | Cause and fix |
|---|---|
| Blank window in dev | Vite listened on IPv6 only. `vite.config.ts` must keep `host: '127.0.0.1'`, and `devUrl` must match. |
| No thumbnails while the window is behind others | WebKit pauses animation frames in hidden windows. Not a Rust bug. |
| Build fails after moving the project folder | The build cache keeps absolute paths. Run `cargo clean` in `src-tauri/`. |
| `cargo test` aborts with `CGS_REQUIRE_INIT` | ScreenCaptureKit needs `NSApplicationLoad()` first. |
| Video finish step fails with an AAC error | loudnorm outputs 192 kHz. Put `aresample=48000` after it. |
| App aborts when opened from Finder | Finder sends files before `setup()` runs. State used by the open handler must be managed on the Builder, not in `setup()`. |
| Dragged files arrive nowhere | Start the Mac drag from mouse movement, never from the page's `dragstart`; the page's drag wipes the drag clipboard. Allow only Copy, or Finder moves the owner's file away. |
| Old ffmpeg still used after a flag change | Raise `BUILD_ID` in `scripts/build-ffmpeg.sh`. |
| Recording a 5K screen fails | H.264 cannot encode that size. The recorder uses HEVC for the capture file. |
| Recording finish fails on silent audio | loudnorm cannot handle a silent track. The finish step retries without it. |

## Measure speed

- Measure with a release build: `PATH="$HOME/.cargo/bin:$PATH" npx tauri dev --release`. The
  debug build is many times slower at images.
- Use a test folder with many photos in the scratchpad, never the owner's own photo folders.
- Numbers on 10,000 photos (2026-10-09, 10 performance cores): the folder opens in about 70 ms,
  the first screen of thumbnails shows in about 0.2 s, scrolling holds 60 fps, the big view opens
  in 5 ms, and the next image shows at once.

## Check the running app

- Take pictures of Kadar's own windows only. Find the window number with CGWindowList (owner
  "kadar"), then run `screencapture -l <number> -x -o out.png`. A right-click menu is its own
  Kadar window; capture it the same way.
- Never capture the whole screen or a screen area (`screencapture -R`). Other windows can cover
  Kadar and show the owner's private content.
- Do not send synthetic clicks. They do not reach Kadar and can land in other apps. To test a
  flow, add a temporary block in `src/main.ts`, write the result to `localStorage`, read it, and
  remove the block.

## Safety

- Before you delete a folder, list what is in it. Git-ignored folders can hold the owner's files.
- Commit only when the owner asks. Never push without asking.
