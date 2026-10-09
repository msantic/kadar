import { api } from './ipc'
import { emit, on } from './bus'
import { getSession, updateSession } from './session'
import {
  copySelection, openSelectionDefault, optimizeSelection, restoreSelection, selectedPaths, selectOnly, trashSelection,
} from './selection'
import { createExport } from './export/export'
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
  // The folder path: each part opens that folder. The end stays visible on long paths.
  const pathEl = document.createElement('div')
  pathEl.className = 'viewer-path'
  pathEl.textContent = 'No folder selected'
  function drawPath(dir: string): void {
    const parts = dir.split('/').filter(Boolean)
    const nodes: Node[] = []
    parts.forEach((name, i) => {
      if (i > 0) nodes.push(Object.assign(document.createElement('span'), { className: 'viewer-path-sep', textContent: '›' }))
      const btn = document.createElement('button')
      btn.className = 'viewer-path-part'
      btn.textContent = name
      const target = `/${parts.slice(0, i + 1).join('/')}`
      btn.title = target
      btn.addEventListener('click', () => emit('folder:request', { path: target }))
      nodes.push(btn)
    })
    pathEl.replaceChildren(...nodes)
    showPathEnd()
  }
  const showPathEnd = (): void => { requestAnimationFrame(() => { pathEl.scrollLeft = pathEl.scrollWidth }) }
  new ResizeObserver(showPathEnd).observe(pathEl)
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

  // Pinch on the trackpad (or ⌘-scroll) in the grid changes the thumbnail size, as in Photos.
  // The Mac sends a pinch as a scroll with Control held. One layout per frame at most.
  let pinchSize: number | null = null
  grid.root.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const from = pinchSize ?? Number(sizeSlider.value)
    const firstInFrame = pinchSize === null
    pinchSize = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, from * Math.exp(-e.deltaY * 0.01)))
    if (!firstInFrame) return
    requestAnimationFrame(() => {
      if (pinchSize === null) return
      sizeSlider.value = String(Math.round(pinchSize))
      pinchSize = null
      sizeSlider.dispatchEvent(new Event('input'))
    })
  }, { passive: false })

  main.append(toolbar, grid.root)
  layout.append(sidebar, main)
  panel.append(layout, lightbox.root, createExport())

  // Folder history for Back and Forward (⌘[ and ⌘]), as in Finder.
  const backStack: string[] = []
  const forwardStack: string[] = []

  /** Opens a folder. `select` picks a file or subfolder in it, for example the one you came from. */
  async function openFolder(path: string, select?: string): Promise<void> {
    updateSession({ folder: path, topPath: null, topIndex: 0, selectedPath: null, selectedPaths: [], anchorPath: null, bigView: false, filter: '' })
    filterInput.value = ''
    await loadFolder(path)
    if (!select || getState().currentFolder !== path) return
    const index = getState().entries.findIndex((e) => e.path === select)
    if (index >= 0) {
      selectOnly(index)
      grid.scrollToIndex(index)
    }
  }

  on('folder:request', ({ path }) => {
    const current = getState().currentFolder
    if (current === path) return
    if (current) backStack.push(current)
    forwardStack.length = 0
    void openFolder(path)
  })

  on('folder:go', ({ to }) => {
    const current = getState().currentFolder
    if (!current) return
    if (to === 'up') {
      const parent = current.slice(0, current.lastIndexOf('/')) || '/'
      if (parent === current) return
      backStack.push(current)
      forwardStack.length = 0
      void openFolder(parent, current)
    } else if (to === 'back' && backStack.length > 0) {
      forwardStack.push(current)
      void openFolder(backStack.pop()!, current)
    } else if (to === 'forward' && forwardStack.length > 0) {
      backStack.push(current)
      void openFolder(forwardStack.pop()!)
    }
  })

  // ⌘↑ parent folder, ⌘[ back, ⌘] forward, while the grid is in front.
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.defaultPrevented || main.offsetParent === null || getState().lightboxIndex !== null) return
    const t = e.target as HTMLElement | null
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
    const to = e.key === 'ArrowUp' ? 'up' : e.key === '[' ? 'back' : e.key === ']' ? 'forward' : null
    if (!to) return
    e.preventDefault()
    emit('folder:go', { to })
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

  // Every file and subfolder, before the name filter; the grid shows `view()` of them:
  // subfolders first (by name), then the files in the chosen order.
  let allFiles: FileEntry[] = []
  let allFolders: FileEntry[] = []
  const view = (): FileEntry[] => {
    const { sortBy, sortDescending, filter } = getSession()
    return [
      ...filterEntries(sortEntries(allFolders, 'name', false), filter),
      ...filterEntries(sortEntries(allFiles, sortBy, sortDescending), filter),
    ]
  }
  const folderTiles = (folders: { name: string; path: string }[]): FileEntry[] =>
    folders.map((f) => ({ name: f.name, path: f.path, ext: '', kind: 'folder', size: 0, mtimeMs: 0, createdMs: 0 }))

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
    drawPath(dirPath)
    countEl.textContent = 'Loading…'
    const listing = await api.fs.listFolder(dirPath)
    if (getState().currentFolder !== dirPath) return
    await ensureTaken(listing.files)
    if (getState().currentFolder !== dirPath) return
    allFiles = listing.files
    allFolders = folderTiles(listing.folders)
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
    const files = entries.filter((e) => e.kind !== 'folder').length
    const shown = files === total ? `${total}` : `${files} of ${total}`
    const folders = allFolders.length > 0 ? `${allFolders.length} ${allFolders.length === 1 ? 'folder' : 'folders'}, ` : ''
    countEl.textContent = `${folders}${shown} ${total === 1 ? 'item' : 'items'}${truncated ? ' (truncated)' : ''}`
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
  on('toast', ({ text, action }) => {
    toast.replaceChildren(document.createTextNode(text))
    if (action) {
      const btn = document.createElement('button')
      btn.className = 'viewer-toast-action'
      btn.textContent = action.label
      btn.addEventListener('click', () => {
        action.run()
        toast.hidden = true
      })
      toast.append(btn)
    }
    toast.hidden = false
    if (toastTimer !== null) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.hidden = true }, action ? 5000 : 1600)
  })

  // Menu bar items (the keys mostly arrive directly; the menu also works with a click).
  on('menu', ({ id }) => {
    const { entries, selectedPath, lightboxIndex } = getState()
    const focus = selectedPath ?? selectedPaths()[0] ?? null
    const focusEntry = entries.find((e) => e.path === focus)
    if (id.startsWith('go:')) {
      emit('folder:go', { to: id.slice(3) as 'up' | 'back' | 'forward' })
      return
    }
    if (id.startsWith('sort:')) {
      if (id === 'sort:reverse') sortDirBtn.click()
      else { sortSelect.value = id.slice(5); sortSelect.dispatchEvent(new Event('change')) }
      return
    }
    switch (id) {
      case 'open-folder': openBtn.click(); break
      case 'open-default': openSelectionDefault(); break
      case 'reveal': if (focus) void api.fs.revealInFinder(focus); break
      case 'export': if (focusEntry?.kind === 'image') emit('export:open', { path: focusEntry.path }); break
      case 'optimize': void optimizeSelection(); break
      case 'rename': emit('rename:start', undefined); break
      case 'trash': void trashSelection(); break
      case 'copy-paths': void copySelection(true); break
      case 'filter': filterInput.focus(); filterInput.select(); break
      case 'zoom-in':
      case 'zoom-out': {
        const step = id === 'zoom-in' ? 40 : -40
        sizeSlider.value = String(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(sizeSlider.value) + step)))
        sizeSlider.dispatchEvent(new Event('input'))
        break
      }
      case 'info':
        if (lightboxIndex !== null) emit('info:toggle', undefined)
        else if (focusEntry) {
          emit('info:show', undefined)
          emit('lightbox:open', { index: entries.indexOf(focusEntry) })
        }
        break
    }
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
    const folderKey = (list: { path: string }[]): string => list.map((f) => f.path).sort().join('\n')
    const sameFolders = folderKey(listing.folders) === folderKey(allFolders)
    const same = sameFolders && listing.files.length === allFiles.length
      && listing.files.every((f) => old.get(f.path)?.mtimeMs === f.mtimeMs && old.get(f.path)?.size === f.size)
    if (same) return

    await ensureTaken(listing.files)
    if (getState().currentFolder !== dirPath) return
    allFiles = listing.files
    allFolders = folderTiles(listing.folders)
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
