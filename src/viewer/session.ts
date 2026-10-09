// The viewer's last state, kept between launches: folder, place in the grid, selected image,
// open big view, open sidebar folders and sort order. Stored in localStorage; every read and
// write is guarded, so the viewer still works when storage is not available.

import { SORT_LABELS, type SortBy } from './sort'

/** What the viewer restores at launch. */
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
  /** Name filter of the current folder; cleared when you open another folder. */
  filter: string
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
  filter: '',
}

/** Saved data → a session. Every value of the wrong type (an older version, a damaged save)
 *  falls back to its default, so the viewer never starts with a value it cannot use. */
export function sanitize(saved: unknown): ViewerSession {
  const out: ViewerSession = { ...empty, selectedPaths: [], expanded: [] }
  if (typeof saved !== 'object' || saved === null) return out
  const s = saved as Record<string, unknown>
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  out.folder = text(s['folder'])
  out.topPath = text(s['topPath'])
  out.topIndex = typeof s['topIndex'] === 'number' && Number.isInteger(s['topIndex']) && s['topIndex'] >= 0 ? s['topIndex'] : 0
  out.selectedPath = text(s['selectedPath'])
  out.selectedPaths = texts(s['selectedPaths'])
  out.anchorPath = text(s['anchorPath'])
  out.bigView = s['bigView'] === true
  out.expanded = texts(s['expanded'])
  if (typeof s['sortBy'] === 'string' && s['sortBy'] in SORT_LABELS) out.sortBy = s['sortBy'] as SortBy
  out.sortDescending = s['sortDescending'] === true
  out.filter = typeof s['filter'] === 'string' ? s['filter'] : ''
  return out
}

function load(): ViewerSession {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return sanitize(JSON.parse(raw))
  } catch { /* storage blocked or bad JSON: start fresh */ }
  return sanitize(null)
}

const session = load()
let timer: ReturnType<typeof setTimeout> | null = null

/** The live session, read from storage once when this file loads. Change it with updateSession. */
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
