// The viewer's last state, kept between launches: folder, place in the grid, selected image,
// open big view, open sidebar folders and sort order. Stored in localStorage; every read and
// write is guarded, so the viewer still works when storage is not available.

import type { SortBy } from './sort'

export interface ViewerSession {
  /** Folder shown in the grid. */
  folder: string | null
  /** First image in the top grid row; the grid scrolls back to it. Path first, index as fallback. */
  topPath: string | null
  topIndex: number
  /** Focused file, every selected file, and where a Shift range starts. */
  selectedPath: string | null
  selectedPaths: string[]
  anchorPath: string | null
  /** True when the big view was open on the selected image. */
  bigView: boolean
  /** Sidebar folders that were expanded. */
  expanded: string[]
  /** Sort order of the grid, the same for every folder. */
  sortBy: SortBy
  sortDescending: boolean
}

const KEY = 'kadar:viewer-session'
const SAVE_DELAY_MS = 250

const empty: ViewerSession = {
  folder: null,
  topPath: null,
  topIndex: 0,
  selectedPath: null,
  selectedPaths: [],
  anchorPath: null,
  bigView: false,
  expanded: [],
  sortBy: 'name',
  sortDescending: false,
}

function load(): ViewerSession {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...empty, ...(JSON.parse(raw) as Partial<ViewerSession>) }
  } catch { /* storage blocked or bad JSON: start fresh */ }
  return { ...empty }
}

const session = load()
let timer: ReturnType<typeof setTimeout> | null = null

export function getSession(): Readonly<ViewerSession> {
  return session
}

/** Updates the session and writes it shortly after; fast changes (scrolling) write once. */
export function updateSession(patch: Partial<ViewerSession>): void {
  Object.assign(session, patch)
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flush, SAVE_DELAY_MS)
}

function flush(): void {
  timer = null
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch { /* storage full or blocked: nothing to do */ }
}

// Write any waiting change when the window closes.
window.addEventListener('pagehide', () => {
  if (timer !== null) {
    clearTimeout(timer)
    flush()
  }
})
