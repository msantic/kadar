// Checks for the sidebar's version line: it shows the app's version, and nothing when unknown.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('9.9.9') }))
vi.mock('./tree', () => ({ createTree: () => document.createElement('ul') }))
vi.mock('./favorites', () => ({ createFavorites: () => document.createElement('div') }))

const { createVersionLine } = await import('./sidebar')

describe('version line', () => {
  it('shows "Kadar" and the version', async () => {
    const line = createVersionLine(() => Promise.resolve('1.0.0'))
    await vi.waitFor(() => expect(line.textContent).toBe('Kadar 1.0.0'))
  })

  it('stays empty when the version cannot be read', async () => {
    const line = createVersionLine(() => Promise.reject(new Error('no app')))
    await new Promise((r) => setTimeout(r, 0))
    expect(line.textContent).toBe('')
  })
})
