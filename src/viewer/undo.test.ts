// Checks for Undo and Rotate: putting trashed files back, renaming back, turning photos back,
// newest step first; Rotate turns only photos and reports the ones it cannot turn.
// `window.viewer.fs` is a stand-in, so no real file moves.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, setState } from './store'
import { pushUndo, undoLast } from './undo'
import { rotateSelection } from './selection'
import { on } from './bus'
import { entry } from './testing'

const putBack = vi.fn(async (pairs: [string, string][]) => pairs.map((p) => p[0]))
const rotate = vi.fn(async (paths: string[], _clockwise: boolean) =>
  paths.map((path) => ({ path, error: path.endsWith('.png') ? 'Kadar turns JPEG, HEIC and TIFF photos only.' : null })))
const rename = vi.fn(async (path: string, newName: string) => `${path.slice(0, path.lastIndexOf('/'))}/${newName}`)

beforeEach(() => {
  putBack.mockClear()
  rename.mockClear()
  rotate.mockClear()
  ;(window as unknown as { viewer: unknown }).viewer = { fs: { putBack, rename, rotate } }
  setState({ currentFolder: null, selection: new Set(), selectedPath: null })
})

describe('undo', () => {
  it('puts trashed files back and selects them', async () => {
    pushUndo({ kind: 'trash', pairs: [['/p/a.jpg', '/Trash/a.jpg'], ['/p/b.jpg', '/Trash/b.jpg']] })
    await undoLast()
    expect(putBack).toHaveBeenCalledWith([['/p/a.jpg', '/Trash/a.jpg'], ['/p/b.jpg', '/Trash/b.jpg']])
    expect([...getState().selection]).toEqual(['/p/a.jpg', '/p/b.jpg'])
  })

  it('renames back, newest step first', async () => {
    pushUndo({ kind: 'trash', pairs: [['/p/x.jpg', '/Trash/x.jpg']] })
    pushUndo({ kind: 'rename', now: '/p/new.jpg', before: '/p/old.jpg' })
    await undoLast()
    expect(rename).toHaveBeenCalledWith('/p/new.jpg', 'old.jpg')
    expect(putBack).not.toHaveBeenCalled()
    expect(getState().selectedPath).toBe('/p/old.jpg')
    await undoLast()
    expect(putBack).toHaveBeenCalledTimes(1)
  })

  it('rotate turns only the selected photos; Undo turns them back the other way', async () => {
    const toasts: string[] = []
    const off = on('toast', ({ text }) => toasts.push(text))
    const files = [entry('a.jpg'), entry('clip.mp4', { kind: 'video' }), entry('shot.png')]
    setState({ entries: files, selection: new Set(files.map((f) => f.path)), selectedPath: files[0]!.path })
    await rotateSelection(true)
    expect(rotate).toHaveBeenCalledWith(['/photos/a.jpg', '/photos/shot.png'], true)
    expect(toasts).toEqual(['Cannot rotate "shot.png": Kadar turns JPEG, HEIC and TIFF photos only.'])

    await undoLast()
    expect(rotate).toHaveBeenLastCalledWith(['/photos/a.jpg'], false) // only the photo that turned
    off()
  })

  it('quick presses all count, in order', async () => {
    setState({ entries: [entry('a.jpg')], selection: new Set(['/photos/a.jpg']), selectedPath: '/photos/a.jpg' })
    void rotateSelection(true)
    void rotateSelection(true)
    await rotateSelection(false)
    expect(rotate.mock.calls.map((c) => c[1])).toEqual([true, true, false])
  })
})
