// Gives the viewer screens the same `window.viewer` API they had in Electron,
// backed by Rust commands and events instead.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Unsubscribe, ViewerAPI } from '../src/renderer/viewer/types'

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
