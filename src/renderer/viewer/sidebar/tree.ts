import { api } from '../ipc'
import { emit } from '../bus'
import type { FolderEntry } from '../types'

interface Node {
  entry: FolderEntry
  el: HTMLLIElement
  childrenEl: HTMLUListElement
  childrenLoaded: boolean
  expanded: boolean
}

export function createTree(): HTMLElement {
  const root = document.createElement('ul')
  root.className = 'viewer-tree'

  void api.fs.getRoots().then((roots) => {
    const items: FolderEntry[] = [
      { name: 'Home',      path: roots.home },
      { name: 'Pictures',  path: roots.pictures },
      { name: 'Desktop',   path: roots.desktop },
      { name: 'Downloads', path: roots.downloads },
      { name: 'Movies',    path: roots.movies },
    ]
    for (const item of items) root.appendChild(makeNode(item, 0))
  })

  return root
}

function makeNode(entry: FolderEntry, depth: number): HTMLLIElement {
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

  const node: Node = { entry, el: li, childrenEl, childrenLoaded: false, expanded: false }

  row.addEventListener('click', (e) => {
    const isCaret = e.target === caret
    if (isCaret) {
      toggle(node, depth)
    } else {
      emit('folder:request', { path: entry.path })
      markActive(row)
    }
  })

  caret.addEventListener('click', (e) => {
    e.stopPropagation()
    toggle(node, depth)
  })

  li.append(row, childrenEl)
  return li
}

let activeRow: HTMLElement | null = null
function markActive(row: HTMLElement): void {
  activeRow?.classList.remove('active')
  row.classList.add('active')
  activeRow = row
}

async function toggle(node: Node, depth: number): Promise<void> {
  node.expanded = !node.expanded
  node.childrenEl.hidden = !node.expanded
  node.el.querySelector('.viewer-tree-caret')!.classList.toggle('open', node.expanded)
  if (node.expanded && !node.childrenLoaded) {
    node.childrenLoaded = true
    const kids = await api.fs.listTreeChildren(node.entry.path)
    for (const k of kids) node.childrenEl.appendChild(makeNode(k, depth + 1))
  }
}
