// The viewer's link to the backend: the `window.viewer` object (set up in bridge.ts) and the
// URL that loads a local file into the window.

import type { ViewerAPI } from './types'
import { system } from '../platform'

/** The `window.viewer` object, backed by Rust commands. Read once, when this file loads. */
export const api: ViewerAPI = window.viewer

/** A `viewer-file://` URL for a local file, for `<img>` and `<video>` sources. */
export function fileUrl(absPath: string): string {
  // Use our custom viewer-file:// scheme, served by protocol.rs. file:// won't
  // load in windows served from http:// (dev server).
  // Windows paths ("C:\a\b.jpg") travel as "/C:/a/b.jpg"; Rust turns them back.
  const path = absPath.replace(/\\/g, '/')
  const encoded = (path.startsWith('/') ? path : `/${path}`).split('/').map((seg) => encodeURIComponent(seg)).join('/')
  // WebView2 (Windows) reaches custom schemes only as http://<scheme>.localhost.
  return system === 'windows' ? `http://viewer-file.localhost${encoded}` : `viewer-file://viewer${encoded}`
}
