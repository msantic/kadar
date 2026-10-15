// What a folder refresh changes in the grid. Pure functions, checked in refresh.test.ts.

import type { FileEntry, FolderListing } from './types'

/** True when the new listing shows the same files (path, date, size) and subfolders as before. */
export function sameListing(files: FileEntry[], folders: { path: string }[], listing: FolderListing): boolean {
  const key = (list: { path: string }[]): string => list.map((f) => f.path).sort().join('\n')
  if (key(listing.folders) !== key(folders) || listing.files.length !== files.length) return false
  const old = new Map(files.map((e) => [e.path, e]))
  return listing.files.every((f) => old.get(f.path)?.mtimeMs === f.mtimeMs && old.get(f.path)?.size === f.size)
}

/** Where the open big view goes after a refresh: the new place of `path`, or null to close it. */
export function bigViewIndex(entries: FileEntry[], path: string | null): number | null {
  const i = path ? entries.findIndex((e) => e.path === path) : -1
  return i >= 0 ? i : null
}
