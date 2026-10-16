// Right-click menu on the grid, with the Mac's own menu look. It acts on all selected files;
// a right-click on a file outside the selection selects that file first, as in Finder.
// The menu is made once and only its labels change: Tauri keeps every menu it ever made (and its
// actions, which hold the file list) until the app quits, so a new menu per right-click grows
// without end in a Kadar that stays open for days.

import { LogicalPosition } from '@tauri-apps/api/dpi'
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { emit } from './bus'
import { getState } from './store'
import {
  copySelection, exportSelection, openSelectionDefault, optimizeSelection, rotateSelection, selectedImages, selectedPaths,
  trashSelection,
} from './selection'
import { system, words } from '../platform'
import type { FileEntry } from './types'

/** What the open menu acts on, set at each right-click. */
interface Target {
  entries: FileEntry[]
  focus: string
  focusIndex: number
}

interface Built {
  menu: Menu
  openDefault: MenuItem
  rename: MenuItem
  /** Rotate Left and Right; null on a system that cannot turn photos on disk. */
  rotate: [MenuItem, MenuItem] | null
  copy: MenuItem
  copyPaths: MenuItem
  exportWeb: MenuItem
  optimize: MenuItem
}

let target: Target | null = null
let built: Promise<Built> | null = null

async function build(): Promise<Built> {
  const separator = (): Promise<PredefinedMenuItem> => PredefinedMenuItem.new({ item: 'Separator' })
  const open = await MenuItem.new({
    text: 'Open',
    action: () => {
      if (!target) return
      const e = target.entries[target.focusIndex]
      if (e?.kind === 'folder') emit('folder:request', { path: e.path })
      else if (target.focusIndex >= 0) emit('lightbox:open', { index: target.focusIndex })
    },
  })
  const openDefault = await MenuItem.new({ text: 'Open in Default App', accelerator: 'CmdOrCtrl+O', action: () => openSelectionDefault() })
  const reveal = await MenuItem.new({
    text: words.showInFileManager,
    accelerator: system === 'mac' ? 'Shift+CmdOrCtrl+R' : 'CmdOrCtrl+R',
    action: () => { if (target) void window.viewer.fs.revealInFinder(target.focus) },
  })
  const rename = await MenuItem.new({ text: 'Rename', action: () => emit('rename:start', undefined) })
  const rotate: [MenuItem, MenuItem] | null = (await window.viewer.fs.canRotate().catch(() => false))
    ? [
        await MenuItem.new({ text: 'Rotate Left', accelerator: 'CmdOrCtrl+L', action: () => void rotateSelection(false) }),
        await MenuItem.new({ text: 'Rotate Right', accelerator: 'CmdOrCtrl+R', action: () => void rotateSelection(true) }),
      ]
    : null
  const copy = await MenuItem.new({ text: 'Copy', accelerator: 'CmdOrCtrl+C', action: () => void copySelection(false) })
  const copyPaths = await MenuItem.new({ text: 'Copy Path', accelerator: 'Shift+CmdOrCtrl+C', action: () => void copySelection(true) })
  const exportWeb = await MenuItem.new({ text: 'Export for Web…', accelerator: 'CmdOrCtrl+E', action: () => exportSelection() })
  const optimize = await MenuItem.new({ text: 'Optimize', accelerator: 'Shift+CmdOrCtrl+O', action: () => void optimizeSelection() })
  const trash = await MenuItem.new({
    text: `Move to ${words.trash}`,
    accelerator: system === 'mac' ? 'CmdOrCtrl+Backspace' : 'Delete',
    action: () => void trashSelection(),
  })
  const menu = await Menu.new({
    items: [
      open, openDefault, reveal, rename, await separator(),
      ...(rotate ? [...rotate, await separator()] : []),
      copy, copyPaths, await separator(),
      exportWeb, optimize, await separator(),
      trash,
    ],
  })
  return { menu, openDefault, rename, rotate, copy, copyPaths, exportWeb, optimize }
}

/** Opens the menu at window point x, y (CSS px). Does nothing when no file is selected. */
export async function showContextMenu(x: number, y: number): Promise<void> {
  const paths = selectedPaths()
  if (paths.length === 0) return
  const n = paths.length
  const many = n > 1
  const { entries, selectedPath } = getState()
  const focus = selectedPath ?? paths[0]!
  target = { entries, focus, focusIndex: entries.findIndex((e) => e.path === focus) }
  const images = selectedImages().length

  // A failed first build is tried again at the next right-click.
  built ??= build().catch((e: unknown) => { built = null; throw e })
  const m = await built
  await Promise.all([
    m.openDefault.setText(many ? `Open ${n} Files in Default App` : 'Open in Default App'),
    m.rename.setEnabled(!many),
    ...(m.rotate ?? []).map((item) => item.setEnabled(images > 0)),
    m.copy.setText(many ? `Copy ${n} Files` : 'Copy'),
    m.copyPaths.setText(many ? `Copy ${n} Paths` : 'Copy Path'),
    m.exportWeb.setText(images > 1 ? `Export ${images} Images for Web…` : 'Export for Web…'),
    m.exportWeb.setEnabled(images > 0),
    m.optimize.setText(many ? `Optimize ${n} Files` : 'Optimize'),
  ])
  await m.menu.popup(new LogicalPosition(x, y))
}
