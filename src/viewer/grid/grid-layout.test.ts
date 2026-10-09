// Checks for the grid math: columns, cell size and total height for any window width.

import { describe, expect, it } from 'vitest'
import { computeLayout, totalHeight } from './grid-layout'

describe('grid layout', () => {
  it('fits as many columns as the target size allows and fills the width', () => {
    const l = computeLayout(1000, 160)
    expect(l.columns).toBe(5)
    // Cells and gaps fill the width, minus the outer gap.
    expect(l.columns * l.cellWidth + (l.columns - 1) * l.gap).toBeLessThanOrEqual(1000 - l.gap)
    expect(l.cellWidth).toBeGreaterThanOrEqual(160)
    expect(l.rowHeight).toBe(l.cellHeight + l.gap)
    expect(l.cellHeight).toBe(l.cellWidth + 24)
  })

  it('keeps one column in a very narrow or hidden window', () => {
    for (const width of [0, 50, -10]) {
      const l = computeLayout(width, 160)
      expect(l.columns).toBe(1)
      expect(l.cellWidth).toBeGreaterThanOrEqual(0)
    }
  })

  it('bigger targets give fewer columns', () => {
    expect(computeLayout(1200, 320).columns).toBeLessThan(computeLayout(1200, 80).columns)
  })

  it('total height counts partial rows and the bottom gap', () => {
    const l = computeLayout(1000, 160)
    expect(totalHeight(0, l)).toBe(l.gap)
    expect(totalHeight(1, l)).toBe(l.rowHeight + l.gap)
    expect(totalHeight(l.columns + 1, l)).toBe(2 * l.rowHeight + l.gap)
  })
})
