// Checks for the Locations tree: subfolders follow the disk. The grid's folder updates its
// subfolders in the tree at once, and opening a folder in the tree lists it again.

import { describe, expect, it, vi } from 'vitest'

const children = vi.hoisted(() => new Map<string, { name: string; path: string }[]>())

vi.mock('../ipc', () => ({
  api: {
    fs: {
      getRoots: async () => ({ home: '/me', pictures: '/me/Pictures', desktop: '/me/Desktop', downloads: '/me/Downloads', movies: '/me/Movies' }),
      listTreeChildren: async (dir: string) => children.get(dir) ?? [],
    },
  },
}))

const { createTree } = await import('./tree')
const { setState } = await import('../store')

const folder = (path: string): { name: string; path: string } => ({ name: path.slice(path.lastIndexOf('/') + 1), path })
const names = (li: Element | undefined): string[] =>
  [...(li?.querySelector(':scope > .viewer-tree-children')?.children ?? [])].map((c) => c.querySelector('.viewer-tree-label')!.textContent!)
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('folder tree', () => {
  it('follows the subfolders of the folder open in the grid, and lists again when opened', async () => {
    const tree = createTree()
    await vi.waitFor(() => expect(tree.children.length).toBe(5))
    const pictures = tree.children[1]!
    children.set('/me/Pictures', [folder('/me/Pictures/2024'), folder('/me/Pictures/2025')])
    children.set('/me/Pictures/2024', [folder('/me/Pictures/2024/Trip')])
    pictures.querySelector<HTMLElement>('.viewer-tree-caret')!.click()
    await vi.waitFor(() => expect(names(pictures)).toEqual(['2024', '2025']))
    const y2024 = pictures.querySelector(':scope > .viewer-tree-children')!.children[0]!
    y2024.querySelector<HTMLElement>('.viewer-tree-caret')!.click()
    await vi.waitFor(() => expect(names(y2024)).toEqual(['Trip']))

    // The grid shows Pictures; on disk 2025 was renamed to 2026.
    setState({ currentFolder: '/me/Pictures', loading: false, folders: [folder('/me/Pictures/2024'), folder('/me/Pictures/2026')] })
    expect(names(pictures)).toEqual(['2024', '2026'])
    const kept = pictures.querySelector(':scope > .viewer-tree-children')!.children[0]!
    expect(kept).toBe(y2024) // a folder that stays keeps its open subfolders
    expect(names(kept)).toEqual(['Trip'])

    // Closed, changed on disk, opened again: the tree lists it again.
    const caret = pictures.querySelector<HTMLElement>(':scope > .viewer-tree-row .viewer-tree-caret')!
    caret.click()
    children.set('/me/Pictures', [folder('/me/Pictures/2024'), folder('/me/Pictures/2026'), folder('/me/Pictures/2027')])
    caret.click()
    await vi.waitFor(() => expect(names(pictures)).toEqual(['2024', '2026', '2027']))
    await settle()
  })
})
