// Checks for the right-click menu: it is made once and reused, so a Kadar open for days does not
// keep a new menu for every right-click; the labels and the Open action follow the latest click.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const made = vi.hoisted(() => ({ menus: 0, items: [] as { text: string, enabled: boolean, action?: () => void }[] }))

vi.mock('@tauri-apps/api/menu', () => {
  class FakeItem {
    text: string
    enabled = true
    action?: () => void
    constructor(o: { text?: string, action?: () => void }) {
      this.text = o.text ?? ''
      this.action = o.action
      made.items.push(this)
    }
    async setText(t: string): Promise<void> { this.text = t }
    async setEnabled(e: boolean): Promise<void> { this.enabled = e }
  }
  return {
    MenuItem: { new: async (o: { text: string, action?: () => void }) => new FakeItem(o) },
    PredefinedMenuItem: { new: async () => new FakeItem({ text: '---' }) },
    Menu: { new: async () => { made.menus++; return { popup: async () => {} } } },
  }
})

const rotated: { paths: string[]; clockwise: boolean }[] = []
;(window as unknown as { viewer: unknown }).viewer = {
  fs: {
    canRotate: async () => true,
    rotate: async (paths: string[], clockwise: boolean) => {
      rotated.push({ paths, clockwise })
      return paths.map((path) => ({ path, error: null }))
    },
  },
}

const { showContextMenu } = await import('./context-menu')
const { setState } = await import('./store')
const { on } = await import('./bus')
const { entry } = await import('./testing')

const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((n) => entry(n))
const item = (start: string) => made.items.find((i) => i.text.startsWith(start))!

describe('right-click menu', () => {
  beforeEach(() => {
    setState({ entries: files })
  })

  it('is made once and reused for every right-click', async () => {
    setState({ selection: new Set([files[0]!.path]), selectedPath: files[0]!.path })
    await showContextMenu(10, 10)
    const count = made.items.length
    setState({ selection: new Set(files.map((f) => f.path)), selectedPath: files[2]!.path })
    await showContextMenu(10, 10)
    await showContextMenu(10, 10)
    expect(made.menus).toBe(1)
    expect(made.items.length).toBe(count)
  })

  it('shows the labels of the latest selection', async () => {
    setState({ selection: new Set(files.map((f) => f.path)), selectedPath: files[2]!.path })
    await showContextMenu(10, 10)
    expect(item('Copy ').text).toBe('Copy 3 Files')
    expect(item('Rename').enabled).toBe(false)
    setState({ selection: new Set([files[1]!.path]), selectedPath: files[1]!.path })
    await showContextMenu(10, 10)
    expect(made.items.some((i) => i.text === 'Copy')).toBe(true)
    expect(item('Rename').enabled).toBe(true)
  })

  it('Open opens the file of the latest right-click', async () => {
    const opened: number[] = []
    const off = on('lightbox:open', ({ index }) => opened.push(index))
    setState({ selection: new Set([files[0]!.path]), selectedPath: files[0]!.path })
    await showContextMenu(10, 10)
    setState({ selection: new Set([files[2]!.path]), selectedPath: files[2]!.path })
    await showContextMenu(10, 10)
    item('Open').action!()
    off()
    expect(opened).toEqual([2])
  })

  it('Rotate Left and Right turn the selected photos, and are off without a photo', async () => {
    setState({ selection: new Set([files[0]!.path, files[2]!.path]), selectedPath: files[0]!.path })
    await showContextMenu(10, 10)
    item('Rotate Right').action!()
    item('Rotate Left').action!()
    await vi.waitFor(() => expect(rotated).toHaveLength(2))
    expect(rotated[0]).toEqual({ paths: [files[0]!.path, files[2]!.path], clockwise: true })
    expect(rotated[1]!.clockwise).toBe(false)

    setState({ entries: [entry('clip.mp4', { kind: 'video' })], selection: new Set(['/photos/clip.mp4']), selectedPath: '/photos/clip.mp4' })
    await showContextMenu(10, 10)
    expect(item('Rotate Right').enabled).toBe(false)
  })
})
