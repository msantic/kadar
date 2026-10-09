import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, setState } from './store'
import { pushUndo, undoLast } from './undo'

const putBack = vi.fn(async (pairs: [string, string][]) => pairs.map((p) => p[0]))
const rename = vi.fn(async (path: string, newName: string) => `${path.slice(0, path.lastIndexOf('/'))}/${newName}`)

beforeEach(() => {
  putBack.mockClear()
  rename.mockClear()
  ;(window as unknown as { viewer: unknown }).viewer = { fs: { putBack, rename } }
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
})
