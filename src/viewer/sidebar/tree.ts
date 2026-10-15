// The sidebar's Locations: a folder tree under Home, Pictures, Desktop, Downloads and Movies
// (Videos on Windows and Linux).
// Subfolders load from Rust each time a folder opens in the tree. The folder shown in the grid
// is marked, and its subfolders follow the disk: when the grid's folder gains, loses or renames a
// subfolder, the tree shows it at once. Open folders are kept in the session.

import { api } from '../ipc'
import { emit } from '../bus'
import { getState, subscribe } from '../store'
import { getSession, updateSession } from '../session'
import type { FolderEntry } from '../types'
import { words } from '../../platform'

interface Node {
  entry: FolderEntry
  depth: number
  el: HTMLLIElement
  row: HTMLElement
  caret: HTMLElement
  childrenEl: HTMLUListElement
  children: Node[] | null
  expanded: boolean
}

// Every node by folder path, to mark the folder shown in the grid and to update its subfolders.
// One folder can show twice (for example Pictures at the top and inside Home).
const nodesByPath = new Map<string, Set<Node>>()
// Folders that are open, kept in the session so they open again on the next start.
const expanded = new Set<string>(getSession().expanded)

/** Builds the tree. The root folders arrive from Rust a moment later. */
export function createTree(): HTMLElement {
  const root = document.createElement('ul')
  root.className = 'viewer-tree'

  void api.fs.getRoots().then(async (roots) => {
    const items: FolderEntry[] = [
      { name: 'Home',      path: roots.home },
      { name: 'Pictures',  path: roots.pictures },
      { name: 'Desktop',   path: roots.desktop },
      { name: 'Downloads', path: roots.downloads },
      { name: words.videos, path: roots.movies },
    ]
    const nodes = items.map((item) => makeNode(item, 0))
    for (const node of nodes) root.appendChild(node.el)
    await reopen(nodes)
    markActive(getState().currentFolder)
  })

  subscribe((s, prev) => {
    if (s.currentFolder !== prev.currentFolder) markActive(s.currentFolder)
    // The grid listed its folder again (opened or changed on disk): its subfolders here follow.
    if (s.folders !== prev.folders && s.currentFolder && !s.loading) {
      for (const node of nodesByPath.get(s.currentFolder) ?? []) {
        if (node.children) syncChildren(node, s.folders)
      }
    }
  })

  return root
}

/** Opens the folders that were open last time, top down. */
async function reopen(nodes: Node[]): Promise<void> {
  for (const node of nodes) {
    if (!expanded.has(node.entry.path)) continue
    await setExpanded(node, true)
    if (node.children) await reopen(node.children)
  }
}

function makeNode(entry: FolderEntry, depth: number): Node {
  const li = document.createElement('li')
  li.className = 'viewer-tree-node'

  const row = document.createElement('div')
  row.className = 'viewer-tree-row'
  row.style.paddingLeft = `${8 + depth * 14}px`

  const caret = document.createElement('span')
  caret.className = 'viewer-tree-caret'
  caret.textContent = '▸'

  const label = document.createElement('span')
  label.className = 'viewer-tree-label'
  label.textContent = entry.name
  label.title = entry.path

  row.append(caret, label)

  const childrenEl = document.createElement('ul')
  childrenEl.className = 'viewer-tree-children'
  childrenEl.hidden = true

  const node: Node = { entry, depth, el: li, row, caret, childrenEl, children: null, expanded: false }
  const same = nodesByPath.get(entry.path) ?? new Set<Node>()
  same.add(node)
  nodesByPath.set(entry.path, same)

  row.addEventListener('click', () => emit('folder:request', { path: entry.path }))
  caret.addEventListener('click', (e) => {
    e.stopPropagation()
    void setExpanded(node, !node.expanded)
  })

  li.append(row, childrenEl)
  return node
}

function markActive(path: string | null): void {
  for (const same of nodesByPath.values()) for (const node of same) node.row.classList.remove('active')
  if (path) for (const node of nodesByPath.get(path) ?? []) node.row.classList.add('active')
}

/** Removes a node and everything under it from the lookup, once its folder is gone. */
function forget(node: Node): void {
  const same = nodesByPath.get(node.entry.path)
  same?.delete(node)
  if (same?.size === 0) nodesByPath.delete(node.entry.path)
  for (const child of node.children ?? []) forget(child)
}

/** Shows `kids` under `node`, in their order. Folders that stay keep their node, so they stay
 *  open with their own subfolders; new ones are added and gone ones removed. */
function syncChildren(node: Node, kids: FolderEntry[]): void {
  const old = new Map((node.children ?? []).map((c) => [c.entry.path, c]))
  const next = kids.map((k) => old.get(k.path) ?? makeNode(k, node.depth + 1))
  for (const [path, child] of old) if (!kids.some((k) => k.path === path)) forget(child)
  node.children = next
  node.childrenEl.replaceChildren(...next.map((c) => c.el))
  // A folder shown in the grid may sit inside this one.
  markActive(getState().currentFolder)
}

async function setExpanded(node: Node, open: boolean): Promise<void> {
  node.expanded = open
  node.childrenEl.hidden = !open
  node.caret.classList.toggle('open', open)
  if (open) expanded.add(node.entry.path)
  else expanded.delete(node.entry.path)
  updateSession({ expanded: [...expanded] })

  // List again at each opening: subfolders may have changed on disk while it was closed.
  if (open) {
    const kids = await api.fs.listTreeChildren(node.entry.path)
    if (node.expanded) syncChildren(node, kids)
  }
}
