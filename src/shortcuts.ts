// Kadar's keys on Windows and Linux, where Kadar has no menu bar. On the Mac the menu bar holds
// these keys (src-tauri/src/menu.rs); here the window maps the same keys to the same command
// names, plus the keys people know from File Explorer (Delete, F2, Alt+arrows).
//
// A key the window's own code handles first (it calls preventDefault) does not run twice: the
// command runs only when no other code took the key, as a menu bar would.

import type { System } from './platform'

/** Key → command, by the same names the Mac menu bar sends (`tab:viewer`, `trash`, ...). */
export function commandForKey(
  e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
  sys: System,
  typing: boolean,
): string | null {
  if (sys === 'mac' || e.metaKey) return null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (e.ctrlKey && !e.altKey) {
    const tabs: Record<string, string> = { '1': 'tab:viewer', '2': 'tab:optimize', '3': 'tab:record', '4': 'tab:screenshot' }
    if (!e.shiftKey && tabs[key]) return tabs[key]!
    // In a text field, Ctrl+C, Ctrl+A and Ctrl+Z work on the text, as Windows does by itself.
    if (typing) return null
    if (e.shiftKey) return ({ o: 'optimize', c: 'copy-paths' } as Record<string, string>)[key] ?? null
    const plain: Record<string, string> = {
      o: 'open-default', r: 'reveal', e: 'export', c: 'copy', a: 'select-all', z: 'undo', f: 'filter',
      i: 'info', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '[': 'go:back', ']': 'go:forward',
      ArrowUp: 'go:up', Backspace: 'trash',
    }
    return plain[key] ?? null
  }
  if (typing) return null
  if (e.altKey && !e.ctrlKey && !e.shiftKey) {
    return ({ ArrowLeft: 'go:back', ArrowRight: 'go:forward', ArrowUp: 'go:up' } as Record<string, string>)[key] ?? null
  }
  if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (key === 'Delete') return 'trash'
    if (key === 'F2') return 'rename'
  }
  return null
}

/** Keys that would make the browser engine reload the page, open its find bar, go back in its
 *  history or print. Kadar stops them, so they never leave the app in a broken state. */
export function isBrowserKey(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key === 'F5' || key === 'F3' || key === 'F7' || key === 'BrowserBack' || key === 'BrowserForward') return true
  if (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) return true
  return e.ctrlKey && !e.altKey && ['r', 'f', 'p', 'g', 'h', 'j', 'u', 'n', 't', 'w'].includes(key)
}
