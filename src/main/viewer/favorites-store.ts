import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import { favoritesFile } from './paths'

export interface Favorite {
  id: string
  path: string
  label: string
  addedAt: number
  kind: 'folder'
}

interface StoreShape {
  version: 1
  favorites: Favorite[]
}

let cache: StoreShape | null = null

async function load(): Promise<StoreShape> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(favoritesFile(), 'utf8')
    const parsed = JSON.parse(raw) as StoreShape
    if (parsed && parsed.version === 1 && Array.isArray(parsed.favorites)) {
      cache = parsed
      return cache
    }
  } catch {}
  cache = { version: 1, favorites: [] }
  return cache
}

async function save(): Promise<void> {
  if (!cache) return
  const file = favoritesFile()
  await fs.ensureDir(path.dirname(file))
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function listFavorites(): Promise<Favorite[]> {
  const s = await load()
  return s.favorites
}

export async function addFavorite(p: string): Promise<Favorite> {
  const s = await load()
  const existing = s.favorites.find((f) => f.path === p)
  if (existing) return existing
  const fav: Favorite = {
    id: crypto.randomUUID(),
    path: p,
    label: path.basename(p) || p,
    addedAt: Date.now(),
    kind: 'folder',
  }
  s.favorites.push(fav)
  await save()
  return fav
}

export async function removeFavorite(id: string): Promise<void> {
  const s = await load()
  s.favorites = s.favorites.filter((f) => f.id !== id)
  await save()
}

export async function renameFavorite(id: string, label: string): Promise<Favorite | null> {
  const s = await load()
  const f = s.favorites.find((x) => x.id === id)
  if (!f) return null
  f.label = label
  await save()
  return f
}
