import type { FileEntry } from './types'

export type SortBy = 'name' | 'taken' | 'modified' | 'created' | 'size' | 'type'

export const SORT_LABELS: Record<SortBy, string> = {
  name: 'Name',
  taken: 'Date Taken',
  modified: 'Date Modified',
  created: 'Date Created',
  size: 'Size',
  type: 'Kind',
}

/** Finder starts dates and sizes with the newest or largest first, names from A. */
export function defaultDescending(by: SortBy): boolean {
  return by === 'taken' || by === 'modified' || by === 'created' || by === 'size'
}

// Finder order for names: "img2" before "img10", case ignored.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortEntries(list: FileEntry[], by: SortBy, descending: boolean): FileEntry[] {
  const byName = (a: FileEntry, b: FileEntry): number => collator.compare(a.name, b.name)
  const key: (a: FileEntry, b: FileEntry) => number = {
    name: byName,
    // Files without a camera date (screenshots, downloads) use their creation date.
    taken: (a: FileEntry, b: FileEntry) => (a.takenMs ?? a.createdMs) - (b.takenMs ?? b.createdMs),
    modified: (a: FileEntry, b: FileEntry) => a.mtimeMs - b.mtimeMs,
    created: (a: FileEntry, b: FileEntry) => a.createdMs - b.createdMs,
    size: (a: FileEntry, b: FileEntry) => a.size - b.size,
    type: (a: FileEntry, b: FileEntry) => collator.compare(a.ext, b.ext),
  }[by]
  const sign = descending ? -1 : 1
  // Equal keys fall back to the name, always A to Z, so the order is stable and predictable.
  return [...list].sort((a, b) => sign * key(a, b) || byName(a, b))
}
