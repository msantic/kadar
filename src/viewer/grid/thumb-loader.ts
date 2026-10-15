// Asks Rust for grid thumbnails (thumb_request) and reports each one as it is ready
// (viewer:thumb:ready). Requests made in one animation frame go together; reset() cancels
// the work in Rust and forgets everything, for example when another folder opens.
// Everything is kept per file version (path, modified time, size): a file edited while its folder
// is open gets a new thumbnail, and a file that failed while it was still being written is tried
// again once it changes.

import { api } from '../ipc'
import { fileVersion } from '../refresh'
import type { FileEntry } from '../types'

const TARGET_SIZE = 256

/** What a thumbnail belongs to: a file path and the version it was made from (`fileVersion`). */
export interface ThumbFile {
  path: string
  version: string
}

type ReadyCb = (file: ThumbFile, cachePath: string) => void
type FailedCb = (file: ThumbFile) => void

const keyOf = (path: string, version: string): string => `${path}\n${version}`

/** Thumbnail requests for one grid. Calls `onReady` per file, from the cache or when Rust is done, and `onFailed` when Rust cannot make one. */
export class ThumbLoader {
  private currentRequestId: string | null = null
  /** Keys asked for and not answered yet. */
  private pending = new Set<string>()
  /** Thumbnail cache file by key. A late answer for an older version cannot hide the newer one. */
  private known = new Map<string, string>()
  /** Keys Rust could not make a thumbnail for; not asked again until the file changes or the folder reloads. */
  private failed = new Set<string>()
  private flushTimer: number | null = null
  private queued: FileEntry[] = []

  constructor(private readonly onReady: ReadyCb, private readonly onFailed: FailedCb = () => {}) {
    api.thumb.onReady(({ requestId, srcPath, version, cachePath }) => {
      if (requestId !== this.currentRequestId) return
      this.settle({ path: srcPath, version }, cachePath)
    })
    api.thumb.onError(({ requestId, srcPath, version }) => {
      if (requestId !== this.currentRequestId) return
      const key = keyOf(srcPath, version)
      this.pending.delete(key)
      this.failed.add(key)
      this.onFailed({ path: srcPath, version })
    })
  }

  /** The thumbnail of this version of the file, or null when it is not made yet. */
  getCached(e: FileEntry): string | null {
    return this.known.get(keyOf(e.path, fileVersion(e))) ?? null
  }

  reset(): void {
    if (this.currentRequestId) void api.thumb.cancel(this.currentRequestId)
    this.currentRequestId = null
    this.pending.clear()
    this.known.clear()
    this.failed.clear()
    this.queued = []
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer)
      this.flushTimer = null
    }
  }

  request(entries: FileEntry[]): void {
    for (const e of entries) {
      const key = keyOf(e.path, fileVersion(e))
      if (this.known.has(key) || this.pending.has(key) || this.failed.has(key)) continue
      this.queued.push(e)
      this.pending.add(key)
    }
    if (this.flushTimer === null) {
      this.flushTimer = requestAnimationFrame(() => this.flush())
    }
  }

  private settle(file: ThumbFile, cachePath: string): void {
    const key = keyOf(file.path, file.version)
    this.pending.delete(key)
    this.failed.delete(key)
    this.known.set(key, cachePath)
    this.onReady(file, cachePath)
  }

  private async flush(): Promise<void> {
    this.flushTimer = null
    if (this.queued.length === 0) return
    const batch = this.queued
    this.queued = []

    if (!this.currentRequestId) this.currentRequestId = crypto.randomUUID()
    const requestId = this.currentRequestId

    let res: Awaited<ReturnType<typeof api.thumb.request>>
    try {
      res = await api.thumb.request({
        requestId,
        files: batch.map((e) => ({ srcPath: e.path, mtimeMs: e.mtimeMs, size: e.size, version: fileVersion(e) })),
        targetSize: TARGET_SIZE,
      })
    } catch {
      // The request did not reach Rust: forget these files, so the next scroll asks again.
      for (const e of batch) this.pending.delete(keyOf(e.path, fileVersion(e)))
      return
    }

    if (requestId !== this.currentRequestId) return

    // The answer is by path. A path twice in one batch (edited within one frame): the newest wins.
    const asked = new Map(batch.map((e) => [e.path, e]))
    for (const [src, cachePath] of Object.entries(res.cached)) {
      const e = asked.get(src)
      if (e) this.settle({ path: e.path, version: fileVersion(e) }, cachePath)
    }
  }
}
