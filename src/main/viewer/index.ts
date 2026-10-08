import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { defaultRoots } from './paths'
import { listFolder, listTreeChildren } from './fs-scan'
import { watch as watchDir, unwatch as unwatchDir } from './fs-watch'
import { initPipeline, handleRequest, handleCancel } from './thumb-pipeline'
import { listFavorites, addFavorite, removeFavorite, renameFavorite } from './favorites-store'
import { getMetadata } from './metadata'

export function registerViewer(win: BrowserWindow): void {
  initPipeline(win)

  // ─── Filesystem ──────────────────────────────────────────────────────────
  ipcMain.handle('viewer:fs:listFolder', async (_e, dirPath: string) => {
    return listFolder(dirPath)
  })

  ipcMain.handle('viewer:fs:listTreeChildren', async (_e, dirPath: string) => {
    return listTreeChildren(dirPath)
  })

  ipcMain.handle('viewer:fs:getRoots', () => defaultRoots())

  ipcMain.handle('viewer:fs:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('viewer:fs:revealInFinder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('viewer:fs:openDefault', (_e, filePath: string) => {
    return shell.openPath(filePath)
  })

  ipcMain.handle('viewer:fs:watch', (_e, dirPath: string) => {
    watchDir(win, dirPath)
  })

  ipcMain.handle('viewer:fs:unwatch', () => {
    unwatchDir()
  })

  // ─── Thumbnails ──────────────────────────────────────────────────────────
  ipcMain.handle(
    'viewer:thumb:request',
    async (_e, payload: {
      requestId: string
      files: { srcPath: string; mtimeMs: number; size: number }[]
      targetSize: number
    }) => {
      console.log('[viewer:thumb:request]', payload.files.length, 'files, requestId:', payload.requestId)
      const result = await handleRequest(payload.requestId, payload.files, payload.targetSize)
      console.log('[viewer:thumb:request] result: cached=', Object.keys(result.cached).length, 'pending=', result.pending.length)
      return result
    },
  )

  ipcMain.handle('viewer:thumb:cancel', (_e, requestId: string) => {
    handleCancel(requestId)
  })

  // ─── Metadata ────────────────────────────────────────────────────────────
  ipcMain.handle('viewer:meta:get', async (_e, filePath: string) => {
    return getMetadata(filePath)
  })

  // ─── Favorites ───────────────────────────────────────────────────────────
  ipcMain.handle('viewer:fav:list',   ()               => listFavorites())
  ipcMain.handle('viewer:fav:add',    (_e, p: string)  => addFavorite(p))
  ipcMain.handle('viewer:fav:remove', (_e, id: string) => removeFavorite(id))
  ipcMain.handle('viewer:fav:rename', (_e, { id, label }: { id: string; label: string }) => renameFavorite(id, label))
}
