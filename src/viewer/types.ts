export type Kind = 'image' | 'video' | 'unsupported'

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

export type Unsubscribe = () => void

export interface ViewerAPI {
  fs: {
    listFolder: (dirPath: string) => Promise<FolderListing>
    listTreeChildren: (dirPath: string) => Promise<FolderEntry[]>
    getRoots: () => Promise<DefaultRoots>
    chooseFolder: () => Promise<string | null>
    revealInFinder: (p: string) => Promise<void>
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
