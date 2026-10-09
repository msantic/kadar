// The sidebar's Locations: a folder tree under Home, Pictures, Desktop, Downloads and Movies.
// Subfolders load from Rust when a folder first opens. Open folders are kept in the session;
// the folder shown in the grid is marked.

import { api } from '../ipc'
import { emit } from '../bus'
import { getState, subscribe } from '../store'
import { getSession, updateSession } from '../session'
import type { FolderEntry } from '../types'

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

// Every row by folder path, to mark the folder shown in the grid.
const rowsByPath = new Map<string, Set<HTMLElement>>()
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
      { name: 'Movies',    path: roots.movies },
    ]
    const nodes = items.map((item) => makeNode(item, 0))
    for (const node of nodes) root.appendChild(node.el)
    await reopen(nodes)
    markActive(getState().currentFolder)
  })

  subscribe((s, prev) => {
    if (s.currentFolder !== prev.currentFolder) markActive(s.currentFolder)
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
  // One folder can show twice (for example Pictures at the top and inside Home): mark both.
  const rows = rowsByPath.get(entry.path) ?? new Set<HTMLElement>()
  rows.add(row)
  rowsByPath.set(entry.path, rows)

  row.addEventListener('click', () => emit('folder:request', { path: entry.path }))
  caret.addEventListener('click', (e) => {
    e.stopPropagation()
    void setExpanded(node, !node.expanded)
  })

  li.append(row, childrenEl)
  return node
}

function markActive(path: string | null): void {
  for (const rows of rowsByPath.values()) for (const row of rows) row.classList.remove('active')
  if (path) for (const row of rowsByPath.get(path) ?? []) row.classList.add('active')
}

async function setExpanded(node: Node, open: boolean): Promise<void> {
  node.expanded = open
  node.childrenEl.hidden = !open
  node.caret.classList.toggle('open', open)
  if (open) expanded.add(node.entry.path)
  else expanded.delete(node.entry.path)
  updateSession({ expanded: [...expanded] })

  if (open && !node.children) {
    const kids = await api.fs.listTreeChildren(node.entry.path)
    node.children = kids.map((k) => makeNode(k, node.depth + 1))
    for (const child of node.children) node.childrenEl.appendChild(child.el)
    // A folder shown in the grid may sit inside the folder that just opened.
    markActive(getState().currentFolder)
  }
}
