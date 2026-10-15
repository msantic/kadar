// What a folder refresh changes in the grid. Pure functions, checked in refresh.test.ts.

import { parentOf } from '../paths'
import type { FileEntry, FolderListing } from './types'

/**
 * One version of a file: its modified time and size. An edit changes it, so a thumbnail or a
 * loaded picture made for another version is out of date.
 */
export function fileVersion(e: { mtimeMs: number; size: number }): string {
  return `${e.mtimeMs}:${e.size}`
}

/** True when the new listing shows the same files (path and version) and subfolders as before. */
export function sameListing(files: FileEntry[], folders: { path: string }[], listing: FolderListing): boolean {
  const key = (list: { path: string }[]): string => list.map((f) => f.path).sort().join('\n')
  if (key(listing.folders) !== key(folders) || listing.files.length !== files.length) return false
  const old = new Map(files.map((e) => [e.path, fileVersion(e)]))
  return listing.files.every((f) => old.get(f.path) === fileVersion(f))
}

/** What the open big view does after a refresh: close, follow its file to a new place, or load
 *  the file again because it was edited. */
export type BigViewStep = { kind: 'close' } | { kind: 'move'; index: number } | { kind: 'reload'; index: number }

/** The step for the big view that shows `shown`, given the refreshed `entries`. */
export function bigViewAfterRefresh(entries: FileEntry[], shown: FileEntry | null): BigViewStep {
  const index = shown ? entries.findIndex((e) => e.path === shown.path) : -1
  if (!shown || index < 0) return { kind: 'close' }
  return fileVersion(entries[index]!) === fileVersion(shown) ? { kind: 'move', index } : { kind: 'reload', index }
}

/** The nearest folder above `gone` that still exists, or null when none does. */
export async function nearestFolder(gone: string, isGone: (path: string) => Promise<boolean>): Promise<string | null> {
  let path = parentOf(gone)
  while (path !== null && (await isGone(path))) {
    const up = parentOf(path)
    path = up !== path ? up : null
  }
  return path
}
