import { api } from './ipc'
import { emit, on } from './bus'
import { getSession, updateSession } from './session'
import { getState, setState } from './store'
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

  toolbar.append(openBtn, pathEl, countEl, sizeControl)

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
    updateSession({ folder: path, topPath: null, topIndex: 0, selectedPath: null, bigView: false })
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
      const selected = last.selectedPath ? entries.findIndex((e) => e.path === last.selectedPath) : -1
      if (selected < 0) return
      setState({ selectedPath: last.selectedPath })
      updateSession({ selectedPath: last.selectedPath })
      if (last.bigView) emit('lightbox:open', { index: selected })
    })
  }

  async function loadFolder(dirPath: string): Promise<void> {
    setState({ currentFolder: dirPath, entries: [], folders: [], truncated: false, loading: true, selectedPath: null })
    pathEl.textContent = dirPath
    countEl.textContent = 'Loading…'
    const listing = await api.fs.listFolder(dirPath)
    if (getState().currentFolder !== dirPath) return
    setState({
      entries: listing.files,
      folders: listing.folders,
      truncated: listing.truncated,
      loading: false,
    })
    const n = listing.files.length
    countEl.textContent = `${n} ${n === 1 ? 'item' : 'items'}${listing.truncated ? ' (truncated)' : ''}`
  }
}
