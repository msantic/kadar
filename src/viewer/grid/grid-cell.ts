import type { FileEntry } from '../types'
import { fileUrl } from '../ipc'

export interface CellHandle {
  root: HTMLDivElement
  img: HTMLImageElement
  label: HTMLSpanElement
  badge: HTMLSpanElement
  index: number
  entry: FileEntry | null
}

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

export function assignCell(cell: CellHandle, entry: FileEntry, index: number, cachedUrl: string | null): void {
  cell.index = index
  cell.entry = entry
  cell.label.textContent = entry.name
  cell.root.dataset['kind'] = entry.kind
  cell.badge.textContent = entry.kind === 'video' ? 'VIDEO' : entry.ext.toUpperCase()
  cell.badge.hidden = entry.kind === 'folder' || (entry.kind !== 'video' && !entry.ext)
  if (cachedUrl) {
    cell.img.src = fileUrl(cachedUrl)
    cell.img.classList.add('loaded')
  } else {
    cell.img.removeAttribute('src')
    cell.img.classList.remove('loaded')
  }
}

export function setCellThumb(cell: CellHandle, srcPath: string, cachePath: string): void {
  if (!cell.entry || cell.entry.path !== srcPath) return
  cell.img.src = fileUrl(cachePath)
  cell.img.classList.add('loaded')
}

export function positionCell(cell: CellHandle, left: number, top: number, width: number, height: number): void {
  cell.root.style.transform = `translate(${left}px, ${top}px)`
  cell.root.style.width  = `${width}px`
  cell.root.style.height = `${height}px`
}
