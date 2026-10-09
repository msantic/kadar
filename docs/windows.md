# Kadar on Windows: build, check and see it

How Kadar is built, checked and shown on Windows, all from the Mac. For the plan and what
works on Windows today, read the Roadmap in [README.md](../README.md#roadmap-windows-and-linux).
For how the code is split per system, read [architecture.md](architecture.md).

## The machine

Kadar uses `winbuild`, the Windows 11 build machine of the **BIMTLY office server**. It belongs
to the BIMTLY infrastructure and DevOps setup and also builds the BIMTLY Showroom. Its own
runbook, with every setup step and every fault met, is in the `bimtly` repo:
`~/dev/bimtly/devops/conf/office/vm/README.md`. Read it before you change the machine itself.

| What | Value |
|---|---|
| Office server | `ssh marko@10.10.10.4` (Ubuntu 24.04, runs production work too) |
| Windows machine | `winbuild`, a virtual machine on that server, address `192.168.122.12` |
| Reach Windows | from the server: `ssh build@192.168.122.12`; the shell is **PowerShell**, not cmd |
| Account | `build`, a local administrator; password on the server in `/mnt/data/vm/winbuild.password` (root only) and in the BIMTLY ansible vault (`vault_winbuild_password`) |
| Kadar's copy | `C:\dev\kadar` (a git clone of github.com/msantic/kadar) |
| Tools on it | Git, Node 22, Python 3.12, Visual Studio 2022 Build Tools with the Windows SDK, WebView2. Added for Kadar on 2026-10-09: Rust (stable, MSVC; `rustup-init.exe -y --profile minimal -c clippy`) and MSYS2 in `C:\msys64` (for the video tool, see below) |

## Start and stop the machine

The machine runs **on demand**: the server also runs production, and it froze once with an
unknown cause (BIMTLY incident INC-025). It also takes the server's graphics card while it runs.

```bash
ssh marko@10.10.10.4
cd /etc/bimtly/conf/office/vm
make status   # running or not
make start    # about 30 s until Windows answers
make stop     # shuts Windows down cleanly and gives the card back
```

- **Ask the owner before you start or stop it.** The Showroom uses the same machine; someone may
  be building or testing there. `query user` in PowerShell shows a signed-in desktop session.
- Stop it when you are done, unless the owner says to keep it running.

## Run commands on Windows from the Mac

`scripts/win.sh` runs one PowerShell script on the machine and prints its output:

```bash
scripts/win.sh 'cargo --version'
scripts/win.sh < some-script.ps1
```

- The route is Mac → `ssh marko@10.10.10.4` → `ssh build@192.168.122.12`. Only the office server's
  key opens the Windows machine, so every call goes through the server.
- The script travels base64-encoded (`powershell -EncodedCommand`), so quotes and `$` never
  break on the way.
- Each run starts with Rust on the `PATH` and stops at the first error.
- Long work (a first build takes about 10 minutes) can outlast a 10-minute tool timeout. Run it
  in the background, or as a scheduled task (see the BIMTLY runbook, `make tasks`).

## Get the code there

- **Pushed work:** `scripts/win.sh 'cd C:\dev\kadar; git pull'`. Commits on this Mac are pushed
  to GitHub on their own, usually within minutes.
- **Work that is not committed:** `scripts/win-sync.sh` copies every file git tracks or would
  track (saved or not) into `C:\dev\kadar`. It makes the tar without macOS side files
  (`COPYFILE_DISABLE=1`) and unpacks it with today's time on every file (`tar -m`); without these,
  the Windows build reads `._name` side files as code or links old code (both happened to the
  Showroom). Files there that are not in the copy stay; `git status` there shows the state.

## Check and build

```bash
scripts/win-sync.sh
scripts/win.sh 'cd C:\dev\kadar\src-tauri; cargo clippy --all-targets -- -D warnings; cargo test'
scripts/win.sh 'cd C:\dev\kadar; npm ci; npx tauri build --no-bundle'   # → src-tauri\target\release\kadar.exe
```

- `npm run check` and `npm run build` are written for the Mac (they call bash scripts and the
  Mac signing). On Windows, run the steps directly as above until the Windows build script exists.
- **The video tool:** Tauri needs `src-tauri\bin\ffmpeg-x86_64-pc-windows-msvc.exe` to build at
  all. Build it once (next part). That folder is not in git, so a fresh copy of the repository
  needs the build again.
- The `.exe` runs alone: the window content is inside it, and WebView2 is part of Windows 11.

## The video tool (ffmpeg) on Windows

The same `scripts/build-ffmpeg.sh` builds the Windows tool, with the same parts as on the Mac
(x264, AAC, the same readers and filters). On Windows it runs in **MSYS2's MINGW64 shell**, a
free set of Unix build tools, and makes one static `ffmpeg.exe` that needs no other files.

Set up MSYS2 once (already done on `winbuild`):

```powershell
Invoke-WebRequest https://repo.msys2.org/distrib/msys2-x86_64-latest.sfx.exe -OutFile C:\dev\msys2.sfx.exe
& C:\dev\msys2.sfx.exe -y -oC:\
C:\msys64\usr\bin\bash.exe -lc "pacman-key --init && pacman-key --populate msys2"   # the package keys
C:\msys64\usr\bin\bash.exe -lc "pacman -Syu --noconfirm"   # twice: the first run updates pacman itself
C:\msys64\usr\bin\bash.exe -lc "pacman -S --noconfirm --needed mingw-w64-x86_64-gcc mingw-w64-x86_64-nasm mingw-w64-x86_64-zlib mingw-w64-x86_64-pkgconf make git diffutils tar xz"
```

Build the tool (about 20–30 minutes the first time; later runs skip it while `BUILD_ID` is the
same):

```bash
scripts/win.sh '$ErrorActionPreference = "Continue"; $env:MSYSTEM = "MINGW64"; $env:CHERE_INVOKING = "1"; cd C:\dev\kadar; cmd /c "C:\msys64\usr\bin\bash.exe -lc scripts/build-ffmpeg.sh 2>&1"'
```

The result is `src-tauri\bin\ffmpeg-x86_64-pc-windows-msvc.exe`. Kadar ships it as `ffmpeg.exe`
next to `kadar.exe`. The video checks (`cargo test`) run it on `tests/data/clip.mov`.

## See Kadar on Windows (remote screen)

Kadar must run in a desktop session to be seen. A program started over SSH runs in a hidden
session; use the remote screen instead.

1. **Open the tunnel** on the Mac (keep it running while you watch):
   ```bash
   ssh -N -L 3389:192.168.122.12:3389 marko@10.10.10.4
   ```
   It brings the machine's remote desktop to `localhost:3389` on the Mac. Nothing opens to the
   office network or the internet.
2. **Put the password on the Mac's clipboard**, without showing it:
   ```bash
   ssh marko@10.10.10.4 sudo -n cat /mnt/data/vm/winbuild.password | pbcopy
   ```
3. **Connect** with Microsoft's **Windows App** (Mac App Store): Add PC → PC name `localhost`,
   user `build`, paste the password. The first time, accept the machine's certificate.
4. **Start Kadar** in that session: double-click **Kadar** on the desktop. The shortcut opens
   `C:\Users\build\Kadar\Kadar.exe`, with the video tool beside it as `ffmpeg.exe`, as the
   installer will place them. Test photos and a short video are in Pictures › "Kadar test".
5. When done: sign out of the session (Start → user → Sign out), and stop the tunnel (Ctrl+C).

The picture is compressed, so colors and sharpness look a little worse than on a real screen.
For judging pictures, the BIMTLY runbook lists a full-quality remote screen as "not yet".

### Put a new build in front of the viewer, from the Mac

After a rebuild, replace the running copy and start it again **in the signed-in desktop**
(a program started over SSH would run hidden). A scheduled task with `/IT` runs in the desktop
of the signed-in `build` user:

```bash
scripts/win.sh <<'PS'
$ErrorActionPreference = "Continue"
cd C:\dev\kadar
cmd /c "npx tauri build --no-bundle 2>&1" | Select-Object -Last 1
Stop-Process -Name Kadar -Force -ErrorAction SilentlyContinue; Start-Sleep 1
$app = "$env:USERPROFILE\Kadar"
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item src-tauri\target\release\kadar.exe "$app\Kadar.exe" -Force
Copy-Item src-tauri\bin\ffmpeg-x86_64-pc-windows-msvc.exe "$app\ffmpeg.exe" -Force
schtasks /Create /TN KadarShow /TR "$app\Kadar.exe" /SC ONCE /ST 23:59 /IT /RU build /F | Out-Null
schtasks /Run /TN KadarShow | Out-Null
PS
```

`Get-Process Kadar | Select-Object Id,SessionId` shows where it runs: session 0 is the hidden one,
a higher number is the desktop. To copy test photos in: `tar` them on the Mac with
`COPYFILE_DISABLE=1` and unpack through the same two SSH hops (`tar -xmf - -C <folder>`).
File names with letters outside English (Šuma) lose their accents on the way; rename such
files on Windows if the name matters.

### Open the remote screen in one step

Save this as `winbuild.rdp` and open it with Windows App (`open -a "Windows App" winbuild.rdp`)
after the tunnel is up:

```
full address:s:localhost:3389
username:s:build
prompt for credentials:i:1
screen mode id:i:1
desktopwidth:i:1600
desktopheight:i:1000
```

## What is different on Windows

- **No menu bar.** Windows apps rarely have one, and Kadar has its own look. The window maps the
  same keys to the same commands (`src/shortcuts.ts`): Ctrl instead of ⌘, plus the File Explorer
  keys Delete (Move to Recycle Bin), F2 (rename) and Alt+← / Alt+→ / Alt+↑ (back, forward, up).
  Keys that would reload the page or open the browser's find bar (F5, Ctrl+R, Ctrl+F's browser
  bar, Alt+←) are stopped first. The Mac keeps its menu bar.
- **Dark title bar**, set when Kadar starts.
- **Words:** File Explorer, Recycle Bin, Videos (`src/platform.ts`).
- **Hidden tabs:** Screenshot and Record, until they work on Windows (`platform_features`).
- **File links:** WebView2 reaches Kadar's file links as `http://viewer-file.localhost/C:/...`;
  `src/viewer/ipc.ts` builds them, `protocol.rs` turns them back into `C:/...`.
- **Images:** Windows' own image reader (WIC). HEIC and camera RAW need Microsoft's free
  "HEIF Image Extensions" and "Raw Image Extension" from the Microsoft Store; most Windows 11
  PCs have them. Colors are read as sRGB for now.
- **Video frames and length:** from File Explorer's own thumbnails and details.
- **Video:** optimizing works with the bundled ffmpeg (built for Windows, 10.7 MB, static).
- **Drag out:** the shell's own file drag (the same as File Explorer's), Copy only.
- **Not yet:** Screenshot, Record,
  an installer and signing, and one Kadar at a time (today "Open with Kadar" on a second file
  starts a second Kadar window instead of showing the file in the first).
- **Names:** Kadar refuses new names with `\ : * ? " < > |`, as Windows does.
- **Undo after the Recycle Bin** moves the file back and removes the bin's record of it, so the
  Recycle Bin does not list a file that is no longer there.

## Known traps

| Symptom | Cause and fix |
|---|---|
| `resource path bin\ffmpeg-x86_64-pc-windows-msvc.exe doesn't exist` | Tauri wants the video tool for every build. Put the Windows ffmpeg there, or a placeholder file until it exists. |
| PowerShell says "The ampersand (&) character is not allowed" | The shell is PowerShell, not cmd. Use `;` between commands, or `cmd /c "..."` for cmd syntax. `scripts/win.sh` avoids quoting problems. |
| A `cargo` or `npm` line prints nothing over SSH | Their output goes to the error stream. Wrap them: `cmd /c "cargo test 2>&1"`. |
| A long tool (pacman, a build) stops at its first progress line | `scripts/win.sh` stops at the first error, and PowerShell 5 counts any line a native tool writes to the error stream as one when it is redirected with `2>&1`. Start such a script with `$ErrorActionPreference = "Continue"` and run the tool through `cmd /c "... 2>&1"`. |
| Checks that compare paths with `/` fail on Windows | Windows paths use `\`. Compare with `Path` methods (`ends_with`, `join`), not with strings. |
| Kadar does not appear after starting it over SSH | SSH runs programs in a hidden session. Start it in the remote screen. |
| The build sees old code after a sync | The files kept the Mac's times. `scripts/win-sync.sh` unpacks with `-m` for this reason; do not copy files by other means. |
| Clippy fails on Windows with "never used" | Something only the Mac uses (menu words, capture helpers). Keep it in the Mac folder, or mark it `#[cfg_attr(not(target_os = "macos"), allow(dead_code))]` with a reason. |
| Copying `kadar.exe` fails | Kadar still runs from that file. `Stop-Process -Name Kadar -Force` first. |
