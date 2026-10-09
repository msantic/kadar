// Test helper: a file entry with sensible defaults.
import type { FileEntry } from './types'

export function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    path: `/photos/${name}`,
    ext: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '',
    kind: 'image',
    size: 1000,
    mtimeMs: 0,
    createdMs: 0,
    ...extra,
  }
}
