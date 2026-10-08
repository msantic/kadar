import type { FileEntry, FolderEntry, Favorite } from './types'

export interface ViewerState {
  currentFolder: string | null
  entries: FileEntry[]
  folders: FolderEntry[]
  truncated: boolean
  favorites: Favorite[]
  lightboxIndex: number | null
  /** Image with the highlight: the last one opened. Kept by path, so it survives a reload. */
  selectedPath: string | null
  loading: boolean
}

type Listener = (state: ViewerState, prev: ViewerState) => void

const state: ViewerState = {
  currentFolder: null,
  entries: [],
  folders: [],
  truncated: false,
  favorites: [],
  lightboxIndex: null,
  selectedPath: null,
  loading: false,
}

const listeners = new Set<Listener>()

export function getState(): ViewerState {
  return state
}

export function setState(patch: Partial<ViewerState>): void {
  const prev = { ...state }
  Object.assign(state, patch)
  for (const l of listeners) l(state, prev)
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
