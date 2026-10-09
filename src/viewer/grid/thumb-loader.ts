// Asks Rust for grid thumbnails (thumb_request) and reports each one as it is ready
// (viewer:thumb:ready). Requests made in one animation frame go together; reset() cancels
// the work in Rust and forgets everything, for example when another folder opens.

import { api } from '../ipc'
import type { FileEntry } from '../types'

const TARGET_SIZE = 256

type ReadyCb = (srcPath: string, cachePath: string) => void

/** Thumbnail requests for one grid. Calls `onReady` per file, from the cache or when Rust is done; never for a failed file. */
export class ThumbLoader {
  private currentRequestId: string | null = null
  private pendingPaths = new Set<string>()
  private knownCached = new Map<string, string>()
  /** Files Rust could not make a thumbnail for; not asked again until the folder reloads. */
  private failed = new Set<string>()
  private flushTimer: number | null = null
  private queued: FileEntry[] = []

  constructor(private readonly onReady: ReadyCb) {
    api.thumb.onReady(({ requestId, srcPath, cachePath }) => {
      if (requestId !== this.currentRequestId) return
      this.knownCached.set(srcPath, cachePath)
      this.pendingPaths.delete(srcPath)
      this.onReady(srcPath, cachePath)
    })
    api.thumb.onError(({ requestId, srcPath }) => {
      if (requestId !== this.currentRequestId) return
      this.pendingPaths.delete(srcPath)
      this.failed.add(srcPath)
    })
  }

  getCached(srcPath: string): string | null {
    return this.knownCached.get(srcPath) ?? null
  }

  reset(): void {
    if (this.currentRequestId) void api.thumb.cancel(this.currentRequestId)
    this.currentRequestId = null
    this.pendingPaths.clear()
    this.knownCached.clear()
    this.failed.clear()
    this.queued = []
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer)
      this.flushTimer = null
    }
  }

  request(entries: FileEntry[]): void {
    for (const e of entries) {
      if (this.knownCached.has(e.path)) continue
      if (this.pendingPaths.has(e.path)) continue
      if (this.failed.has(e.path)) continue
      this.queued.push(e)
      this.pendingPaths.add(e.path)
    }
    if (this.flushTimer === null) {
      this.flushTimer = requestAnimationFrame(() => this.flush())
    }
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
        files: batch.map((e) => ({ srcPath: e.path, mtimeMs: e.mtimeMs, size: e.size })),
        targetSize: TARGET_SIZE,
      })
    } catch {
      // The request did not reach Rust: forget these files, so the next scroll asks again.
      for (const e of batch) this.pendingPaths.delete(e.path)
      return
    }

    if (requestId !== this.currentRequestId) return

    for (const [src, cachePath] of Object.entries(res.cached)) {
      this.knownCached.set(src, cachePath)
      this.pendingPaths.delete(src)
      this.onReady(src, cachePath)
    }
  }
}
