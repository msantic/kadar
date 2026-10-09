// Shapes of the data the viewer gets from Rust, and the `window.viewer` API that bridge.ts
// fills in. Field names match the Rust commands' JSON (camelCase).

/** 'folder' is a subfolder tile in the grid; Rust lists folders separately. */
export type Kind = 'image' | 'video' | 'unsupported' | 'folder'

/** A subfolder: its name and full path. */
export interface FolderEntry {
  name: string
  path: string
}

/** One tile in the grid. Times are ms since 1970; `size` is in bytes; `ext` has no dot. */
export interface FileEntry {
  name: string
  path: string
  ext: string
  kind: Kind
  size: number
  mtimeMs: number
  createdMs: number
  /** Camera date, read only for the "Date Taken" sort; null when the file has none. */
  takenMs?: number | null
}

/** A folder's contents. Hidden and unsupported files are left out. `truncated`: stopped at 50,000 items. */
export interface FolderListing {
  folders: FolderEntry[]
  files: FileEntry[]
  truncated: boolean
}

/** A folder in the sidebar's Favorites. `label` is the shown name; `addedAt` is ms since 1970. */
export interface Favorite {
  id: string
  path: string
  label: string
  addedAt: number
  kind: 'folder'
}

/** Full paths of the user's standard folders, for the sidebar's Locations. */
export interface DefaultRoots {
  home: string
  pictures: string
  desktop: string
  downloads: string
  movies: string
}

/** Basic facts about one file. Size in px; no size or duration when Rust cannot read them. */
export interface FileMetadata {
  width?: number
  height?: number
  durationMs?: number
  sizeBytes: number
  mtimeMs: number
}

/** Settings of Export for Web. `maxWidth` is in px (null keeps the width); `quality` is 1–100. */
export interface ExportOptions {
  /** Clockwise quarter turns, 0–3. */
  turns: number
  /** Part of the rotated image as fractions 0–1; null keeps all of it. */
  crop: { x: number; y: number; w: number; h: number } | null
  maxWidth: number | null
  format: 'webp' | 'jpg' | 'png'
  quality: number
  /** Without `crop`: cut this width/height shape from each image's center (batch). */
  aspect?: number | null
}

/** The outcome for one image of a batch export: a result or an error, never both. */
export interface BatchItem {
  source: string
  result: ExportResult | null
  error: string | null
}

/** An exported image in Kadar's results folder, before Save or Copy. Size in px; `bytes` is the file size. */
export interface ExportResult {
  width: number
  height: number
  bytes: number
  path: string
}

/** Call it to stop listening. */
export type Unsubscribe = () => void

/** The `window.viewer` object: everything the viewer asks of Rust. Filled in by bridge.ts. */
export interface ViewerAPI {
  fs: {
    listFolder: (dirPath: string) => Promise<FolderListing>
    listTreeChildren: (dirPath: string) => Promise<FolderEntry[]>
    getRoots: () => Promise<DefaultRoots>
    chooseFolder: () => Promise<string | null>
    revealInFinder: (p: string) => Promise<void>
    /** Moves files to the Trash. Returns [where it was, where it is in the Trash] per file. */
    trash: (paths: string[]) => Promise<[string, string][]>
    /** Undo of trash: moves files back; returns the paths put back. */
    putBack: (pairs: [string, string][]) => Promise<string[]>
    /** Camera dates for the "Date Taken" sort, in the same order. */
    takenDates: (files: { path: string; mtimeMs: number }[]) => Promise<(number | null)[]>
    /** Renames a file; returns its new path. */
    rename: (path: string, newName: string) => Promise<string>
    openDefault: (p: string) => Promise<string>
    watch: (p: string) => Promise<void>
    onChanged: (cb: (data: { dirPath: string }) => void) => Unsubscribe
  }
  thumb: {
    request: (payload: {
      requestId: string
      files: { srcPath: string; mtimeMs: number; size: number }[]
      targetSize: number
    }) => Promise<{ cached: Record<string, string>; pending: string[] }>
    cancel: (requestId: string) => Promise<void>
    onReady: (cb: (data: { requestId: string; srcPath: string; cachePath: string }) => void) => Unsubscribe
    onError: (cb: (data: { requestId: string; srcPath: string; message: string }) => void) => Unsubscribe
  }
  meta: {
    get: (filePath: string) => Promise<FileMetadata>
    /** All header details of an image (camera, lens, GPS, color), grouped as the Mac names them. */
    properties: (filePath: string) => Promise<Record<string, unknown> | null>
    /** Opens a web address (https) in its app, for example a map. */
    openUrl: (url: string) => Promise<void>
  }
  share: {
    /** Native drag of files out of Kadar, into Finder, a browser or a chat. */
    startDrag: (paths: string[], icon: string) => Promise<void>
    /** Web copies with the Optimize tab's settings. Returns how many files it took. */
    optimize: (paths: string[]) => Promise<number>
    /** "Export for web": makes the result for these settings. */
    exportImage: (path: string, options: ExportOptions) => Promise<ExportResult>
    /** Saves an export result into the "optimized" folder; returns its path. */
    exportSave: (source: string, result: string) => Promise<string>
    /** Copies an export result to the clipboard. */
    exportCopy: (result: string) => Promise<void>
    /** The same edit without compression, for the Compare view. */
    exportReference: (path: string, options: ExportOptions) => Promise<ExportResult>
    /** Many images with the same settings; a newer `run` stops an older one. */
    exportBatch: (paths: string[], options: ExportOptions, run: number) => Promise<BatchItem[]>
    /** Stops the running batch at its next image; finished results stay. */
    exportStop: () => Promise<void>
    onExportProgress: (cb: (p: { run: number; done: number; total: number }) => void) => Unsubscribe
    exportCopyMany: (results: string[]) => Promise<void>
    /** Saves each result next to its source; pairs are [source, result]. Returns the saved paths. */
    exportSaveMany: (pairs: [string, string][]) => Promise<string[]>
  }
  clipboard: {
    copyFiles: (paths: string[]) => Promise<void>
    copyPaths: (paths: string[]) => Promise<void>
  }
  favorites: {
    list: () => Promise<Favorite[]>
    add: (p: string) => Promise<Favorite>
    remove: (id: string) => Promise<void>
    rename: (id: string, label: string) => Promise<Favorite | null>
  }
}

declare global {
  interface Window {
    viewer: ViewerAPI
  }
}
