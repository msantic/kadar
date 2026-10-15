// One grid tile: thumbnail, kind badge and file name. The grid keeps a small pool of tiles
// and reuses them while you scroll, so a tile shows a different file over time.

import type { FileEntry } from '../types'
import { fileUrl } from '../ipc'
import { fileVersion } from '../refresh'
import type { ThumbFile } from './thumb-loader'

/** A tile's elements and the file it shows now. `index` is -1 and `entry` null until assigned. */
export interface CellHandle {
  root: HTMLDivElement
  img: HTMLImageElement
  label: HTMLSpanElement
  badge: HTMLSpanElement
  index: number
  entry: FileEntry | null
}

/** An empty tile, not yet in the page. */
export function createCell(): CellHandle {
  const root = document.createElement('div')
  root.className = 'viewer-cell'
  root.tabIndex = -1

  const thumbWrap = document.createElement('div')
  thumbWrap.className = 'viewer-cell-thumb'

  const img = document.createElement('img')
  img.className = 'viewer-cell-img'
  img.draggable = false
  img.decoding = 'async'

  const badge = document.createElement('span')
  badge.className = 'viewer-cell-badge'

  thumbWrap.append(img, badge)

  const label = document.createElement('span')
  label.className = 'viewer-cell-label'

  root.append(thumbWrap, label)

  return { root, img, label, badge, index: -1, entry: null }
}

/**
 * Shows `entry` in the tile. `cachedUrl` is the thumbnail file path; null clears the picture,
 * except for a newer version of the file the tile already shows: its old picture stays until the
 * new thumbnail arrives, so an edited photo does not blink empty.
 */
export function assignCell(cell: CellHandle, entry: FileEntry, index: number, cachedUrl: string | null): void {
  const sameFile = cell.entry?.path === entry.path
  cell.index = index
  cell.entry = entry
  cell.label.textContent = entry.name
  cell.root.dataset['kind'] = entry.kind
  cell.badge.textContent = entry.kind === 'video' ? 'VIDEO' : entry.ext.toUpperCase()
  cell.badge.hidden = entry.kind === 'folder' || (entry.kind !== 'video' && !entry.ext)
  if (cachedUrl) {
    cell.img.src = fileUrl(cachedUrl)
    cell.img.classList.add('loaded')
  } else if (!sameFile) {
    cell.img.removeAttribute('src')
    cell.img.classList.remove('loaded')
  }
}

/** True when the tile shows this very version of the file. */
const shows = (cell: CellHandle, file: ThumbFile): boolean =>
  cell.entry !== null && cell.entry.path === file.path && fileVersion(cell.entry) === file.version

/** Sets the thumbnail when it arrives. Does nothing if the tile shows another file, or another version of it, by now. */
export function setCellThumb(cell: CellHandle, file: ThumbFile, cachePath: string): void {
  if (!shows(cell, file)) return
  cell.img.src = fileUrl(cachePath)
  cell.img.classList.add('loaded')
}

/** No thumbnail can be made for this version of the file: clear the tile's picture, so an
 *  edited photo does not keep showing its old version. Does nothing for another file or version. */
export function clearCellThumb(cell: CellHandle, file: ThumbFile): void {
  if (!shows(cell, file)) return
  cell.img.removeAttribute('src')
  cell.img.classList.remove('loaded')
}

/** Places and sizes the tile, in px, with a CSS transform. */
export function positionCell(cell: CellHandle, left: number, top: number, width: number, height: number): void {
  cell.root.style.transform = `translate(${left}px, ${top}px)`
  cell.root.style.width  = `${width}px`
  cell.root.style.height = `${height}px`
}
