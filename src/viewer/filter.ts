import type { FileEntry } from './types'

/** Lower case, accents removed: "Šuma" matches "suma". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Files whose names contain every word of `query`, in any order. An empty query keeps all. */
export function filterEntries(list: FileEntry[], query: string): FileEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return list
  return list.filter((e) => {
    const name = fold(e.name)
    return words.every((w) => name.includes(w))
  })
}
