// File paths in the window, for every system. Paths arrive from Rust as the system writes them:
// "/Users/me/a.jpg" on the Mac and Linux, "C:\Users\me\a.jpg" on Windows. These helpers accept
// both separators and keep the path's own one, so the rest of the window never splits on "/".

const SEPARATOR = /[\\/]/

/** The separator the path uses: "\" for a Windows path, else "/". */
export function separatorOf(path: string): string {
  return !path.startsWith('/') && path.includes('\\') ? '\\' : '/'
}

/** The last part of a path: "a.jpg" for "/photos/a.jpg" or "C:\photos\a.jpg". */
export function baseName(path: string): string {
  const parts = path.split(SEPARATOR).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** The folder that holds `path`; null for a top folder ("/" or "C:\"). A drive keeps its
 *  separator ("C:\"), so it still names a folder. */
export function parentOf(path: string): string | null {
  const sep = separatorOf(path)
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, '') : path
  if (trimmed === '/' || /^[A-Za-z]:$/.test(trimmed)) return null
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (i < 0) return null
  const head = trimmed.slice(0, i)
  if (head === '') return '/'
  if (/^[A-Za-z]:$/.test(head)) return head + sep
  return head
}

/** `dir` and `name` joined with the path's own separator. */
export function joinPath(dir: string, name: string): string {
  const sep = separatorOf(dir)
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + sep + name
}

/** One part of a path for the path bar: its name and the full path up to it. */
export interface Crumb {
  name: string
  path: string
}

/** The parts of a folder path, from the top: "/Users/me" → Users, me; "C:\Users" → C:, Users;
 *  a network folder "\\server\share\a" → \\server\share, a (a share is the top there). */
export function crumbs(path: string): Crumb[] {
  const sep = separatorOf(path)
  const parts = path.split(SEPARATOR).filter(Boolean)
  if (/^[\\/]{2}[^\\/]/.test(path) && parts.length >= 2) {
    const top = `${sep}${sep}${parts[0]}${sep}${parts[1]}`
    return [{ name: top, path: top }, ...parts.slice(2).map((name, i) => ({ name, path: [top, ...parts.slice(2, i + 3)].join(sep) }))]
  }
  const drive = /^[A-Za-z]:/.test(path)
  return parts.map((name, i) => {
    const joined = parts.slice(0, i + 1).join(sep)
    const full = drive ? (i === 0 ? joined + sep : joined) : `/${joined}`
    return { name, path: full }
  })
}
