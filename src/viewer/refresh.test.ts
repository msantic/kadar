// Checks for the folder refresh: when the grid redraws, and where the open big view goes.

import { describe, expect, it } from 'vitest'
import { bigViewIndex, sameListing } from './refresh'
import { entry } from './testing'
import type { FileEntry, FolderListing } from './types'

const listing = (files: FileEntry[], folders: string[] = []): FolderListing => ({
  files,
  folders: folders.map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })),
  truncated: false,
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

describe('bigViewIndex', () => {
  const entries = [entry('a.jpg'), entry('b.jpg'), entry('c.jpg')]

  it('follows the open image to its new place', () => {
    expect(bigViewIndex(entries, '/photos/c.jpg')).toBe(2)
  })

  it('closes the big view when the open image is gone', () => {
    expect(bigViewIndex(entries, '/photos/deleted.jpg')).toBeNull()
    expect(bigViewIndex(entries, null)).toBeNull()
  })
})
