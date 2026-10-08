import fs from 'fs-extra'
import path from 'path'
import { kindOf, type Kind } from './formats'

export interface FolderEntry {
  name: string
  path: string
}

export interface FileEntry {
  name: string
  path: string
  ext: string
  kind: Kind
  size: number
  mtimeMs: number
}

export interface FolderListing {
  folders: FolderEntry[]
  files: FileEntry[]
  truncated: boolean
}

const MAX_ENTRIES = 50_000
const STAT_CHUNK  = 256

function yieldImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function listFolder(dirPath: string): Promise<FolderListing> {
  let dirents: fs.Dirent[]
  try {
    dirents = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return { folders: [], files: [], truncated: false }
  }

  const folders: FolderEntry[] = []
  const fileCandidates: { name: string; path: string }[] = []

  for (const d of dirents) {
    if (d.name.startsWith('.')) continue
    const full = path.join(dirPath, d.name)
    if (d.isDirectory()) {
      folders.push({ name: d.name, path: full })
    } else if (d.isFile() || d.isSymbolicLink()) {
      if (kindOf(d.name) !== 'unsupported') {
        fileCandidates.push({ name: d.name, path: full })
      }
    }
    if (folders.length + fileCandidates.length >= MAX_ENTRIES) break
  }

  const truncated = folders.length + fileCandidates.length >= MAX_ENTRIES
  folders.sort((a, b) => a.name.localeCompare(b.name))
  fileCandidates.sort((a, b) => a.name.localeCompare(b.name))

  const files: FileEntry[] = new Array(fileCandidates.length)
  for (let i = 0; i < fileCandidates.length; i += STAT_CHUNK) {
    const slice = fileCandidates.slice(i, i + STAT_CHUNK)
    const stats = await Promise.all(slice.map(async (c) => {
      try {
        const st = await fs.stat(c.path)
        return { size: st.size, mtimeMs: st.mtimeMs }
      } catch {
        return { size: 0, mtimeMs: 0 }
      }
    }))
    for (let j = 0; j < slice.length; j++) {
      const c = slice[j]!
      const s = stats[j]!
      files[i + j] = {
        name: c.name,
        path: c.path,
        ext:  extOf(c.name),
        kind: kindOf(c.name),
        size: s.size,
        mtimeMs: s.mtimeMs,
      }
    }
    if (i + STAT_CHUNK < fileCandidates.length) await yieldImmediate()
  }

  return { folders, files, truncated }
}

export async function listTreeChildren(dirPath: string): Promise<FolderEntry[]> {
  try {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true })
    const out: FolderEntry[] = []
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue
      if (d.isDirectory()) out.push({ name: d.name, path: path.join(dirPath, d.name) })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  } catch {
    return []
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}
