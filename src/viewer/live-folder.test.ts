// Checks for the live folder with the whole viewer running against a folder in memory: new,
// deleted and edited files show up, an edited photo gets its new thumbnail, a slow old listing
// never replaces a newer one, coming back to Kadar looks again, and a folder that is gone is
// left for the nearest folder above it, with a message.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FileEntry, FolderListing, ViewerAPI } from './types'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('9.9.9') }))

// The test page lacks these browser parts; stand-ins are enough for the viewer to run.
globalThis.ResizeObserver = class { observe(): void {} unobserve(): void {} disconnect(): void {} }
HTMLImageElement.prototype.decode = () => Promise.resolve()
HTMLMediaElement.prototype.load = () => {}
HTMLMediaElement.prototype.pause = () => {}

/** The folders on the fake disk: path → files and subfolders. A path not here is gone. */
const disk = new Map<string, { files: FileEntry[]; folders: string[] }>()
const file = (dir: string, name: string, mtimeMs = 1, size = 100): FileEntry =>
  ({ name, path: `${dir}/${name}`, ext: 'jpg', kind: 'image', size, mtimeMs, createdMs: 0 })
const listing = (dir: string): FolderListing => {
  const d = disk.get(dir)
  if (!d) return { files: [], folders: [], truncated: false, missing: true }
  return {
    files: d.files.map((f) => ({ ...f })),
    folders: d.folders.map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })),
    truncated: false,
    missing: false,
  }
}

/** When set, the next listing waits for this promise: a slow disk. */
let hold: Promise<void> | null = null
let changed: ((d: { dirPath: string }) => void) | null = null
const watched: string[] = []

const api = {
  fs: {
    listFolder: async (dir: string) => {
      const snapshot = listing(dir)
      const wait = hold
      hold = null
      if (wait) await wait
      return snapshot
    },
    listTreeChildren: async () => [],
    getRoots: async () => ({ home: '', pictures: '', desktop: '', downloads: '', movies: '' }),
    watch: async (p: string) => { watched.push(p) },
    onChanged: (cb: (d: { dirPath: string }) => void) => { changed = cb; return () => {} },
    takenDates: async (files: unknown[]) => files.map(() => null),
  },
  // Every thumbnail is "in the cache", named after the file version, so the tiles show which one they got.
  thumb: {
    request: async ({ files }: { files: { srcPath: string; mtimeMs: number }[] }) => ({
      cached: Object.fromEntries(files.map((f) => [f.srcPath, `/cache${f.srcPath}@${f.mtimeMs}.jpg`])),
      pending: [],
    }),
    cancel: async () => {},
    onReady: () => () => {},
    onError: () => () => {},
  },
  meta: { get: async () => ({}), properties: async () => null, openUrl: async () => {} },
  share: { onExportProgress: () => () => {}, exportStop: async () => {} },
  favorites: { list: async () => [] },
}
;(window as unknown as { viewer: unknown }).viewer = api as unknown as ViewerAPI

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  }
}
const tiles = (): { name: string; src: string }[] =>
  [...document.querySelectorAll<HTMLElement>('.viewer-cell')]
    .filter((c) => c.style.visibility === 'visible')
    .map((c) => ({ name: c.textContent ?? '', src: c.querySelector('img')?.getAttribute('src') ?? '' }))
const names = (): string[] => tiles().map((t) => t.name.replace(/^JPG/, '')).sort()
const fireChange = (dir: string): void => changed!({ dirPath: dir })

describe('live folder', () => {
  beforeAll(async () => {
    disk.set('/p', { files: [file('/p', 'a.jpg'), file('/p', 'b.jpg')], folders: ['/p/trip'] })
    disk.set('/p/trip', { files: [file('/p/trip', 'x.jpg')], folders: [] })
    document.body.innerHTML = '<div id="panel-viewer"></div>'
    const { initViewer } = await import('./index')
    await initViewer([{ path: '/p', isDir: true }])
    await settle()
  })

  it('opens the folder and watches it', () => {
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'trip'])
    expect(watched).toContain('/p')
  })

  it('shows a new file and drops a deleted one', async () => {
    disk.get('/p')!.files = [file('/p', 'b.jpg'), file('/p', 'c.jpg')]
    fireChange('/p')
    await settle()
    expect(names()).toEqual(['b.jpg', 'c.jpg', 'trip'])
  })

  it('an edited photo gets the thumbnail of its new version', async () => {
    disk.get('/p')!.files = [file('/p', 'b.jpg', 7, 200), file('/p', 'c.jpg')]
    fireChange('/p')
    await settle()
    const b = tiles().find((t) => t.name.includes('b.jpg'))!
    expect(decodeURIComponent(b.src)).toContain('b.jpg@7')
  })

  it('the big view shows the new version of a photo edited on disk', async () => {
    const { emit } = await import('./bus')
    const { getState } = await import('./store')
    const index = getState().entries.findIndex((e) => e.name === 'c.jpg')
    emit('lightbox:open', { index })
    await settle()
    const shown = (): string => document.querySelector('.viewer-lightbox-img')?.getAttribute('src') ?? ''
    expect(shown()).toContain('c.jpg?v=1')
    disk.get('/p')!.files = [file('/p', 'b.jpg', 7, 200), file('/p', 'c.jpg', 8, 300)]
    fireChange('/p')
    await settle()
    expect(decodeURIComponent(shown())).toContain('c.jpg?v=8:300')
    emit('lightbox:close', undefined)
  })

  it('a slow older listing never replaces a newer one', async () => {
    let release!: () => void
    hold = new Promise((r) => { release = r })
    disk.get('/p')!.files = [file('/p', 'old.jpg')]
    fireChange('/p') // lists now, answers late
    await settle()
    disk.get('/p')!.files = [file('/p', 'new.jpg')]
    fireChange('/p')
    await settle()
    release()
    await settle()
    expect(names()).toEqual(['new.jpg', 'trip'])
  })

  it('coming back to Kadar looks at the folder again', async () => {
    disk.get('/p')!.files = [file('/p', 'new.jpg'), file('/p', 'missed.jpg')]
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(names()).toEqual(['missed.jpg', 'new.jpg', 'trip'])
  })

  it('a folder that is gone is left for the nearest folder above, with a message', async () => {
    const { emit } = await import('./bus')
    emit('folder:request', { path: '/p/trip' })
    await settle()
    expect(names()).toEqual(['x.jpg'])
    disk.delete('/p/trip')
    disk.get('/p')!.folders = []
    fireChange('/p/trip')
    await settle()
    expect(document.querySelector('.viewer-toast')?.textContent).toContain('“trip” was moved or deleted.')
    const { getState } = await import('./store')
    expect(getState().currentFolder).toBe('/p')
    expect(names()).toEqual(['missed.jpg', 'new.jpg'])
  })
})
