// Checks for the info panel: what it shows from the image details the Mac reads, and that it
// remembers whether it was open.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entry } from '../testing'
import { createInfoPanel } from './info'

function details(): Record<string, unknown> {
  return {
    PixelWidth: 6000, PixelHeight: 4000, Orientation: 6, Depth: 8, ProfileName: 'Display P3', ColorModel: 'RGB',
    '{TIFF}': { Make: 'Canon', Model: 'Canon EOS R6', Software: 'Lightroom' },
    '{Exif}': {
      DateTimeOriginal: '2025:01:03 15:47:35', FNumber: 2.8, ExposureTime: 0.004, ISOSpeedRatings: [400],
      FocalLength: 35, ExposureBiasValue: -0.7, Flash: 16, LensModel: 'RF35mm F1.8',
    },
    '{GPS}': { Latitude: 45.815, LatitudeRef: 'N', Longitude: 15.982, LongitudeRef: 'E', Altitude: 122.4 },
  }
}

function stubViewer(props: Record<string, unknown> | null): void {
  ;(window as unknown as { viewer: unknown }).viewer = {
    meta: {
      get: vi.fn().mockResolvedValue({ width: 1, height: 1, durationMs: null }),
      properties: vi.fn().mockResolvedValue(props),
      openUrl: vi.fn(),
    },
  }
}

async function shown(props: Record<string, unknown> | null): Promise<string> {
  stubViewer(props)
  const panel = createInfoPanel(() => {})
  if (!panel.isOpen()) panel.toggle()
  panel.show(entry('IMG_1.jpg', { size: 3 * 1024 * 1024, mtimeMs: Date.UTC(2025, 0, 4) }))
  await vi.waitFor(() => expect(panel.root.textContent).toContain('IMG_1.jpg'))
  return panel.root.textContent ?? ''
}

describe('info panel', () => {
  beforeEach(() => localStorage.clear())

  it('shows file, camera, place and color details', async () => {
    const text = await shown(details())
    expect(text).toContain('4000 × 6000') // turned photo: width and height swap
    expect(text).toContain('24.0 MP')
    expect(text).toContain('3.0 MB')
    expect(text).toContain('Canon EOS R6') // the make is not repeated
    expect(text).not.toContain('Canon Canon')
    expect(text).toContain('ƒ/2.8')
    expect(text).toContain('1/250 s')
    expect(text).toContain('ISO 400')
    expect(text).toContain('-0.7 EV')
    expect(text).toContain('Off') // flash bit 0 not set
    expect(text).toContain('45.81500° N, 15.98200° E')
    expect(text).toContain('122 m')
    expect(text).toContain('Display P3')
  })

  it('leaves out sections with nothing to show', async () => {
    const text = await shown(null)
    expect(text).toContain('File')
    expect(text).not.toContain('Camera')
    expect(text).not.toContain('Place')
  })

  it('remembers if it was open', () => {
    stubViewer(null)
    const a = createInfoPanel(() => {})
    expect(a.isOpen()).toBe(false)
    a.toggle()
    expect(createInfoPanel(() => {}).isOpen()).toBe(true)
  })
})
