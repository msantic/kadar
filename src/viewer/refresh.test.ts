// Checks for the folder refresh: when the grid redraws, what the open big view does, and where
// Kadar goes when the open folder is gone.

import { describe, expect, it } from 'vitest'
import { bigViewAfterRefresh, fileVersion, nearestFolder, sameListing } from './refresh'
import { entry } from './testing'
import type { FileEntry, FolderListing } from './types'

const listing = (files: FileEntry[], folders: string[] = []): FolderListing => ({
  files,
  folders: folders.map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })),
  truncated: false,
  missing: false,
})

describe('sameListing', () => {
  const files = [entry('a.jpg', { mtimeMs: 1, size: 10 }), entry('b.jpg', { mtimeMs: 2, size: 20 })]
  const folders = [{ path: '/photos/trip' }]

  it('skips the redraw when nothing changed, in any order', () => {
    expect(sameListing(files, folders, listing([...files].reverse(), ['/photos/trip']))).toBe(true)
  })

  it('redraws for a new, removed or renamed file', () => {
    expect(sameListing(files, folders, listing([...files, entry('c.jpg')], ['/photos/trip']))).toBe(false)
    expect(sameListing(files, folders, listing([files[0]], ['/photos/trip']))).toBe(false)
    expect(sameListing(files, folders, listing([files[0], { ...files[1], path: '/photos/b2.jpg' }], ['/photos/trip']))).toBe(false)
  })

  it('redraws for an edited file: new date or new size', () => {
    expect(sameListing(files, folders, listing([files[0], { ...files[1], mtimeMs: 3 }], ['/photos/trip']))).toBe(false)
    expect(sameListing(files, folders, listing([files[0], { ...files[1], size: 21 }], ['/photos/trip']))).toBe(false)
  })

  it('redraws for a new or removed subfolder', () => {
    expect(sameListing(files, folders, listing(files, ['/photos/trip', '/photos/new']))).toBe(false)
    expect(sameListing(files, folders, listing(files, []))).toBe(false)
  })
})

describe('fileVersion', () => {
  it('changes with the modified time or the size', () => {
    const a = entry('a.jpg', { mtimeMs: 1, size: 10 })
    expect(fileVersion(a)).toBe(fileVersion({ ...a }))
    expect(fileVersion(a)).not.toBe(fileVersion({ ...a, mtimeMs: 2 }))
    expect(fileVersion(a)).not.toBe(fileVersion({ ...a, size: 11 }))
  })
})

describe('bigViewAfterRefresh', () => {
  const entries = [entry('a.jpg'), entry('b.jpg'), entry('c.jpg', { mtimeMs: 5 })]

  it('follows the open file to its new place', () => {
    expect(bigViewAfterRefresh(entries, entry('b.jpg'))).toEqual({ kind: 'move', index: 1 })
  })

  it('loads the open file again when it was edited', () => {
    expect(bigViewAfterRefresh(entries, entry('c.jpg', { mtimeMs: 4 }))).toEqual({ kind: 'reload', index: 2 })
  })

  it('closes when the open file is gone', () => {
    expect(bigViewAfterRefresh(entries, entry('deleted.jpg'))).toEqual({ kind: 'close' })
    expect(bigViewAfterRefresh(entries, null)).toEqual({ kind: 'close' })
  })
})

describe('nearestFolder', () => {
  it('finds the closest folder above that still exists', async () => {
    const gone = new Set(['/photos/trip/day1', '/photos/trip'])
    expect(await nearestFolder('/photos/trip/day1/raw', async (p) => gone.has(p))).toBe('/photos')
    expect(await nearestFolder('/photos/a', async () => false)).toBe('/photos')
    expect(await nearestFolder('C:\\photos\\a', async () => false)).toBe('C:\\photos')
  })

  it('gives null when nothing above exists (an unplugged disk)', async () => {
    expect(await nearestFolder('/Volumes/Card/DCIM', async () => true)).toBeNull()
    expect(await nearestFolder('/', async () => false)).toBeNull()
  })
})
