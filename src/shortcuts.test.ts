// Checks for Kadar's keys on Windows and Linux: the same commands as the Mac menu bar.

import { describe, expect, it } from 'vitest'
import { commandForKey, isBrowserKey } from './shortcuts'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

describe('shortcuts', () => {
  it('maps Ctrl keys to the menu commands', () => {
    expect(commandForKey(key('1', { ctrlKey: true }), 'windows', false)).toBe('tab:viewer')
    expect(commandForKey(key('O', { ctrlKey: true, shiftKey: true }), 'windows', false)).toBe('optimize')
    expect(commandForKey(key('e', { ctrlKey: true }), 'linux', false)).toBe('export')
    expect(commandForKey(key('ArrowUp', { ctrlKey: true }), 'windows', false)).toBe('go:up')
  })

  it('adds the File Explorer keys', () => {
    expect(commandForKey(key('Delete'), 'windows', false)).toBe('trash')
    expect(commandForKey(key('F2'), 'windows', false)).toBe('rename')
    expect(commandForKey(key('ArrowLeft', { altKey: true }), 'windows', false)).toBe('go:back')
  })

  it('leaves text fields alone, except the tab keys', () => {
    expect(commandForKey(key('Delete'), 'windows', true)).toBeNull()
    expect(commandForKey(key('c', { ctrlKey: true }), 'windows', true)).toBeNull()
    expect(commandForKey(key('2', { ctrlKey: true }), 'windows', true)).toBe('tab:optimize')
  })

  it('does nothing on the Mac, where the menu bar has the keys', () => {
    expect(commandForKey(key('e', { ctrlKey: true }), 'mac', false)).toBeNull()
  })

  it('stops the browser engine’s own keys', () => {
    expect(isBrowserKey(key('r', { ctrlKey: true }))).toBe(true)
    expect(isBrowserKey(key('F5'))).toBe(true)
    expect(isBrowserKey(key('ArrowLeft', { altKey: true }))).toBe(true)
    expect(isBrowserKey(key('c', { ctrlKey: true }))).toBe(false)
  })
})
