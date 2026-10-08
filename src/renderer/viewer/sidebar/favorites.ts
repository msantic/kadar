import { api } from '../ipc'
import { emit } from '../bus'
import { getState, setState, subscribe } from '../store'
import type { Favorite } from '../types'

export function createFavorites(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'viewer-favorites'

  const header = document.createElement('div')
  header.className = 'viewer-sidebar-header'
  const title = document.createElement('span')
  title.textContent = 'Favorites'
  const addBtn = document.createElement('button')
  addBtn.className = 'viewer-ghost-btn'
  addBtn.title = 'Add current folder'
  addBtn.textContent = '+'
  header.append(title, addBtn)

  const list = document.createElement('ul')
  list.className = 'viewer-favorites-list'

  addBtn.addEventListener('click', async () => {
    const cur = getState().currentFolder
    const target = cur ?? await api.fs.chooseFolder()
    if (!target) return
    const fav = await api.favorites.add(target)
    setState({ favorites: [...getState().favorites, fav] })
  })

  void api.favorites.list().then((favs) => setState({ favorites: favs }))

  subscribe((s, prev) => {
    if (s.favorites !== prev.favorites) render(list, s.favorites)
  })
  render(list, getState().favorites)

  wrap.append(header, list)
  return wrap
}

function render(list: HTMLElement, favs: Favorite[]): void {
  list.innerHTML = ''
  if (favs.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'viewer-favorites-empty'
    empty.textContent = 'No favorites yet'
    list.appendChild(empty)
    return
  }
  for (const fav of favs) {
    const li = document.createElement('li')
    li.className = 'viewer-favorite-item'
    li.title = fav.path

    const label = document.createElement('span')
    label.textContent = fav.label
    label.className = 'viewer-favorite-label'
    label.addEventListener('click', () => emit('folder:request', { path: fav.path }))

    const remove = document.createElement('button')
    remove.className = 'viewer-ghost-btn'
    remove.textContent = '×'
    remove.title = 'Remove'
    remove.addEventListener('click', async () => {
      await api.favorites.remove(fav.id)
      setState({ favorites: getState().favorites.filter((f) => f.id !== fav.id) })
    })

    li.append(label, remove)
    list.appendChild(li)
  }
}
