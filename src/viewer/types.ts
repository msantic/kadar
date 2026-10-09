/** 'folder' is a subfolder tile in the grid; Rust lists folders separately. */
export type Kind = 'image' | 'video' | 'unsupported' | 'folder'

export interface FolderEntry {
  name: string
  path: string
}

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

export interface FolderListing {
  folders: FolderEntry[]
  files: FileEntry[]
  truncated: boolean
}

export interface Favorite {
  id: string
  path: string
  label: string
  addedAt: number
  kind: 'folder'
}

export interface DefaultRoots {
  home: string
  pictures: string
  desktop: string
  downloads: string
  movies: string
}

export interface FileMetadata {
  width?: number
  height?: number
  durationMs?: number
  sizeBytes: number
  mtimeMs: number
}

export interface ExportOptions {
  /** Clockwise quarter turns, 0–3. */
  turns: number
  /** Part of the rotated image as fractions 0–1; null keeps all of it. */
  crop: { x: number; y: number; w: number; h: number } | null
  maxWidth: number | null
  format: 'webp' | 'jpg' | 'png'
  quality: number
}

export interface ExportResult {
  width: number
  height: number
  bytes: number
  path: string
}

export type Unsubscribe = () => void

export interface ViewerAPI {
  fs: {
    listFolder: (dirPath: string) => Promise<FolderListing>
    listTreeChildren: (dirPath: string) => Promise<FolderEntry[]>
    getRoots: () => Promise<DefaultRoots>
    chooseFolder: () => Promise<string | null>
    revealInFinder: (p: string) => Promise<void>
    /** Moves files to the Trash. Returns how many moved. */
    trash: (paths: string[]) => Promise<number>
    /** Camera dates for the "Date Taken" sort, in the same order. */
    takenDates: (files: { path: string; mtimeMs: number }[]) => Promise<(number | null)[]>
    /** Renames a file; returns its new path. */
    rename: (path: string, newName: string) => Promise<string>
    openDefault: (p: string) => Promise<string>
    watch: (p: string) => Promise<void>
    unwatch: () => Promise<void>
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
    onDone:  (cb: (data: { requestId: string }) => void) => Unsubscribe
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
