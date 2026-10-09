// Right-click menu on the grid, with the Mac's own menu look. It acts on all selected files;
// a right-click on a file outside the selection selects that file first, as in Finder.

import { LogicalPosition } from '@tauri-apps/api/dpi'
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { emit } from './bus'
import { getState } from './store'
import {
  copySelection, exportSelection, openSelectionDefault, optimizeSelection, selectedImages, selectedPaths, trashSelection,
} from './selection'
import { system, words } from '../platform'

/** Opens the menu at window point x, y (CSS px). Does nothing when no file is selected. */
export async function showContextMenu(x: number, y: number): Promise<void> {
  const paths = selectedPaths()
  if (paths.length === 0) return
  const n = paths.length
  const many = n > 1
  const { entries, selectedPath } = getState()
  const focus = selectedPath ?? paths[0]!
  const focusIndex = entries.findIndex((e) => e.path === focus)
  const images = selectedImages().length

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
        accelerator: 'CmdOrCtrl+O',
        action: () => openSelectionDefault(),
      }),
      await MenuItem.new({
        text: words.showInFileManager,
        accelerator: 'CmdOrCtrl+R',
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
        accelerator: 'CmdOrCtrl+C',
        action: () => void copySelection(false),
      }),
      await MenuItem.new({
        text: many ? `Copy ${n} Paths` : 'Copy Path',
        accelerator: 'Shift+CmdOrCtrl+C',
        action: () => void copySelection(true),
      }),
      await separator(),
      await MenuItem.new({
        text: images > 1 ? `Export ${images} Images for Web…` : 'Export for Web…',
        accelerator: 'CmdOrCtrl+E',
        enabled: images > 0,
        action: () => exportSelection(),
      }),
      await MenuItem.new({
        text: many ? `Optimize ${n} Files` : 'Optimize',
        accelerator: 'Shift+CmdOrCtrl+O',
        action: () => void optimizeSelection(),
      }),
      await separator(),
      await MenuItem.new({
        text: `Move to ${words.trash}`,
        accelerator: system === 'mac' ? 'CmdOrCtrl+Backspace' : 'Delete',
        action: () => void trashSelection(),
      }),
    ],
  })
  await menu.popup(new LogicalPosition(x, y))
}
