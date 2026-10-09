import { api } from './ipc'
import { emit, on } from './bus'
import { getSession, updateSession } from './session'
import { restoreSelection } from './selection'
import { defaultDescending, SORT_LABELS, sortEntries, type SortBy } from './sort'
import type { FileEntry } from './types'
import { filterEntries } from './filter'
import { getState, setState, subscribe } from './store'
import { createSidebar } from './sidebar/sidebar'
import { createGrid } from './grid/grid'
import { createLightbox } from './lightbox/lightbox'
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from './grid/grid-layout'

let initialized = false

/** A file or folder that Finder asked Kadar to open. */
export interface OpenItem {
  path: string
  isDir: boolean
}

let openInViewer: ((items: OpenItem[]) => Promise<void>) | null = null

/** Shows files opened from Finder: their folder, selected, the first one in the big view. */
export function openItems(items: OpenItem[]): void {
  void openInViewer?.(items)
}

/** Starts the viewer. With `open`, it shows those files instead of the last session. */
export async function initViewer(open: OpenItem[] = []): Promise<void> {
  if (initialized) return
  initialized = true

  const panel = document.getElementById('panel-viewer')
  if (!panel) throw new Error('panel-viewer not found')

  const layout = document.createElement('div')
  layout.className = 'viewer-layout'

  const sidebar = createSidebar()
  const main = document.createElement('div')
  main.className = 'viewer-main'

  const toolbar = document.createElement('div')
  toolbar.className = 'viewer-toolbar'
  const pathEl = document.createElement('span')
  pathEl.className = 'viewer-path'
  pathEl.textContent = 'No folder selected'
  const openBtn = document.createElement('button')
  openBtn.className = 'viewer-ghost-btn'
  openBtn.textContent = 'Open Folder…'
  openBtn.addEventListener('click', async () => {
    const p = await api.fs.chooseFolder()
    if (p) loadFolder(p)
  })
  const countEl = document.createElement('span')
  countEl.className = 'viewer-count'

  // Thumbnail size slider
  const sizeControl = document.createElement('div')
  sizeControl.className = 'viewer-size-control'

  const sizeSmall = document.createElement('span')
  sizeSmall.className = 'viewer-size-icon'
  sizeSmall.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="0" width="7" height="7" rx="1.5"/><rect x="9" y="0" width="7" height="7" rx="1.5"/><rect x="0" y="9" width="7" height="7" rx="1.5"/><rect x="9" y="9" width="7" height="7" rx="1.5"/></svg>'

  const sizeSlider = document.createElement('input')
  sizeSlider.type = 'range'
  sizeSlider.className = 'viewer-size-slider'
  sizeSlider.min = String(ZOOM_MIN)
  sizeSlider.max = String(ZOOM_MAX)
  const saved = localStorage.getItem('persist:viewer-thumb-size')
  sizeSlider.value = saved ?? String(ZOOM_DEFAULT)

  const sizeLarge = document.createElement('span')
  sizeLarge.className = 'viewer-size-icon'
  sizeLarge.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="0" y="0" width="16" height="16" rx="2"/></svg>'

  sizeControl.append(sizeSmall, sizeSlider, sizeLarge)

  // Sort: what to sort by, and a button for the direction.
  const sortSelect = document.createElement('select')
  sortSelect.className = 'viewer-sort'
  sortSelect.title = 'Sort by'
  for (const [value, label] of Object.entries(SORT_LABELS)) sortSelect.append(new Option(label, value))
  sortSelect.value = getSession().sortBy
  const sortDirBtn = document.createElement('button')
  sortDirBtn.className = 'viewer-ghost-btn viewer-sort-dir'
  const drawSortDir = (): void => {
    const desc = getSession().sortDescending
    sortDirBtn.textContent = desc ? '↓' : '↑'
    sortDirBtn.title = desc ? 'Descending — click for ascending' : 'Ascending — click for descending'
  }
  drawSortDir()
  sortSelect.addEventListener('change', () => {
    const by = sortSelect.value as SortBy
    updateSession({ sortBy: by, sortDescending: defaultDescending(by) })
    drawSortDir()
    void resort()
  })
  sortDirBtn.addEventListener('click', () => {
    updateSession({ sortDescending: !getSession().sortDescending })
    drawSortDir()
    void resort()
  })

  // Name filter: shows only files whose names contain the typed words. Cmd+F jumps here,
  // Esc clears it. Kept between launches; opening another folder clears it.
  const filterInput = document.createElement('input')
  filterInput.type = 'search'
  filterInput.className = 'viewer-filter'
  filterInput.placeholder = 'Filter'
  filterInput.spellcheck = false
  filterInput.value = getSession().filter
  let filterTimer: ReturnType<typeof setTimeout> | null = null
  filterInput.addEventListener('input', () => {
    if (filterTimer !== null) clearTimeout(filterTimer)
    filterTimer = setTimeout(() => {
      updateSession({ filter: filterInput.value })
      void resort()
    }, 80)
  })
  filterInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (filterInput.value) {
        filterInput.value = ''
        updateSession({ filter: '' })
        void resort()
      }
      filterInput.blur()
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // Back to the grid, so the arrow keys move the selection again.
      e.preventDefault()
      filterInput.blur()
    }
  })
  window.addEventListener('keydown', (e) => {
    if (e.metaKey && e.key.toLowerCase() === 'f' && main.offsetParent !== null && getState().lightboxIndex === null) {
      e.preventDefault()
      filterInput.focus()
      filterInput.select()
    }
  })

  toolbar.append(openBtn, pathEl, countEl, filterInput, sortSelect, sortDirBtn, sizeControl)

  const grid = createGrid()
  const lightbox = createLightbox()

  // Apply saved size on init
  if (saved) grid.setZoom(parseInt(saved, 10))

  sizeSlider.addEventListener('input', () => {
    const val = parseInt(sizeSlider.value, 10)
    grid.setZoom(val)
    localStorage.setItem('persist:viewer-thumb-size', String(val))
  })

  main.append(toolbar, grid.root)
  layout.append(sidebar, main)
  panel.append(layout, lightbox.root)

  on('folder:request', ({ path }) => {
    if (getState().currentFolder === path) return
    updateSession({ folder: path, topPath: null, topIndex: 0, selectedPath: null, selectedPaths: [], anchorPath: null, bigView: false, filter: '' })
    filterInput.value = ''
    void loadFolder(path)
  })

  // Back to where you were: folder, top of the grid, selected image, open big view.
  // Copy the session first: loading a folder closes the big view, which updates the session.
  openInViewer = async (items) => {
    const first = items[0]
    if (!first) return
    if (first.isDir) {
      emit('folder:request', { path: first.path })
      return
    }
    const folder = first.path.slice(0, first.path.lastIndexOf('/')) || '/'
    if (getState().currentFolder !== folder) {
      updateSession({ folder, topPath: null, topIndex: 0, selectedPath: null, selectedPaths: [], anchorPath: null, bigView: false, filter: '' })
      filterInput.value = ''
      await loadFolder(folder)
    }
    if (getState().currentFolder !== folder) return
    // The opened file must be visible: clear a filter that hides it.
    if (getSession().filter && !getState().entries.some((e) => e.path === first.path)) {
      filterInput.value = ''
      updateSession({ filter: '' })
      await resort()
    }
    const index = getState().entries.findIndex((e) => e.path === first.path)
    restoreSelection(items.filter((i) => !i.isDir).map((i) => i.path), first.path, first.path)
    if (index < 0) return
    grid.scrollToIndex(index)
    emit('lightbox:open', { index })
  }

  const last = { ...getSession() }
  if (open.length > 0) {
    void openInViewer(open)
  } else if (last.folder) {
    void loadFolder(last.folder).then(() => {
      // Skip if you already picked another folder while this one loaded.
      if (getState().currentFolder !== last.folder) return
      const { entries } = getState()
      const byPath = last.topPath ? entries.findIndex((e) => e.path === last.topPath) : -1
      grid.scrollToIndex(byPath >= 0 ? byPath : Math.min(last.topIndex, entries.length - 1))
      restoreSelection(last.selectedPaths, last.selectedPath, last.anchorPath)
      const selected = last.selectedPath ? entries.findIndex((e) => e.path === last.selectedPath) : -1
      if (selected >= 0 && last.bigView) emit('lightbox:open', { index: selected })
    })
  }

  // Every file of the folder, before the name filter; the grid shows `view()` of it.
  let allFiles: FileEntry[] = []
  const view = (): FileEntry[] =>
    filterEntries(sortEntries(allFiles, getSession().sortBy, getSession().sortDescending), getSession().filter)

  /** Camera dates are read only when "Date Taken" sorts the grid; later reads come from a cache. */
  async function ensureTaken(list: FileEntry[]): Promise<void> {
    if (getSession().sortBy !== 'taken') return
    const missing = list.filter((e) => e.takenMs === undefined)
    if (missing.length === 0) return
    const dates = await api.fs.takenDates(missing.map((e) => ({ path: e.path, mtimeMs: e.mtimeMs })))
    missing.forEach((e, i) => { e.takenMs = dates[i] ?? null })
  }

  /** New sort order or filter: keep the selected image (or the top one) in view. */
  async function resort(): Promise<void> {
    const { selectedPath } = getState()
    if (allFiles.length === 0) return
    if (getSession().sortBy === 'taken' && allFiles.some((e) => e.takenMs === undefined)) {
      countEl.textContent = 'Reading camera dates…'
      const folder = getState().currentFolder
      await ensureTaken(allFiles)
      if (getState().currentFolder !== folder) return
    }
    const keep = selectedPath ?? getSession().topPath
    const next = view()
    setState({ entries: next })
    showCount()
    const index = keep ? next.findIndex((e) => e.path === keep) : -1
    if (index >= 0) {
      grid.scrollToIndex(index)
      updateSession({ topIndex: index, topPath: next[index]!.path })
    }
  }

  async function loadFolder(dirPath: string): Promise<void> {
    setState({
      currentFolder: dirPath, entries: [], folders: [], truncated: false, loading: true,
      selectedPath: null, selection: new Set(), anchorPath: null,
    })
    pathEl.textContent = dirPath
    countEl.textContent = 'Loading…'
    const listing = await api.fs.listFolder(dirPath)
    if (getState().currentFolder !== dirPath) return
    await ensureTaken(listing.files)
    if (getState().currentFolder !== dirPath) return
    allFiles = listing.files
    setState({
      entries: view(),
      folders: listing.folders,
      truncated: listing.truncated,
      loading: false,
    })
    showCount()
    void api.fs.watch(dirPath)
  }

  function showCount(): void {
    const { entries, selection, truncated } = getState()
    const total = allFiles.length
    const shown = entries.length === total ? `${total}` : `${entries.length} of ${total}`
    countEl.textContent = `${shown} ${total === 1 ? 'item' : 'items'}${truncated ? ' (truncated)' : ''}`
      + (selection.size > 1 ? `  ·  ${selection.size} selected` : '')
  }
  subscribe((s, prev) => {
    if (s.selection !== prev.selection && !s.loading) showCount()
  })

  // Short confirmation after a copy, above everything, also over the big view.
  const toast = document.createElement('div')
  toast.className = 'viewer-toast'
  toast.hidden = true
  document.body.appendChild(toast)
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  on('toast', ({ text }) => {
    toast.textContent = text
    toast.hidden = false
    if (toastTimer !== null) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.hidden = true }, 1600)
  })

  // Live folder: files added, removed or changed show up without reopening the folder.
  api.fs.onChanged(({ dirPath }) => {
    if (dirPath === getState().currentFolder) void refresh(dirPath)
  })
  on('folder:refresh', () => {
    const folder = getState().currentFolder
    if (folder) void refresh(folder)
  })

  async function refresh(dirPath: string): Promise<void> {
    const listing = await api.fs.listFolder(dirPath)
    const state = getState()
    if (state.currentFolder !== dirPath) return
    // Nothing changed that the grid shows: skip, so the view does not redraw for nothing.
    const old = new Map(allFiles.map((e) => [e.path, e]))
    const same = listing.files.length === allFiles.length
      && listing.files.every((f) => old.get(f.path)?.mtimeMs === f.mtimeMs && old.get(f.path)?.size === f.size)
    if (same) return

    await ensureTaken(listing.files)
    if (getState().currentFolder !== dirPath) return
    allFiles = listing.files
    const next = view()
    // Selected files may be gone; the open big view follows its image to its new place.
    setState({ entries: next, folders: listing.folders, truncated: listing.truncated })
    restoreSelection([...state.selection], state.selectedPath, state.anchorPath)
    const selected = getState().selectedPath
    const bigViewIndex = state.lightboxIndex !== null && selected ? next.findIndex((e) => e.path === selected) : null
    if (state.lightboxIndex !== null) {
      if (bigViewIndex !== null && bigViewIndex >= 0) setState({ lightboxIndex: bigViewIndex })
      else emit('lightbox:close', undefined)
    }
    showCount()
  }
}
