# Image & Video Optimizer

Electron desktop app + CLI for batch image/video optimization and screen capture.

## Desktop App

```bash
npm install
npm run dev
```

### Optimize

Drag and drop images or videos onto the window. Outputs land in an `optimized/` subfolder next to your source files.

- **Images** (JPG, PNG) → WebP with configurable max width (800–2400px)
- **Videos** (MP4, MOV, MKV, AVI, WebM) → compressed H.264 MP4 at 480p–1080p or original resolution

### Record

Screen recording with window resize presets, mic/system audio capture, and countdown timer.

- VP9 WebM capture → H.264 MP4 conversion via ffmpeg
- Resolution-aware bitrate (6–45 Mbps depending on capture size)
- Optional audio normalization (EBU R128 loudnorm)
- Raw output mode for video editors (CRF 12, preset slow)

### Screenshot

Capture app windows as PNG or WebP with post-processing options.

- Window picker with resize presets (1944×1100, 1920×1080, 1280×720, 2560×1440, custom)
- Border trim — crop N pixels from each edge to remove macOS window border
- Scale — resize output to 25%, 50%, 75%, or 100%
- Live output dimension preview with aspect ratio detection
- All settings persist across app restarts

## macOS Setup Notes

`npm install` handles everything automatically, including:
- Rebuilding `sharp` for the installed Electron version (`electron-rebuild`)
- Re-signing the Electron bundle (`codesign --force --deep --sign -`)

**If the app crashes on launch or `process.type` is undefined**, the cause is almost always
`ELECTRON_RUN_AS_NODE=1` leaking into the environment (VSCode sets this for its own Electron
internals). The `npm run dev` script already strips it with `env -u ELECTRON_RUN_AS_NODE`, so
running via npm is always safe. Never run the Electron binary directly inside a VSCode terminal
without unsetting that variable first.

## CLI

```bash
node index.mjs <INPUT-FOLDER> [<MAX-WIDTH>]
```

- `<INPUT-FOLDER>`: path to folder with jpg/jpeg/png images
- `<MAX-WIDTH>`: max output width in pixels (default: 1600)

**Example:**
```bash
node index.mjs ~/photos/ 1200
```

Output saved to `<INPUT-FOLDER>/optimized/` as `.webp` files. Existing files are skipped.

## Architecture

### Stack

- **Electron 40** + electron-vite 5 + TypeScript
- **sharp** — WebP conversion + screenshot cropping/scaling
- **fluent-ffmpeg** + **ffmpeg-static** — bundled video encoder, no system ffmpeg needed
- **screencapture** + **Swift/CoreGraphics** — native macOS window capture via CGWindowID
- Vanilla TypeScript renderer (no framework), dark macOS UI (SF Pro, traffic-light titlebar)

### Process Model

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (src/main/index.ts)                           │
│                                                             │
│  IPC Handlers:                                              │
│    optimize-files → image.ts (sharp) / video.ts (ffmpeg)    │
│    save-recording → temp file → ffmpeg → MP4                │
│    take-screenshot → osascript → swift CGWindowID           │
│                      → screencapture → sharp trim/scale     │
│    get-running-apps → osascript (System Events)             │
│    resize-window → osascript (System Events)                │
│    get-window-id → swift (CoreGraphics)                     │
│    choose-directory, get-permissions, open-in-finder,       │
│    open-external, set-dock-badge                            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Preload (src/preload/index.ts)                             │
│  contextBridge → window.optimizer                           │
│  All methods: ipcRenderer.invoke() wrappers                 │
├─────────────────────────────────────────────────────────────┤
│  Renderer (src/renderer/)                                   │
│                                                             │
│  main.ts ─── tab switching, optimize panel, persist         │
│  recorder.ts ─── screen recording, audio, MediaRecorder     │
│  screenshot.ts ─── window capture, trim/scale options       │
│  shared.ts ─── window picker, resize, persist(), DOM utils  │
│  style.css ─── dark macOS theme, CSS variables              │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── main/
│   ├── index.ts              # Main process, all IPC handlers
│   └── optimizer/
│       ├── image.ts          # sharp: JPG/PNG → WebP
│       └── video.ts          # fluent-ffmpeg: video → H.264 MP4
├── preload/
│   └── index.ts              # contextBridge API (window.optimizer)
└── renderer/
    ├── index.html            # Three-tab layout (Optimize, Record, Screenshot)
    ├── main.ts               # Tab switching + optimize drag-drop panel
    ├── recorder.ts           # Screen recording (getDisplayMedia → VP9 → ffmpeg)
    ├── screenshot.ts         # Window screenshot (screencapture → sharp)
    ├── shared.ts             # Shared: window picker, resize, persist, DOM helpers
    └── style.css             # Dark macOS UI (CSS vars, grid layouts)
```

### Data Flow

```
Optimize:
  Drop files → getPathForFile → IPC optimize-files → sharp/ffmpeg
  → IPC file-progress (push) → renderer queue updates

Record:
  getDisplayMedia → MediaRecorder (VP9 WebM, 6-45 Mbps)
  → IPC save-recording → ffmpeg WebM→MP4 → file path returned

Screenshot:
  Form values → IPC take-screenshot
  → activate app (osascript) → CGWindowID (swift)
  → screencapture -l → sharp extract (trim × DPR) → sharp resize (scale%)
  → optional WebP convert → file path returned
```

### IPC Patterns

- **Request-response**: All handlers use `ipcMain.handle` / `ipcRenderer.invoke`
- **Push events**: `file-progress` uses `webContents.send` / `ipcRenderer.on` for real-time progress
- **File paths**: `~` expanded to `app.getPath('home')`, timestamps for unique filenames
- **CJS in ESM**: `createRequire()` for fluent-ffmpeg and ffmpeg-static
- **asar**: ffmpeg-static path corrected from `app.asar` to `app.asar.unpacked`

### macOS System Integration

| Feature | Method |
|---------|--------|
| List running apps | `osascript` — System Events process list |
| Resize app window | `osascript` — System Events set size/position |
| Get window ID | `swift -e` — `CGWindowListCopyWindowInfo` (JXA broken on modern macOS) |
| Capture window | `screencapture -l <windowId> -x [-o]` |
| Retina handling | Trim pixels scaled by `screen.getPrimaryDisplay().scaleFactor` |
| Screen/mic permissions | `systemPreferences.getMediaAccessStatus()` |
| Screen picker | `setDisplayMediaRequestHandler` with `useSystemPicker: true` |

### State Persistence

All form values persist across restarts via `localStorage`:

- **`persist(elementId)`** in `shared.ts` — restores value on init, auto-saves on `change`/`input`
- Works with `<select>`, `<input type="number">`, `<input type="checkbox">`
- Save directories stored under dedicated keys (`recorder-save-dir`, `screenshot-save-dir`)
- Active tab stored as `persist:active-tab`

### Build & Packaging

```bash
npm run dev          # env -u ELECTRON_RUN_AS_NODE electron-vite dev
npm run build        # electron-vite build && electron-builder --mac
node index.mjs       # standalone CLI (images only)
```

- `electron-builder` → DMG for macOS
- `asarUnpack`: sharp, @img, ffmpeg-static (native binaries outside asar)
- `postinstall`: `electron-rebuild -f -w sharp` + `codesign --force --deep --sign -`
