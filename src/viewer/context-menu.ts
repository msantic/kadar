// Right-click menu on the grid, with the Mac's own menu look. It acts on all selected files;
// a right-click on a file outside the selection selects that file first, as in Finder.

import { LogicalPosition } from '@tauri-apps/api/dpi'
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { emit } from './bus'
import { getState } from './store'
import {
  copySelection, openSelectionDefault, optimizeSelection, selectedPaths, trashSelection,
} from './selection'

export async function showContextMenu(x: number, y: number): Promise<void> {
  const paths = selectedPaths()
  if (paths.length === 0) return
  const n = paths.length
  const many = n > 1
  const { entries, selectedPath } = getState()
  const focus = selectedPath ?? paths[0]!
  const focusIndex = entries.findIndex((e) => e.path === focus)

  const separator = (): Promise<PredefinedMenuItem> => PredefinedMenuItem.new({ item: 'Separator' })
  const menu = await Menu.new({
    items: [
      await MenuItem.new({
        text: 'Open',
        action: () => {
          const e = entries[focusIndex]
          if (e?.kind === 'folder') emit('folder:request', { path: e.path })
          else if (focusIndex >= 0) emit('lightbox:open', { index: focusIndex })
        },
      }),
      await MenuItem.new({
        text: many ? `Open ${n} Files in Default App` : 'Open in Default App',
        accelerator: 'Cmd+O',
        action: () => openSelectionDefault(),
      }),
      await MenuItem.new({
        text: 'Show in Finder',
        accelerator: 'Cmd+R',
        action: () => void window.viewer.fs.revealInFinder(focus),
      }),
      await MenuItem.new({
        text: 'Rename',
        enabled: !many,
        action: () => emit('rename:start', undefined),
      }),
      await separator(),
      await MenuItem.new({
        text: many ? `Copy ${n} Files` : 'Copy',
        accelerator: 'Cmd+C',
        action: () => void copySelection(false),
      }),
      await MenuItem.new({
        text: many ? `Copy ${n} Paths` : 'Copy Path',
        accelerator: 'Shift+Cmd+C',
        action: () => void copySelection(true),
      }),
      await separator(),
      await MenuItem.new({
        text: 'Export for Web…',
        accelerator: 'Cmd+E',
        enabled: !many && entries[focusIndex]?.kind === 'image',
        action: () => emit('export:open', { path: focus }),
      }),
      await MenuItem.new({
        text: many ? `Optimize ${n} Files` : 'Optimize',
        accelerator: 'Shift+Cmd+O',
        action: () => void optimizeSelection(),
      }),
      await separator(),
      await MenuItem.new({
        text: 'Move to Trash',
        accelerator: 'Cmd+Backspace',
        action: () => void trashSelection(),
      }),
    ],
  })
  await menu.popup(new LogicalPosition(x, y))
}
