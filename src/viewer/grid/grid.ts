import { computeLayout, totalHeight, ZOOM_DEFAULT, type GridLayout } from './grid-layout'
import { createCell, assignCell, setCellThumb, positionCell, type CellHandle } from './grid-cell'
import { ThumbLoader } from './thumb-loader'
import { subscribe, getState } from '../store'
import {
  copySelection, extendTo, openSelectionDefault, optimizeSelection, selectAll, selectedPaths, selectOnly, selectPath, toggle, trashSelection,
} from '../selection'
import { on } from '../bus'
import { showContextMenu } from '../context-menu'
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
    // A rename field sits on one cell; scrolling reuses cells, so finish the rename first.
    editing?.input.blur()
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
    const { selection, selectedPath } = getState()
    const path = cell.entry?.path
    cell.root.classList.toggle('selected', !!path && (selection.has(path) || path === selectedPath))
    cell.root.classList.toggle('focused', !!path && path === selectedPath && selection.size > 1)
  }

  function selectedIndex(): number {
    const selected = getState().selectedPath
    return selected ? entries.findIndex((e) => e.path === selected) : -1
  }

  /** Scrolls the least needed to show the row of `index`. The scroll event then updates topIndex. */
  function ensureVisible(index: number): void {
    const rowTop = Math.floor(index / layout.columns) * layout.rowHeight
    const rowBottom = rowTop + layout.rowHeight + layout.gap
    if (rowTop < root.scrollTop) root.scrollTop = rowTop
    else if (rowBottom > root.scrollTop + root.clientHeight) root.scrollTop = rowBottom - root.clientHeight
  }

  /** After the big view closes, show the image it ended on if it is off screen. */
  function revealSelected(): void {
    const index = selectedIndex()
    if (index >= 0) ensureVisible(index)
  }

  /** Moves the focus to `index`: alone, or growing the Shift range. */
  function select(index: number, extend = false): void {
    const i = Math.max(0, Math.min(index, entries.length - 1))
    if (extend) extendTo(i)
    else selectOnly(i)
    ensureVisible(i)
  }

  // Finder-style keys in the grid: arrows, Home/End and Page Up/Down move the selection (with
  // Shift they grow it); Space or Return opens the big view; Cmd+A selects all; Cmd+C copies the
  // files, Shift+Cmd+C their paths; Esc keeps only the focused file. The big view handles its own
  // keys while open.
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey) return
    if (getState().lightboxIndex !== null || root.offsetParent === null || entries.length === 0) return
    const target = e.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))) return

    const current = selectedIndex()
    if (e.metaKey) {
      const key = e.key.toLowerCase()
      // Cmd+O or Cmd+Down opens the files in their default apps; Cmd+Delete moves them to the
      // Trash. Both as in Finder.
      // Shift+Cmd+O optimizes the selection (web copies in an "optimized" folder).
      if (key === 'o' && e.shiftKey && current >= 0) {
        e.preventDefault()
        void optimizeSelection()
      } else if ((key === 'o' || e.key === 'ArrowDown') && current >= 0) {
        e.preventDefault()
        openSelectionDefault()
      } else if (e.key === 'Backspace' && current >= 0) {
        e.preventDefault()
        void trashSelection()
      } else if (key === 'a') {
        e.preventDefault()
        selectAll()
      } else if (key === 'c') {
        e.preventDefault()
        void copySelection(e.shiftKey)
      } else if (key === 'e' && current >= 0 && entries[current]!.kind === 'image') {
        e.preventDefault()
        emit('export:open', { path: entries[current]!.path })
      }
      return
    }
    if (e.key === 'Escape' && current >= 0 && getState().selection.size > 1) {
      e.preventDefault()
      selectOnly(current)
      return
    }
    // With no selection yet, the first key selects the top-left image on screen.
    const from = current >= 0 ? current : topIndex
    const pageRows = Math.max(1, Math.floor(root.clientHeight / layout.rowHeight))
    const last = entries.length - 1
    let next: number | null = null
    switch (e.key) {
      case 'ArrowRight': next = current >= 0 ? from + 1 : from; break
      case 'ArrowLeft':  next = current >= 0 ? from - 1 : from; break
      case 'ArrowDown':  next = current >= 0 ? Math.min(from + layout.columns, last) : from; break
      case 'ArrowUp':    next = current >= 0 ? (from - layout.columns >= 0 ? from - layout.columns : from) : from; break
      case 'PageDown':   next = Math.min(from + layout.columns * pageRows, last); break
      case 'PageUp':     next = Math.max(from - layout.columns * pageRows, from % layout.columns); break
      case 'Home':       next = 0; break
      case 'End':        next = last; break
      case ' ':
        e.preventDefault()
        if (current < 0) return
        if (entries[current]!.kind === 'folder') emit('folder:request', { path: entries[current]!.path })
        else emit('lightbox:open', { index: current })
        return
      // Return renames, as in Finder (Space opens).
      case 'Enter':
        e.preventDefault()
        if (current >= 0 && getState().selection.size <= 1) startRename(current)
        return
      default: return
    }
    e.preventDefault()
    select(next, e.shiftKey)
  })

  // ─── Rename in place ──────────────────────────────────────────────────────
  let editing: { input: HTMLInputElement } | null = null
  on('rename:start', () => {
    const index = selectedIndex()
    if (index >= 0) startRename(index)
  })

  /** Return or "Rename": the name becomes a field. Return or a click elsewhere saves, Esc cancels.
   *  The name without its extension is selected first, as in Finder. */
  function startRename(index: number): void {
    if (editing) return
    const entry = entries[index]
    if (!entry) return
    ensureVisible(index)
    render()
    const cell = indexToCell.get(index)
    if (!cell) return

    const input = document.createElement('input')
    input.className = 'viewer-rename'
    input.value = entry.name
    input.spellcheck = false
    cell.label.hidden = true
    cell.root.appendChild(input)
    editing = { input }
    input.focus()
    const dot = entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)

    let finished = false
    const finish = async (save: boolean): Promise<void> => {
      if (finished) return
      finished = true
      const name = input.value.trim()
      input.remove()
      cell.label.hidden = false
      editing = null
      if (!save || !name || name === entry.name) return
      try {
        const newPath = await window.viewer.fs.rename(entry.path, name)
        selectPath(newPath)
        emit('folder:refresh', undefined)
      } catch (err) {
        emit('toast', { text: `Rename failed: ${String(err)}` })
      }
    }
    // Keys stay in the field: the grid and the big view must not react while you type.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); void finish(true) }
      else if (e.key === 'Escape') { e.preventDefault(); void finish(false) }
    })
    input.addEventListener('blur', () => void finish(true))
    for (const type of ['mousedown', 'click', 'dblclick'] as const) {
      input.addEventListener(type, (e) => e.stopPropagation())
    }
  }

  // ─── Drag out ─────────────────────────────────────────────────────────────
  // The selected files (or the pressed one) go out as a Mac file drag, into Finder, browsers and
  // chats. The page's own drag stays off: it shares the Mac's drag clipboard and would wipe the
  // files when it starts after Kadar's drag.
  let pressed: { cell: CellHandle; x: number; y: number } | null = null
  window.addEventListener('mouseup', () => { pressed = null })
  window.addEventListener('mousemove', (e) => {
    if (!pressed) return
    if ((e.buttons & 1) === 0) { pressed = null; return }
    if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 5) return
    const { cell } = pressed
    pressed = null
    const entry = cell.entry
    if (!entry) return
    if (!getState().selection.has(entry.path)) selectOnly(cell.index)
    const icon = loader.getCached(entry.path) ?? (entry.kind === 'image' ? entry.path : '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericFolderIcon.icns')
    if (icon) void window.viewer.share.startDrag(selectedPaths(), icon).catch(() => {})
  })

  function recycleCell(): CellHandle {
    const cell = createCell()
    cellPool.push(cell)
    canvas.appendChild(cell.root)
    // Shift+click and double-click must not start a text selection or move the keyboard focus.
    cell.root.addEventListener('mousedown', (e) => {
      if (e.shiftKey || e.metaKey || e.detail > 1) e.preventDefault()
      // A possible drag out starts here; it begins once the mouse moves a few pixels.
      if (e.button === 0 && !e.shiftKey && !e.metaKey && cell.entry && !editing) {
        pressed = { cell, x: e.clientX, y: e.clientY }
      }
    })
    cell.root.addEventListener('click', (e) => handleClick(e, cell))
    cell.root.addEventListener('dblclick', () => {
      if (!cell.entry) return
      if (cell.entry.kind === 'folder') emit('folder:request', { path: cell.entry.path })
      else emit('lightbox:open', { index: cell.index })
    })
    cell.root.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (!cell.entry) return
      if (!getState().selection.has(cell.entry.path)) selectOnly(cell.index)
      void showContextMenu(e.clientX, e.clientY)
    })
    return cell
  }

  function handleClick(e: MouseEvent, cell: CellHandle): void {
    if (!cell.entry) return
    // As in Finder: click selects, Cmd+click adds or removes, Shift+click selects a range,
    // double-click opens. Right-click opens the file menu.
    if (e.metaKey) toggle(cell.index)
    else if (e.shiftKey) extendTo(cell.index)
    else selectOnly(cell.index)
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
      if (entry.kind !== 'folder' && !loader.getCached(entry.path)) toRequest.push(entry)
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
      // Same folder (files changed or new sort): keep the same image at the top.
      const sameFolder = s.currentFolder === prev.currentFolder
      const keepPath = sameFolder ? entries[topIndex]?.path : undefined
      entries = s.entries
      if (!sameFolder) loader.reset()
      topIndex = keepPath ? Math.max(0, entries.findIndex((e) => e.path === keepPath)) : 0
      canvas.style.height = `${totalHeight(entries.length, layout)}px`
      scrollToTop()
      fullRerender()
    }
    if (s.selectedPath !== prev.selectedPath || s.selection !== prev.selection) {
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
