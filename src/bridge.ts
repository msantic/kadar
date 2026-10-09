// Gives the viewer screens the same `window.viewer` API they had in Electron,
// backed by Rust commands and events instead.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { startDrag } from '@crabnebula/tauri-plugin-drag'
import { optimizePaths } from './optimize'
import type { Unsubscribe, ViewerAPI } from './viewer/types'

function subscribe<T>(event: string, cb: (data: T) => void): Unsubscribe {
  let off: (() => void) | null = null
  let disposed = false
  void listen<T>(event, (e) => cb(e.payload)).then((fn) => {
    if (disposed) fn()
    else off = fn
  })
  return () => {
    disposed = true
    off?.()
  }
}

export function installViewerBridge(): void {
  const api: ViewerAPI = {
    fs: {
      listFolder:       (dirPath) => invoke('list_folder', { dirPath }),
      listTreeChildren: (dirPath) => invoke('list_tree_children', { dirPath }),
      getRoots:         () => invoke('get_roots'),
      chooseFolder:     () => invoke('choose_folder'),
      revealInFinder:   (path) => invoke('reveal_in_finder', { path }),
      trash:            (paths) => invoke('trash_files', { paths }),
      rename:           (path, newName) => invoke('rename_file', { path, newName }),
      takenDates:       (files) => invoke('taken_dates', { files }),
      openDefault:      (path) => invoke('open_default', { path }),
      watch:            (path) => invoke('watch_folder', { path }),
      unwatch:          () => invoke('unwatch_folder'),
      onChanged:        (cb) => subscribe('viewer:fs:changed', cb),
    },
    thumb: {
      request: ({ requestId, files, targetSize }) =>
        invoke('thumb_request', { requestId, files, targetSize }),
      cancel:  (requestId) => invoke('thumb_cancel', { requestId }),
      onReady: (cb) => subscribe('viewer:thumb:ready', cb),
      onError: (cb) => subscribe('viewer:thumb:error', cb),
      onDone:  (cb) => subscribe('viewer:thumb:done', cb),
    },
    meta: {
      get: (filePath) => invoke('meta_get', { filePath }),
      properties: (filePath) => invoke('image_properties', { path: filePath }),
      openUrl: (url) => invoke('open_external', { url }),
    },
    share: {
      startDrag: (paths, icon) => startDrag({ item: paths, icon, mode: 'copy' }),
      optimize:  (paths) => optimizePaths(paths),
      exportImage: (path, options) => invoke('export_image', { path, options }),
      exportSave:  (source, result) => invoke('export_save', { source, result }),
      exportCopy:  (result) => invoke('export_copy', { result }),
    },
    clipboard: {
      copyFiles: (paths) => invoke('copy_files', { paths }),
      copyPaths: (paths) => invoke('copy_paths', { paths }),
    },
    favorites: {
      list:   () => invoke('fav_list'),
      add:    (path) => invoke('fav_add', { path }),
      remove: (id) => invoke('fav_remove', { id }),
      rename: (id, label) => invoke('fav_rename', { id, label }),
    },
  }
  window.viewer = api
}

// The Screenshot screen (shared with the Electron app) calls `window.optimizer`.
interface CaptureAPI {
  getRunningApps: () => Promise<string[]>
  resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) => Promise<void>
  chooseDirectory: () => Promise<string | null>
  getPermissions: () => Promise<{ screen: string; microphone: string }>
  openInFinder: (dirPath: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  takeScreenshot: (p: { appName: string; outputDir: string; format: 'png' | 'webp'; shadow: boolean; trimPx: number; scale: number }) => Promise<string>
}

export function installCaptureBridge(): void {
  const api: CaptureAPI = {
    getRunningApps:  () => invoke('capture_running_apps'),
    resizeWindow:    (p) => invoke('capture_resize_window', p),
    chooseDirectory: () => invoke('choose_folder'),
    getPermissions:  () => invoke('capture_permissions'),
    openInFinder:    (path) => invoke('open_in_finder', { path }),
    openExternal:    (url) => invoke('open_external', { url }),
    takeScreenshot:  (options) => invoke('capture_take', { options }),
  }
  ;(window as unknown as { optimizer: CaptureAPI }).optimizer = api
}
