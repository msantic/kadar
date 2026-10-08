import { api } from '../ipc'
import type { FileEntry } from '../types'

const TARGET_SIZE = 256

type ReadyCb = (srcPath: string, cachePath: string) => void

export class ThumbLoader {
  private currentRequestId: string | null = null
  private pendingPaths = new Set<string>()
  private knownCached = new Map<string, string>()
  private flushTimer: number | null = null
  private queued: FileEntry[] = []
  private onReadyDispose: () => void

  constructor(private readonly onReady: ReadyCb) {
    this.onReadyDispose = api.thumb.onReady(({ requestId, srcPath, cachePath }) => {
      console.log('[thumb-loader] onReady:', srcPath, 'reqId match:', requestId === this.currentRequestId)
      if (requestId !== this.currentRequestId) return
      this.knownCached.set(srcPath, cachePath)
      this.pendingPaths.delete(srcPath)
      this.onReady(srcPath, cachePath)
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

    const res = await api.thumb.request({
      requestId,
      files: batch.map((e) => ({ srcPath: e.path, mtimeMs: e.mtimeMs, size: e.size })),
      targetSize: TARGET_SIZE,
    })

    if (requestId !== this.currentRequestId) return

    for (const [src, cachePath] of Object.entries(res.cached)) {
      this.knownCached.set(src, cachePath)
      this.pendingPaths.delete(src)
      this.onReady(src, cachePath)
    }
  }

  dispose(): void {
    this.onReadyDispose()
    this.reset()
  }
}
