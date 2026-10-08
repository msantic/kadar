import fs from 'fs'
import type { BrowserWindow } from 'electron'

let current: { dir: string; watcher: fs.FSWatcher } | null = null
let debounceTimer: NodeJS.Timeout | null = null

export function watch(win: BrowserWindow, dirPath: string): void {
  unwatch()
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(dirPath, { persistent: false })
  } catch {
    return
  }
  watcher.on('change', () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      win.webContents.send('viewer:fs:changed', { dirPath })
    }, 200)
  })
  watcher.on('error', () => unwatch())
  current = { dir: dirPath, watcher }
}

export function unwatch(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  if (current) {
    try { current.watcher.close() } catch {}
    current = null
  }
}
