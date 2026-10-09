// The viewer's left column: Favorites on top, the Locations folder tree below, and Kadar's
// version at the bottom (the one place it shows on every system; the Mac also has About Kadar).

import { getVersion } from '@tauri-apps/api/app'
import { createTree } from './tree'
import { createFavorites } from './favorites'

/** The muted "Kadar 1.0.0" line at the bottom of the sidebar. `load` reads the app's version;
 *  the line stays empty when it cannot. */
export function createVersionLine(load: () => Promise<string> = getVersion): HTMLElement {
  const line = document.createElement('div')
  line.className = 'viewer-sidebar-version'
  void load().then((v) => { line.textContent = `Kadar ${v}` }, () => {})
  return line
}

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

  aside.append(favSection, treeSection, createVersionLine())
  return aside
}
