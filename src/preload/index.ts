import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface ProgressEvent {
  file: string
  status: 'processing' | 'done' | 'skipped' | 'error'
  percent?: number
  outPath?: string
  error?: string
}

export interface OptimizeOptions {
  maxWidth: number
  imageFormat: 'webp' | 'png' | 'jpg'
  videoPreset: string
}

contextBridge.exposeInMainWorld('optimizer', {
  // ─── Optimize ──────────────────────────────────────────────────────────────
  optimizeFiles: (files: string[], options: OptimizeOptions) =>
    ipcRenderer.invoke('optimize-files', { files, options }),

  openInFinder: (dirPath: string) =>
    ipcRenderer.invoke('open-in-finder', dirPath),

  getPathForFile: (file: File) =>
    webUtils.getPathForFile(file),

  onFileProgress: (callback: (data: ProgressEvent) => void) => {
    ipcRenderer.on('file-progress', (_event, data: ProgressEvent) => callback(data))
  },

  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('file-progress')
  },

  // ─── Recorder ──────────────────────────────────────────────────────────────
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),

  resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) =>
    ipcRenderer.invoke('resize-window', p),

  saveRecording: (p: { buffer: ArrayBuffer; outputDir: string; mimeType: string; normalizeAudio: boolean; hasAudio: boolean; rawOutput: boolean }) =>
    ipcRenderer.invoke('save-recording', p),

  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),

  getPermissions: () => ipcRenderer.invoke('get-permissions'),

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  setDockBadge: (text: string) => ipcRenderer.invoke('set-dock-badge', text),

  // ─── Screenshot ───────────────────────────────────────────────────────────
  getWindowId: (appName: string) => ipcRenderer.invoke('get-window-id', appName),

  takeScreenshot: (p: { appName: string; outputDir: string; format: 'png' | 'webp'; shadow: boolean; trimPx: number; scale: number }) =>
    ipcRenderer.invoke('take-screenshot', p),
})

// ─── Viewer ────────────────────────────────────────────────────────────────

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (data: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, data: T): void => cb(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('viewer', {
  fs: {
    listFolder:        (dirPath: string) => ipcRenderer.invoke('viewer:fs:listFolder', dirPath),
    listTreeChildren:  (dirPath: string) => ipcRenderer.invoke('viewer:fs:listTreeChildren', dirPath),
    getRoots:          ()                => ipcRenderer.invoke('viewer:fs:getRoots'),
    chooseFolder:      ()                => ipcRenderer.invoke('viewer:fs:chooseFolder'),
    revealInFinder:    (p: string)       => ipcRenderer.invoke('viewer:fs:revealInFinder', p),
    openDefault:       (p: string)       => ipcRenderer.invoke('viewer:fs:openDefault', p),
    watch:             (p: string)       => ipcRenderer.invoke('viewer:fs:watch', p),
    unwatch:           ()                => ipcRenderer.invoke('viewer:fs:unwatch'),
    onChanged: (cb: (data: { dirPath: string }) => void) => subscribe('viewer:fs:changed', cb),
  },
  thumb: {
    request: (payload: {
      requestId: string
      files: { srcPath: string; mtimeMs: number; size: number }[]
      targetSize: number
    }) => ipcRenderer.invoke('viewer:thumb:request', payload),
    cancel:  (requestId: string) => ipcRenderer.invoke('viewer:thumb:cancel', requestId),
    onReady: (cb: (data: { requestId: string; srcPath: string; cachePath: string }) => void) =>
      subscribe('viewer:thumb:ready', cb),
    onError: (cb: (data: { requestId: string; srcPath: string; message: string }) => void) =>
      subscribe('viewer:thumb:error', cb),
    onDone:  (cb: (data: { requestId: string }) => void) =>
      subscribe('viewer:thumb:done', cb),
  },
  meta: {
    get: (filePath: string) => ipcRenderer.invoke('viewer:meta:get', filePath),
  },
  favorites: {
    list:   ()                                  => ipcRenderer.invoke('viewer:fav:list'),
    add:    (p: string)                         => ipcRenderer.invoke('viewer:fav:add', p),
    remove: (id: string)                        => ipcRenderer.invoke('viewer:fav:remove', id),
    rename: (id: string, label: string)         => ipcRenderer.invoke('viewer:fav:rename', { id, label }),
  },
})
