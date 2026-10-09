// The viewer's shared state: open folder, its files, favorites, selection, big view.
// One object for the whole window; parts read it with getState and react with subscribe.

import type { FileEntry, FolderEntry, Favorite } from './types'

/** Everything the viewer parts share. Change it only with setState, so listeners hear it. */
export interface ViewerState {
  currentFolder: string | null
  entries: FileEntry[]
  folders: FolderEntry[]
  truncated: boolean
  favorites: Favorite[]
  lightboxIndex: number | null
  /** Focused file: arrow keys and the big view start here. Kept by path, so it survives a reload. */
  selectedPath: string | null
  /** Every selected file (Cmd+click, Shift+click, Cmd+A). */
  selection: ReadonlySet<string>
  /** Where a Shift range starts. */
  anchorPath: string | null
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
  selection: new Set(),
  anchorPath: null,
  loading: false,
}

const listeners = new Set<Listener>()

/** The live state object, not a copy. Do not change it directly. */
export function getState(): ViewerState {
  return state
}

/** Merges `patch` into the state and calls every listener at once, even if nothing changed. */
export function setState(patch: Partial<ViewerState>): void {
  const prev = { ...state }
  Object.assign(state, patch)
  for (const l of listeners) l(state, prev)
}

/** Calls `listener` with the new and the old state after each setState. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
