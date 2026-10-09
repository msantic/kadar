// Checks for the shared text formats: file sizes and the "smaller by" percent.

import { describe, expect, it } from 'vitest'
import { formatBytes, savingPercent } from './format'

describe('format', () => {
  it('writes sizes in B, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(84 * 1024 + 300)).toBe('84 KB')
    expect(formatBytes(3.24 * 1024 * 1024)).toBe('3.2 MB')
  })

  it('gives the saving in whole percent, never 100 and never below 0', () => {
    expect(savingPercent(1000, 250)).toBe(75)
    expect(savingPercent(1000, 1)).toBe(99)
    expect(savingPercent(1000, 0)).toBe(99)
    expect(savingPercent(1000, 1500)).toBe(0)
    expect(savingPercent(0, 10)).toBe(0)
  })
})
