import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import { cacheDir } from './paths'

export const THUMB_VERSION = 1
const CAP_BYTES    = 1024 * 1024 * 1024   // 1 GB
const TARGET_BYTES =  800 * 1024 * 1024   // 800 MB

export interface ThumbKeyInput {
  srcPath: string
  mtimeMs: number
  size: number
  targetSize: number
}

export function keyFor(input: ThumbKeyInput): string {
  const h = crypto.createHash('sha1')
  h.update(`${input.srcPath}:${input.mtimeMs}:${input.size}:${THUMB_VERSION}:${input.targetSize}`)
  return h.digest('hex').slice(0, 16)
}

export function cachePathForKey(key: string): string {
  const shard = key.slice(0, 2)
  return path.join(cacheDir(), shard, `${key}.webp`)
}

export async function ensureCacheDir(): Promise<void> {
  await fs.ensureDir(cacheDir())
}

/** Returns the cache path if the thumb already exists, otherwise null. */
export async function lookup(input: ThumbKeyInput): Promise<string | null> {
  const p = cachePathForKey(keyFor(input))
  try {
    const st = await fs.stat(p)
    if (st.isFile() && st.size > 0) {
      // Touch atime so our LRU sweep sees recent reads.
      const now = new Date()
      fs.utimes(p, now, st.mtime).catch(() => {})
      return p
    }
  } catch {}
  return null
}

/** Returns a pre-resolved absolute target path where the worker should write. */
export async function reserveTarget(input: ThumbKeyInput): Promise<{ key: string; targetPath: string }> {
  const key = keyFor(input)
  const targetPath = cachePathForKey(key)
  await fs.ensureDir(path.dirname(targetPath))
  return { key, targetPath }
}

/** Background eviction sweep. Deletes oldest-atime files until under TARGET_BYTES. */
export async function evictIfNeeded(): Promise<void> {
  const root = cacheDir()
  try {
    const shards = await fs.readdir(root)
    const files: { path: string; size: number; atimeMs: number }[] = []
    let total = 0

    for (const shard of shards) {
      const shardPath = path.join(root, shard)
      let entries: string[]
      try {
        entries = await fs.readdir(shardPath)
      } catch { continue }
      for (const name of entries) {
        const full = path.join(shardPath, name)
        try {
          const st = await fs.stat(full)
          if (!st.isFile()) continue
          files.push({ path: full, size: st.size, atimeMs: st.atimeMs })
          total += st.size
        } catch {}
      }
    }

    if (total <= CAP_BYTES) return

    files.sort((a, b) => a.atimeMs - b.atimeMs)
    for (const f of files) {
      if (total <= TARGET_BYTES) break
      await fs.remove(f.path).catch(() => {})
      total -= f.size
    }
  } catch {}
}
