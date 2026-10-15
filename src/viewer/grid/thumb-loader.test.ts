// Checks for the thumbnail requests: cached files come at once, ready and failed files are
// tracked per file version, and a request that never reached Rust is asked again.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entry } from '../testing'

type Handler = (data: { requestId: string; srcPath: string; version: string; cachePath?: string; message?: string }) => void
const handlers: { ready?: Handler; error?: Handler } = {}
const request = vi.fn()

vi.mock('../ipc', () => ({
  api: {
    thumb: {
      request: (...args: unknown[]) => request(...args),
      cancel: vi.fn().mockResolvedValue(undefined),
      onReady: (cb: Handler) => { handlers.ready = cb; return () => {} },
      onError: (cb: Handler) => { handlers.error = cb; return () => {} },
    },
  },
}))

const { ThumbLoader } = await import('./thumb-loader')

/** Runs the animation frame the loader waits for, then lets its request finish. */
async function flush(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  await new Promise((r) => setTimeout(r, 0))
}

describe('thumb loader', () => {
  beforeEach(() => request.mockReset())

  it('reports cached thumbnails at once and ready ones as they come', async () => {
    const ready: string[] = []
    const loader = new ThumbLoader((file) => ready.push(file.path))
    request.mockResolvedValue({ cached: { '/photos/a.jpg': '/cache/a.jpg' }, pending: ['/photos/b.jpg'] })
    loader.request([entry('a.jpg'), entry('b.jpg')])
    await flush()
    expect(ready).toEqual(['/photos/a.jpg'])
    const requestId = (request.mock.calls[0]![0] as { requestId: string }).requestId
    handlers.ready!({ requestId, srcPath: '/photos/b.jpg', version: '0:1000', cachePath: '/cache/b.jpg' })
    expect(ready).toEqual(['/photos/a.jpg', '/photos/b.jpg'])
    expect(loader.getCached(entry('b.jpg'))).toBe('/cache/b.jpg')
    handlers.ready!({ requestId: 'old-folder', srcPath: '/photos/c.jpg', version: '0:1000', cachePath: '/cache/c.jpg' })
    expect(ready).toHaveLength(2) // results of an older folder are ignored
  })

  it('does not ask again for a file Rust could not read, and reports it', async () => {
    const failed: string[] = []
    const loader = new ThumbLoader(() => {}, (file) => failed.push(file.path))
    request.mockResolvedValue({ cached: {}, pending: ['/photos/bad.jpg'] })
    loader.request([entry('bad.jpg')])
    await flush()
    const requestId = (request.mock.calls[0]![0] as { requestId: string }).requestId
    handlers.error!({ requestId, srcPath: '/photos/bad.jpg', version: '0:1000', message: 'cannot decode image' })
    expect(failed).toEqual(['/photos/bad.jpg'])
    loader.request([entry('bad.jpg')])
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('asks again when a request did not reach Rust', async () => {
    const loader = new ThumbLoader(() => {})
    request.mockRejectedValueOnce(new Error('no connection'))
    loader.request([entry('a.jpg')])
    await flush()
    request.mockResolvedValue({ cached: {}, pending: ['/photos/a.jpg'] })
    loader.request([entry('a.jpg')])
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('an edited file gets a new thumbnail; the old one is not shown for it', async () => {
    const loader = new ThumbLoader(() => {})
    request.mockResolvedValue({ cached: { '/photos/a.jpg': '/cache/a-old.jpg' }, pending: [] })
    loader.request([entry('a.jpg', { mtimeMs: 1 })])
    await flush()
    const edited = entry('a.jpg', { mtimeMs: 2 })
    expect(loader.getCached(edited)).toBeNull()
    request.mockResolvedValue({ cached: {}, pending: ['/photos/a.jpg'] })
    loader.request([edited])
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    const requestId = (request.mock.calls[1]![0] as { requestId: string }).requestId
    handlers.ready!({ requestId, srcPath: '/photos/a.jpg', version: '2:1000', cachePath: '/cache/a-new.jpg' })
    expect(loader.getCached(edited)).toBe('/cache/a-new.jpg')
  })

  it('a late answer for the old version does not replace the new thumbnail', async () => {
    const ready: string[] = []
    const loader = new ThumbLoader((file) => ready.push(file.version))
    request.mockResolvedValue({ cached: {}, pending: ['/photos/a.jpg'] })
    loader.request([entry('a.jpg', { mtimeMs: 1 })])
    await flush()
    loader.request([entry('a.jpg', { mtimeMs: 2 })])
    await flush()
    const requestId = (request.mock.calls[0]![0] as { requestId: string }).requestId
    handlers.ready!({ requestId, srcPath: '/photos/a.jpg', version: '2:1000', cachePath: '/cache/new.jpg' })
    handlers.ready!({ requestId, srcPath: '/photos/a.jpg', version: '1:1000', cachePath: '/cache/old.jpg' })
    expect(loader.getCached(entry('a.jpg', { mtimeMs: 2 }))).toBe('/cache/new.jpg')
    expect(ready).toEqual(['2:1000', '1:1000']) // each answer names its own version, so the grid can tell them apart
  })

  it('a file that failed while it was still being written is tried again once it changes', async () => {
    const loader = new ThumbLoader(() => {})
    request.mockResolvedValue({ cached: {}, pending: ['/photos/big.jpg'] })
    loader.request([entry('big.jpg', { size: 10 })])
    await flush()
    const requestId = (request.mock.calls[0]![0] as { requestId: string }).requestId
    handlers.error!({ requestId, srcPath: '/photos/big.jpg', version: '0:10', message: 'cannot decode image' })
    loader.request([entry('big.jpg', { size: 10 })])
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    loader.request([entry('big.jpg', { size: 5_000_000, mtimeMs: 9 })])
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('matches answers by the label it sent, so a time with decimals still matches', async () => {
    const loader = new ThumbLoader(() => {})
    request.mockResolvedValue({ cached: {}, pending: ['/photos/a.jpg'] })
    const photo = entry('a.jpg', { mtimeMs: 1792063202522.6025 })
    loader.request([photo])
    await flush()
    const sent = request.mock.calls[0]![0] as { requestId: string; files: { version: string }[] }
    handlers.ready!({ requestId: sent.requestId, srcPath: '/photos/a.jpg', version: sent.files[0]!.version, cachePath: '/cache/a.jpg' })
    expect(loader.getCached(photo)).toBe('/cache/a.jpg')
  })
})
