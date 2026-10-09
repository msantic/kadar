// The viewer's left column: Favorites on top, the Locations folder tree below.

import { createTree } from './tree'
import { createFavorites } from './favorites'

/** Builds the sidebar element. The caller puts it in the page. */
export function createSidebar(): HTMLElement {
  const aside = document.createElement('aside')
  aside.className = 'viewer-sidebar'

  const favSection = createFavorites()
  const treeSection = document.createElement('div')
  treeSection.className = 'viewer-sidebar-section'
  const treeHeader = document.createElement('div')
  treeHeader.className = 'viewer-sidebar-header'
  const treeTitle = document.createElement('span')
  treeTitle.textContent = 'Locations'
  treeHeader.appendChild(treeTitle)
  treeSection.append(treeHeader, createTree())

  aside.append(favSection, treeSection)
  return aside
}
