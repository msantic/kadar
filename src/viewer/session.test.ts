// Checks for the saved viewer state: damaged or old saves never give the viewer a value it
// cannot use.

import { describe, expect, it } from 'vitest'
import { sanitize } from './session'

describe('session', () => {
  it('starts empty when nothing or something unreadable was saved', () => {
    for (const saved of [null, undefined, 5, 'text', []]) {
      const s = sanitize(saved)
      expect(s.folder).toBeNull()
      expect(s.selectedPaths).toEqual([])
      expect(s.sortBy).toBe('name')
    }
  })

  it('keeps every good value', () => {
    const good = {
      folder: '/photos', topPath: '/photos/a.jpg', topIndex: 40, selectedPath: '/photos/b.jpg',
      selectedPaths: ['/photos/b.jpg', '/photos/c.jpg'], anchorPath: '/photos/b.jpg', bigView: true,
      expanded: ['/photos'], sortBy: 'taken', sortDescending: true, filter: 'beach',
    }
    expect(sanitize(good)).toEqual(good)
  })

  it('replaces wrong types with defaults, one value at a time', () => {
    const s = sanitize({
      folder: 42, topIndex: -3, selectedPaths: null, expanded: ['/ok', 7], sortBy: 'colour',
      bigView: 'yes', filter: null, anchorPath: '',
    })
    expect(s.folder).toBeNull()
    expect(s.topIndex).toBe(0)
    expect(s.selectedPaths).toEqual([])
    expect(s.expanded).toEqual(['/ok'])
    expect(s.sortBy).toBe('name')
    expect(s.bigView).toBe(false)
    expect(s.filter).toBe('')
    expect(s.anchorPath).toBeNull()
  })

  it('never shares lists between two fresh sessions', () => {
    const a = sanitize(null)
    a.selectedPaths.push('/x')
    expect(sanitize(null).selectedPaths).toEqual([])
  })
})
