// Which system the window runs on, and what follows from it: the command key (⌘ on the Mac,
// Ctrl on Windows and Linux) and the words the user knows there (Finder, File Explorer, Files).
// The window code asks here and never names ⌘ or Finder itself (Roadmap in README.md).

/** The three systems Kadar is made for. */
export type System = 'mac' | 'windows' | 'linux'

/** The system, from the browser engine's description of it. */
export function detectSystem(userAgent: string): System {
  if (/Mac/.test(userAgent)) return 'mac'
  if (/Windows/.test(userAgent)) return 'windows'
  return 'linux'
}

/** The system this window runs on. */
export const system: System = detectSystem(navigator.userAgent)

/** True when the command key is down: ⌘ on the Mac, Ctrl elsewhere. */
export function commandKeyFor(sys: System, e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return sys === 'mac' ? e.metaKey : e.ctrlKey
}

/** True when the command key is down on this system. */
export function commandKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return commandKeyFor(system, e)
}

/** True when a modifier that is NOT this system's command key is down (Ctrl on the Mac, the
 *  Windows key elsewhere). Grid keys ignore such presses. */
export function otherModifier(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return system === 'mac' ? e.ctrlKey : e.metaKey
}

/** A key as the user reads it in tips: "⌘E" / "⇧⌘C" on the Mac, "Ctrl+E" / "Ctrl+Shift+C" elsewhere. */
export function keyLabelFor(sys: System, key: string, shift = false): string {
  if (sys === 'mac') return `${shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`
}

/** A key label for this system. */
export function keyLabel(key: string, shift = false): string {
  return keyLabelFor(system, key, shift)
}

/** The words for things the system names differently. */
export interface Words {
  /** "Finder", "File Explorer" or "Files". */
  fileManager: string
  /** "Show in Finder" and its twins. */
  showInFileManager: string
  /** "Trash" or "Recycle Bin". */
  trash: string
}

/** The words for a system. */
export function wordsFor(sys: System): Words {
  const fileManager = sys === 'mac' ? 'Finder' : sys === 'windows' ? 'File Explorer' : 'Files'
  return {
    fileManager,
    showInFileManager: `Show in ${fileManager}`,
    trash: sys === 'windows' ? 'Recycle Bin' : 'Trash',
  }
}

/** The words for this system. */
export const words: Words = wordsFor(system)

/** Fills every element marked `data-word="<name>"` in the page with this system's word. */
export function applyWords(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-word]').forEach((el) => {
    const name = el.dataset['word'] as keyof Words | undefined
    if (name && name in words) el.textContent = words[name]
  })
}
