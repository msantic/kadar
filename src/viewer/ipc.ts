import type { ViewerAPI } from './types'

export const api: ViewerAPI = window.viewer

export function fileUrl(absPath: string): string {
  // Use our custom viewer-file:// scheme registered in main. file:// won't
  // load in renderer windows served from http:// (dev server).
  const encoded = absPath.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return `viewer-file://viewer${encoded}`
}
