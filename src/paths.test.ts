// Checks for the path helpers: Mac and Linux paths, and Windows drive paths.

import { describe, expect, it } from 'vitest'
import { baseName, crumbs, joinPath, parentOf } from './paths'

describe('paths', () => {
  it('names the last part', () => {
    expect(baseName('/photos/a.jpg')).toBe('a.jpg')
    expect(baseName('C:\\photos\\a.jpg')).toBe('a.jpg')
    expect(baseName('/photos/')).toBe('photos')
  })

  it('finds the parent folder, also at the top', () => {
    expect(parentOf('/Users/me')).toBe('/Users')
    expect(parentOf('/Users')).toBe('/')
    expect(parentOf('/')).toBeNull()
    expect(parentOf('C:\\Users\\me')).toBe('C:\\Users')
    expect(parentOf('C:\\Users')).toBe('C:\\')
    expect(parentOf('C:\\')).toBeNull()
  })

  it('joins with the path’s own separator', () => {
    expect(joinPath('/photos', 'optimized')).toBe('/photos/optimized')
    expect(joinPath('C:\\photos', 'optimized')).toBe('C:\\photos\\optimized')
    expect(joinPath('C:\\', 'photos')).toBe('C:\\photos')
  })

  it('splits a path for the path bar', () => {
    expect(crumbs('/Users/me')).toEqual([{ name: 'Users', path: '/Users' }, { name: 'me', path: '/Users/me' }])
    expect(crumbs('C:\\Users\\me')).toEqual([
      { name: 'C:', path: 'C:\\' }, { name: 'Users', path: 'C:\\Users' }, { name: 'me', path: 'C:\\Users\\me' },
    ])
  })
})
