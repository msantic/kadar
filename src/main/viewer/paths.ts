import { app } from 'electron'
import path from 'path'

export function cacheDir(): string {
  return path.join(app.getPath('userData'), 'thumb-cache')
}

export function favoritesFile(): string {
  return path.join(app.getPath('userData'), 'viewer-favorites.json')
}

export interface DefaultRoots {
  home: string
  pictures: string
  desktop: string
  downloads: string
  movies: string
}

export function defaultRoots(): DefaultRoots {
  return {
    home:      app.getPath('home'),
    pictures:  app.getPath('pictures'),
    desktop:   app.getPath('desktop'),
    downloads: app.getPath('downloads'),
    movies:    app.getPath('videos'),
  }
}
