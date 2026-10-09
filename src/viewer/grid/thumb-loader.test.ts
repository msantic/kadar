// Checks for the thumbnail requests: cached files come at once, ready and failed files are
// tracked, and a request that never reached Rust is asked again.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entry } from '../testing'

type Handler = (data: { requestId: string; srcPath: string; cachePath?: string; message?: string }) => void
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
    const loader = new ThumbLoader((src) => ready.push(src))
    request.mockResolvedValue({ cached: { '/photos/a.jpg': '/cache/a.jpg' }, pending: ['/photos/b.jpg'] })
    loader.request([entry('a.jpg'), entry('b.jpg')])
    await flush()
    expect(ready).toEqual(['/photos/a.jpg'])
    const requestId = (request.mock.calls[0]![0] as { requestId: string }).requestId
    handlers.ready!({ requestId, srcPath: '/photos/b.jpg', cachePath: '/cache/b.jpg' })
    expect(ready).toEqual(['/photos/a.jpg', '/photos/b.jpg'])
    expect(loader.getCached('/photos/b.jpg')).toBe('/cache/b.jpg')
    handlers.ready!({ requestId: 'old-folder', srcPath: '/photos/c.jpg', cachePath: '/cache/c.jpg' })
    expect(ready).toHaveLength(2) // results of an older folder are ignored
  })

  it('does not ask again for a file Rust could not read', async () => {
    const loader = new ThumbLoader(() => {})
    request.mockResolvedValue({ cached: {}, pending: ['/photos/bad.jpg'] })
    loader.request([entry('bad.jpg')])
    await flush()
    const requestId = (request.mock.calls[0]![0] as { requestId: string }).requestId
    handlers.error!({ requestId, srcPath: '/photos/bad.jpg', message: 'cannot decode image' })
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
})
