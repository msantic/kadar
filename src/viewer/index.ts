import { api } from './ipc'
import { emit, on } from './bus'
import { getSession, updateSession } from './session'
import { restoreSelection, selectedPaths } from './selection'
import { defaultDescending, SORT_LABELS, sortEntries, type SortBy } from './sort'
import type { FileEntry } from './types'
import { getState, setState, subscribe } from './store'
import { createSidebar } from './sidebar/sidebar'
import { createGrid } from './grid/grid'
import { createLightbox } from './lightbox/lightbox'
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from './grid/grid-layout'

let initialized = false

export async function initViewer(): Promise<void> {
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
    resort()
  })
  sortDirBtn.addEventListener('click', () => {
    updateSession({ sortDescending: !getSession().sortDescending })
    drawSortDir()
    resort()
  })

  // Web copies of the selected files, with the Optimize tab's settings.
  const optimizeBtn = document.createElement('button')
  optimizeBtn.className = 'viewer-ghost-btn viewer-optimize-btn'
  optimizeBtn.title = 'Make web copies in an "optimized" folder, with the Optimize tab settings'
  optimizeBtn.hidden = true
  let optimizing = false
  optimizeBtn.addEventListener('click', async () => {
    const paths = selectedPaths()
    if (paths.length === 0 || optimizing) return
    optimizing = true
    optimizeBtn.disabled = true
    emit('toast', { text: `Optimizing ${paths.length} ${paths.length === 1 ? 'file' : 'files'}…` })
    try {
      const n = await window.viewer.share.optimize(paths)
      emit('toast', { text: `Optimized ${n} ${n === 1 ? 'file' : 'files'} → "optimized" folder` })
    } catch (err) {
      emit('toast', { text: `Optimize failed: ${String(err)}` })
    } finally {
      optimizing = false
      optimizeBtn.disabled = false
    }
  })
  subscribe((s, prev) => {
    if (s.selection === prev.selection && s.selectedPath === prev.selectedPath) return
    const n = selectedPaths().length
    optimizeBtn.hidden = n === 0
    optimizeBtn.textContent = n > 1 ? `Optimize ${n}` : 'Optimize'
  })

  toolbar.append(openBtn, pathEl, countEl, optimizeBtn, sortSelect, sortDirBtn, sizeControl)

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
    updateSession({ folder: path, topPath: null, topIndex: 0, selectedPath: null, selectedPaths: [], anchorPath: null, bigView: false })
    void loadFolder(path)
  })

  // Back to where you were: folder, top of the grid, selected image, open big view.
  // Copy the session first: loading a folder closes the big view, which updates the session.
  const last = { ...getSession() }
  if (last.folder) {
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

  const sorted = (list: FileEntry[]): FileEntry[] =>
    sortEntries(list, getSession().sortBy, getSession().sortDescending)

  /** New sort order: keep the selected image (or the top one) in view. */
  function resort(): void {
    const { entries, selectedPath } = getState()
    if (entries.length === 0) return
    const keep = selectedPath ?? getSession().topPath
    const next = sorted(entries)
    setState({ entries: next })
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
    setState({
      entries: sorted(listing.files),
      folders: listing.folders,
      truncated: listing.truncated,
      loading: false,
    })
    showCount(listing.files.length, listing.truncated)
    void api.fs.watch(dirPath)
  }

  function showCount(n: number, truncated: boolean): void {
    const selected = getState().selection.size
    countEl.textContent = `${n} ${n === 1 ? 'item' : 'items'}${truncated ? ' (truncated)' : ''}`
      + (selected > 1 ? `  ·  ${selected} selected` : '')
  }
  subscribe((s, prev) => {
    if (s.selection !== prev.selection && !s.loading) showCount(s.entries.length, s.truncated)
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

  async function refresh(dirPath: string): Promise<void> {
    const listing = await api.fs.listFolder(dirPath)
    const state = getState()
    if (state.currentFolder !== dirPath) return
    // Nothing changed that the grid shows: skip, so the view does not redraw for nothing.
    const old = new Map(state.entries.map((e) => [e.path, e]))
    const same = listing.files.length === state.entries.length
      && listing.files.every((f) => old.get(f.path)?.mtimeMs === f.mtimeMs && old.get(f.path)?.size === f.size)
    if (same) return

    const next = sorted(listing.files)
    // Selected files may be gone; the open big view follows its image to its new place.
    setState({ entries: next, folders: listing.folders, truncated: listing.truncated })
    restoreSelection([...state.selection], state.selectedPath, state.anchorPath)
    const selected = getState().selectedPath
    const bigViewIndex = state.lightboxIndex !== null && selected ? next.findIndex((e) => e.path === selected) : null
    if (state.lightboxIndex !== null) {
      if (bigViewIndex !== null && bigViewIndex >= 0) setState({ lightboxIndex: bigViewIndex })
      else emit('lightbox:close', undefined)
    }
    showCount(listing.files.length, listing.truncated)
  }
}
