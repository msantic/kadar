// Checks for the search filter: empty query, case and accents, word order.

import { describe, expect, it } from 'vitest'
import { filterEntries } from './filter'
import { entry } from './testing'

const list = [entry('Šuma u jesen.jpg'), entry('IMG_2041.HEIC'), entry('beach sunset.png')]
const names = (q: string): string[] => filterEntries(list, q).map((e) => e.name)

describe('filter', () => {
  it('keeps everything for an empty query', () => {
    expect(names('  ')).toHaveLength(3)
  })
  it('ignores case and accents', () => {
    expect(names('suma')).toEqual(['Šuma u jesen.jpg'])
    expect(names('img_2041.heic')).toEqual(['IMG_2041.HEIC'])
  })
  it('needs every word, in any order', () => {
    expect(names('sunset beach')).toEqual(['beach sunset.png'])
    expect(names('beach jesen')).toEqual([])
  })
})
