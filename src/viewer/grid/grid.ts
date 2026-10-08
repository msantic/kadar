import { computeLayout, totalHeight, ZOOM_DEFAULT, type GridLayout } from './grid-layout'
import { createCell, assignCell, setCellThumb, positionCell, type CellHandle } from './grid-cell'
import { ThumbLoader } from './thumb-loader'
import { subscribe, getState, setState } from '../store'
import { updateSession } from '../session'
import { emit } from '../bus'
import type { FileEntry } from '../types'

const OVERSCAN_ROWS = 2

export interface GridHandle {
  root: HTMLElement
  setZoom: (targetCell: number) => void
  /** Scrolls so the row with this image is at the top, and keeps it there on resize and zoom. */
  scrollToIndex: (index: number) => void
  dispose: () => void
}

export function createGrid(): GridHandle {
  const root = document.createElement('div')
  root.className = 'viewer-grid-scroll'

  const canvas = document.createElement('div')
  canvas.className = 'viewer-grid-canvas'
  root.appendChild(canvas)

  const empty = document.createElement('div')
  empty.className = 'viewer-grid-empty'
  empty.textContent = 'Select a folder from the sidebar'
  root.appendChild(empty)

  let entries: FileEntry[] = []
  let zoom = ZOOM_DEFAULT
  let layout: GridLayout = computeLayout(800, zoom)
  const cellPool: CellHandle[] = []
  const indexToCell = new Map<number, CellHandle>()
  // The first image of the top row. Resizing and zooming keep this image at the top.
  let topIndex = 0
  // scrollTop we set ourselves; the scroll event it causes must not move topIndex.
  let ownScrollTop: number | null = null

  const loader = new ThumbLoader((srcPath, cachePath) => {
    for (const cell of indexToCell.values()) {
      if (cell.entry?.path === srcPath) setCellThumb(cell, srcPath, cachePath)
    }
  })

  const ro = new ResizeObserver(() => relayout())
  ro.observe(root)

  root.addEventListener('scroll', () => {
    if (ownScrollTop !== null && Math.abs(root.scrollTop - ownScrollTop) < 1) {
      ownScrollTop = null
    } else {
      ownScrollTop = null
      topIndex = Math.floor(root.scrollTop / layout.rowHeight) * layout.columns
      updateSession({ topIndex, topPath: entries[topIndex]?.path ?? null })
    }
    render()
  }, { passive: true })

  function relayout(): void {
    layout = computeLayout(root.clientWidth, zoom)
    canvas.style.height = `${totalHeight(entries.length, layout)}px`
    scrollToTop()
    fullRerender()
  }

  /** Puts the row that holds topIndex at the top of the view. */
  function scrollToTop(): void {
    const top = Math.floor(topIndex / layout.columns) * layout.rowHeight
    if (Math.abs(root.scrollTop - top) >= 1) {
      ownScrollTop = top
      root.scrollTop = top
    }
  }

  function markSelected(cell: CellHandle): void {
    const selected = getState().selectedPath
    cell.root.classList.toggle('selected', !!cell.entry && cell.entry.path === selected)
  }

  /** After the big view closes, show the image it ended on if it is off screen. */
  function revealSelected(): void {
    const selected = getState().selectedPath
    const index = selected ? entries.findIndex((e) => e.path === selected) : -1
    if (index < 0) return
    const rowTop = Math.floor(index / layout.columns) * layout.rowHeight
    const visible = rowTop >= root.scrollTop && rowTop + layout.rowHeight <= root.scrollTop + root.clientHeight
    if (!visible) {
      topIndex = Math.floor(index / layout.columns) * layout.columns
      scrollToTop()
      updateSession({ topIndex, topPath: entries[topIndex]?.path ?? null })
      render()
    }
  }

  function recycleCell(): CellHandle {
    const cell = createCell()
    cellPool.push(cell)
    canvas.appendChild(cell.root)
    cell.root.addEventListener('click', (e) => handleClick(e, cell))
    cell.root.addEventListener('dblclick', () => {
      if (cell.entry) void window.viewer.fs.openDefault(cell.entry.path)
    })
    cell.root.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (cell.entry) void window.viewer.fs.revealInFinder(cell.entry.path)
    })
    return cell
  }

  function handleClick(e: MouseEvent, cell: CellHandle): void {
    if (!cell.entry) return
    if (e.metaKey || e.ctrlKey) {
      void window.viewer.fs.revealInFinder(cell.entry.path)
      return
    }
    setState({ selectedPath: cell.entry.path })
    emit('lightbox:open', { index: cell.index })
  }

  function render(): void {
    if (entries.length === 0) {
      empty.hidden = false
      for (const cell of cellPool) cell.root.style.visibility = 'hidden'
      indexToCell.clear()
      return
    }
    empty.hidden = true

    const scrollTop = root.scrollTop
    const viewportH = root.clientHeight
    const firstRow = Math.max(0, Math.floor(scrollTop / layout.rowHeight) - OVERSCAN_ROWS)
    const lastRow  = Math.min(
      Math.ceil(entries.length / layout.columns) - 1,
      Math.ceil((scrollTop + viewportH) / layout.rowHeight) + OVERSCAN_ROWS,
    )

    const needed: number[] = []
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = 0; col < layout.columns; col++) {
        const idx = row * layout.columns + col
        if (idx >= entries.length) break
        needed.push(idx)
      }
    }

    // Release cells outside visible range.
    for (const [idx, cell] of indexToCell) {
      if (idx < firstRow * layout.columns || idx > lastRow * layout.columns + layout.columns - 1) {
        cell.root.style.visibility = 'hidden'
        indexToCell.delete(idx)
      }
    }

    // Assign cells to needed indices.
    const toRequest: FileEntry[] = []
    let poolCursor = 0
    for (const idx of needed) {
      if (indexToCell.has(idx)) {
        const cell = indexToCell.get(idx)!
        placeCell(cell, idx)
        continue
      }
      let cell: CellHandle | undefined
      while (poolCursor < cellPool.length) {
        const candidate = cellPool[poolCursor++]!
        if (!isCellInUse(candidate)) { cell = candidate; break }
      }
      if (!cell) cell = recycleCell()
      const entry = entries[idx]!
      assignCell(cell, entry, idx, loader.getCached(entry.path))
      markSelected(cell)
      cell.root.style.visibility = 'visible'
      placeCell(cell, idx)
      indexToCell.set(idx, cell)
      if (!loader.getCached(entry.path)) toRequest.push(entry)
    }

    if (toRequest.length > 0) loader.request(toRequest)
  }

  function isCellInUse(cell: CellHandle): boolean {
    for (const c of indexToCell.values()) if (c === cell) return true
    return false
  }

  function placeCell(cell: CellHandle, idx: number): void {
    const row = Math.floor(idx / layout.columns)
    const col = idx % layout.columns
    const left = layout.gap + col * (layout.cellWidth + layout.gap)
    const top  = layout.gap + row * layout.rowHeight
    positionCell(cell, left, top, layout.cellWidth, layout.cellHeight)
  }

  function fullRerender(): void {
    for (const cell of cellPool) cell.root.style.visibility = 'hidden'
    indexToCell.clear()
    render()
  }

  const unsub = subscribe((s, prev) => {
    if (s.entries !== prev.entries || s.currentFolder !== prev.currentFolder) {
      entries = s.entries
      loader.reset()
      topIndex = 0
      canvas.style.height = `${totalHeight(entries.length, layout)}px`
      scrollToTop()
      fullRerender()
    }
    if (s.selectedPath !== prev.selectedPath) {
      for (const cell of indexToCell.values()) markSelected(cell)
    }
    if (prev.lightboxIndex !== null && s.lightboxIndex === null) revealSelected()
  })

  // Initial paint from current state (if any).
  entries = getState().entries
  canvas.style.height = `${totalHeight(entries.length, layout)}px`
  render()

  return {
    root,
    setZoom(targetCell: number) {
      zoom = targetCell
      relayout()
    },
    scrollToIndex(index: number) {
      topIndex = Math.max(0, Math.min(index, entries.length - 1))
      scrollToTop()
      render()
    },
    dispose: () => {
      unsub()
      ro.disconnect()
      loader.dispose()
    },
  }
}
