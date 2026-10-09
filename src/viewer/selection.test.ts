import { beforeEach, describe, expect, it } from 'vitest'
import { getState, setState } from './store'
import { extendTo, restoreSelection, selectAll, selectedPaths, selectOnly, toggle } from './selection'
import { entry } from './testing'

const files = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map((n) => entry(n))
const selected = (): string[] => [...getState().selection].map((p) => p.split('/').pop()!).sort()

describe('selection', () => {
  beforeEach(() => {
    setState({ entries: files, selection: new Set(), selectedPath: null, anchorPath: null })
  })

  it('click selects one file', () => {
    selectOnly(1)
    selectOnly(3)
    expect(selected()).toEqual(['d.jpg'])
    expect(getState().selectedPath).toBe('/photos/d.jpg')
  })

  it('Cmd+click adds and removes', () => {
    selectOnly(0)
    toggle(2)
    toggle(4)
    expect(selected()).toEqual(['a.jpg', 'c.jpg', 'e.jpg'])
    toggle(2)
    expect(selected()).toEqual(['a.jpg', 'e.jpg'])
  })

  it('Shift selects the range from the anchor, in both directions', () => {
    selectOnly(1)
    extendTo(3)
    expect(selected()).toEqual(['b.jpg', 'c.jpg', 'd.jpg'])
    extendTo(0)
    expect(selected()).toEqual(['a.jpg', 'b.jpg'])
  })

  it('select all keeps grid order for copying', () => {
    selectOnly(2)
    selectAll()
    expect(selectedPaths()).toEqual(files.map((f) => f.path))
  })

  it('drops files that are gone, and keeps the focus when it still exists', () => {
    selectOnly(1)
    toggle(3)
    setState({ entries: files.filter((f) => f.name !== 'b.jpg') })
    restoreSelection([...getState().selection], getState().selectedPath, getState().anchorPath)
    expect(selected()).toEqual(['d.jpg'])
    expect(getState().selectedPath).toBe('/photos/d.jpg')
  })

  it('is kept in the saved session', async () => {
    selectOnly(0)
    toggle(1)
    await new Promise((r) => setTimeout(r, 300))
    const saved = JSON.parse(localStorage.getItem('kadar:viewer-session') ?? '{}') as { selectedPaths?: string[] }
    expect(saved.selectedPaths?.sort()).toEqual(['/photos/a.jpg', '/photos/b.jpg'])
  })
})
