import { describe, expect, it } from 'vitest'
import { defaultDescending, sortEntries } from './sort'
import { entry } from './testing'

const names = (list: { name: string }[]): string[] => list.map((e) => e.name)

describe('sort', () => {
  it('orders names as Finder does: numbers by value, case ignored', () => {
    const list = [entry('img10.jpg'), entry('IMG2.jpg'), entry('apple.png'), entry('img1.jpg')]
    expect(names(sortEntries(list, 'name', false))).toEqual(['apple.png', 'img1.jpg', 'IMG2.jpg', 'img10.jpg'])
  })

  it('sorts by size and date, falling back to the name for equal values', () => {
    const list = [entry('b.jpg', { size: 5 }), entry('a.jpg', { size: 5 }), entry('c.jpg', { size: 9 })]
    expect(names(sortEntries(list, 'size', true))).toEqual(['c.jpg', 'a.jpg', 'b.jpg'])
    expect(names(sortEntries(list, 'size', false))).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('uses the creation date when a photo has no camera date', () => {
    const list = [
      entry('screenshot.png', { createdMs: 300, takenMs: null }),
      entry('photo.jpg', { createdMs: 900, takenMs: 100 }),
      entry('newer.jpg', { createdMs: 0, takenMs: 200 }),
    ]
    expect(names(sortEntries(list, 'taken', true))).toEqual(['screenshot.png', 'newer.jpg', 'photo.jpg'])
  })

  it('starts dates and size newest or largest first, names from A', () => {
    expect(defaultDescending('taken')).toBe(true)
    expect(defaultDescending('size')).toBe(true)
    expect(defaultDescending('name')).toBe(false)
  })

  it('does not change the list it gets', () => {
    const list = [entry('b.jpg'), entry('a.jpg')]
    sortEntries(list, 'name', false)
    expect(names(list)).toEqual(['b.jpg', 'a.jpg'])
  })
})
