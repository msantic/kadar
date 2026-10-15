// Checks for one grid tile: it takes a thumbnail only for the file version it shows, and an
// edited photo keeps its old picture until the new thumbnail arrives.

import { describe, expect, it } from 'vitest'
import { entry } from '../testing'
import { assignCell, clearCellThumb, createCell, setCellThumb } from './grid-cell'

describe('grid tile', () => {
  it('takes a thumbnail only for the file version it shows', () => {
    const cell = createCell()
    assignCell(cell, entry('a.jpg', { mtimeMs: 2 }), 0, null)
    setCellThumb(cell, { path: '/photos/a.jpg', version: '1:1000' }, '/cache/old.jpg')
    expect(cell.img.hasAttribute('src')).toBe(false)
    setCellThumb(cell, { path: '/photos/b.jpg', version: '2:1000' }, '/cache/b.jpg')
    expect(cell.img.hasAttribute('src')).toBe(false)
    setCellThumb(cell, { path: '/photos/a.jpg', version: '2:1000' }, '/cache/new.jpg')
    expect(cell.img.getAttribute('src')).toContain('new.jpg')
  })

  it('an edited photo keeps its old picture until the new one arrives; another file does not', () => {
    const cell = createCell()
    assignCell(cell, entry('a.jpg', { mtimeMs: 1 }), 0, '/cache/old.jpg')
    assignCell(cell, entry('a.jpg', { mtimeMs: 2 }), 0, null)
    expect(cell.img.getAttribute('src')).toContain('old.jpg')
    assignCell(cell, entry('b.jpg'), 0, null)
    expect(cell.img.hasAttribute('src')).toBe(false)
  })

  it('the old picture goes when the new version cannot get a thumbnail', () => {
    const cell = createCell()
    assignCell(cell, entry('a.jpg', { mtimeMs: 1 }), 0, '/cache/old.jpg')
    assignCell(cell, entry('a.jpg', { mtimeMs: 2 }), 0, null)
    clearCellThumb(cell, { path: '/photos/a.jpg', version: '1:1000' })
    expect(cell.img.getAttribute('src')).toContain('old.jpg') // another version: not this tile's
    clearCellThumb(cell, { path: '/photos/a.jpg', version: '2:1000' })
    expect(cell.img.hasAttribute('src')).toBe(false)
  })
})
