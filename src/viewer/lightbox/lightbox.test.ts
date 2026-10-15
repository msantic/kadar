// Checks for the big view: closing it lets the window free the shown photo and the last video,
// so a Kadar open for days does not keep a full-size picture or a video player alive.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emit } from '../bus'
import { setState } from '../store'
import { entry } from '../testing'
import { createLightbox } from './lightbox'

// The test page cannot decode pictures, play media or watch sizes: stand-ins, and count the unloads.
globalThis.ResizeObserver = class { observe(): void {} unobserve(): void {} disconnect(): void {} }
HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined)
const load = vi.fn()
HTMLMediaElement.prototype.load = load
HTMLMediaElement.prototype.pause = vi.fn()
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)

;(window as unknown as { viewer: unknown }).viewer = {
  meta: { get: vi.fn().mockResolvedValue({}), properties: vi.fn().mockResolvedValue(null), openUrl: vi.fn() },
}

const files = [entry('a.jpg'), entry('clip.mp4', { kind: 'video' })]
const big = createLightbox()
document.body.append(big.root)
const shownImage = (): HTMLImageElement => big.root.querySelector('.viewer-lightbox-img')!
const video = (): HTMLVideoElement => big.root.querySelector('video')!

describe('big view', () => {
  beforeEach(() => {
    setState({ entries: files, selection: new Set(), selectedPath: null })
    load.mockClear()
  })

  it('frees the shown photo on close', () => {
    emit('lightbox:open', { index: 0 })
    expect(shownImage().getAttribute('src')).toContain('a.jpg')
    emit('lightbox:close', undefined)
    expect(shownImage().hasAttribute('src')).toBe(false)
  })

  it('unloads the video on close', () => {
    emit('lightbox:open', { index: 1 })
    expect(video().getAttribute('src')).toContain('clip.mp4')
    emit('lightbox:close', undefined)
    expect(video().hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalled()
  })

  it('unloads the video when the next file is a photo', () => {
    emit('lightbox:open', { index: 1 })
    emit('lightbox:open', { index: 0 })
    expect(video().hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
    expect(shownImage().getAttribute('src')).toContain('a.jpg')
    emit('lightbox:close', undefined)
  })
})
