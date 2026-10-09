// The viewer's link to the backend: the `window.viewer` object (set up in bridge.ts) and the
// URL that loads a local file into the window.

import type { ViewerAPI } from './types'

/** The `window.viewer` object, backed by Rust commands. Read once, when this file loads. */
export const api: ViewerAPI = window.viewer

/** A `viewer-file://` URL for a local file, for `<img>` and `<video>` sources. */
export function fileUrl(absPath: string): string {
  // Use our custom viewer-file:// scheme, served by protocol.rs. file:// won't
  // load in windows served from http:// (dev server).
  const encoded = absPath.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return `viewer-file://viewer${encoded}`
}
