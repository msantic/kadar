// Finder-style selection. `selection` is every selected file; `selectedPath` is the focused one
// (the arrow keys and the big view start there); `anchorPath` is where a Shift range starts.
// Every change is kept in the session, so the selection survives a restart.

import { emit } from './bus'
import { getState, setState } from './store'
import { updateSession } from './session'

function commit(selection: Set<string>, focus: string | null, anchor: string | null): void {
  setState({ selection, selectedPath: focus, anchorPath: anchor })
  updateSession({ selectedPaths: [...selection], selectedPath: focus, anchorPath: anchor })
}

function pathAt(index: number): string | null {
  return getState().entries[index]?.path ?? null
}

/** One file by path, for example after a rename. */
export function selectPath(path: string): void {
  commit(new Set([path]), path, path)
}

/** Click or arrow key: this file only. */
export function selectOnly(index: number): void {
  const path = pathAt(index)
  if (path) commit(new Set([path]), path, path)
}

/** Cmd+click: add or remove this file; the others stay. */
export function toggle(index: number): void {
  const path = pathAt(index)
  if (!path) return
  const next = new Set(getState().selection)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  commit(next, path, path)
}

/** Shift+click or Shift+arrow: everything from the anchor to this file. */
export function extendTo(index: number): void {
  const { entries, anchorPath, selectedPath } = getState()
  const path = pathAt(index)
  if (!path) return
  const anchor = anchorPath ?? selectedPath ?? path
  const from = Math.max(0, entries.findIndex((e) => e.path === anchor))
  const [lo, hi] = from <= index ? [from, index] : [index, from]
  commit(new Set(entries.slice(lo, hi + 1).map((e) => e.path)), path, anchor)
}

export function selectAll(): void {
  const { entries, selectedPath, anchorPath } = getState()
  if (entries.length === 0) return
  commit(new Set(entries.map((e) => e.path)), selectedPath ?? entries[0]!.path, anchorPath)
}

/** Selected files in grid order; the focused file alone when nothing else is selected. */
export function selectedPaths(): string[] {
  const { entries, selection, selectedPath } = getState()
  const list = entries.filter((e) => selection.has(e.path)).map((e) => e.path)
  return list.length > 0 ? list : selectedPath ? [selectedPath] : []
}

/** Keeps only files that still exist, after the folder changed on disk. */
export function restoreSelection(paths: string[], focus: string | null, anchor: string | null): void {
  const exists = new Set(getState().entries.map((e) => e.path))
  const kept = new Set(paths.filter((p) => exists.has(p)))
  const f = focus && exists.has(focus) ? focus : null
  if (kept.size === 0 && f) kept.add(f)
  commit(kept, f, anchor && exists.has(anchor) ? anchor : f)
}

/** Cmd+C copies the files, Shift+Cmd+C their full paths, one per line. */
export async function copySelection(asPaths: boolean): Promise<void> {
  const paths = selectedPaths()
  if (paths.length === 0) return
  const n = paths.length
  try {
    if (asPaths) {
      await window.viewer.clipboard.copyPaths(paths)
      emit('toast', { text: n === 1 ? 'Copied path' : `Copied ${n} paths` })
    } else {
      await window.viewer.clipboard.copyFiles(paths)
      emit('toast', { text: n === 1 ? 'Copied image' : `Copied ${n} files` })
    }
  } catch (err) {
    emit('toast', { text: `Copy failed: ${String(err)}` })
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Cmd+Delete: moves the selected files to the Trash. The live folder then removes them. */
export async function trashSelection(): Promise<void> {
  const paths = selectedPaths()
  if (paths.length === 0) return
  try {
    const n = await window.viewer.fs.trash(paths)
    emit('toast', { text: `Moved ${plural(n, 'file', 'files')} to the Trash` })
    // Show it at once; the Mac's notice of the change can take a moment.
    emit('folder:refresh', undefined)
  } catch (err) {
    emit('toast', { text: `Move to Trash failed: ${String(err)}` })
  }
}

/** Cmd+O: opens the selected files in their default apps. */
export function openSelectionDefault(): void {
  for (const path of selectedPaths()) void window.viewer.fs.openDefault(path)
}

let optimizing = false

/** Web copies of the selected files, with the Optimize tab's settings. */
export async function optimizeSelection(): Promise<void> {
  const paths = selectedPaths()
  if (paths.length === 0 || optimizing) return
  optimizing = true
  emit('toast', { text: `Optimizing ${plural(paths.length, 'file', 'files')}…` })
  try {
    const n = await window.viewer.share.optimize(paths)
    emit('toast', { text: `Optimized ${plural(n, 'file', 'files')} → "optimized" folder` })
  } catch (err) {
    emit('toast', { text: `Optimize failed: ${String(err)}` })
  } finally {
    optimizing = false
  }
}
