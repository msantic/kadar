// Checks for the system helper: the command key, key labels and words per system.

import { describe, expect, it } from 'vitest'
import { commandKeyFor, detectSystem, keyLabelFor, wordsFor } from './platform'

describe('platform', () => {
  it('tells the systems apart', () => {
    expect(detectSystem('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('mac')
    expect(detectSystem('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/154.0')).toBe('windows')
    expect(detectSystem('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15')).toBe('linux')
  })

  it('uses ⌘ on the Mac and Ctrl elsewhere', () => {
    const cmd = { metaKey: true, ctrlKey: false }
    const ctrl = { metaKey: false, ctrlKey: true }
    expect(commandKeyFor('mac', cmd)).toBe(true)
    expect(commandKeyFor('mac', ctrl)).toBe(false)
    expect(commandKeyFor('windows', ctrl)).toBe(true)
    expect(commandKeyFor('linux', cmd)).toBe(false)
    expect(keyLabelFor('mac', 'C', true)).toBe('⇧⌘C')
    expect(keyLabelFor('windows', 'C', true)).toBe('Ctrl+Shift+C')
  })

  it('names the file manager and the trash as each system does', () => {
    expect(wordsFor('mac').showInFileManager).toBe('Show in Finder')
    expect(wordsFor('windows').showInFileManager).toBe('Show in File Explorer')
    expect(wordsFor('windows').trash).toBe('Recycle Bin')
    expect(wordsFor('linux').fileManager).toBe('Files')
  })
})
