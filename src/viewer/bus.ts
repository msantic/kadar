// The viewer's in-window message bus. Parts that do not import each other talk here,
// for example the grid asks the big view to open. Only inside the window; Rust events arrive
// through Tauri's `listen` (bridge.ts, main.ts) instead.

/** Every bus event and the data it carries. `void` means no data. */
export interface BusEvents {
  'folder:request': { path: string }
  'lightbox:open': { index: number }
  'lightbox:close': void
  /** ⌘= / ⌘- from the menu while the big view is open: zoom the image, not the thumbnails. */
  'lightbox:zoom': { bigger: boolean }
  /** Short message at the bottom; with `action`, it shows a button and stays longer. */
  'toast': { text: string; action?: { label: string; run: () => void } }
  'folder:refresh': void
  /** Go up, back or forward in the folder history. */
  'folder:go': { to: 'up' | 'back' | 'forward' }
  'rename:start': void
  /** One path: single-image export. Several: the same settings for all. */
  'export:open': { paths: string[] }
  /** A menu bar item, by its id. */
  'menu': { id: string }
  'info:toggle': void
  'info:show': void
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<keyof BusEvents, Set<Handler<any>>>()

/** Listens to `event`. Returns a function that stops listening. */
export function on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
  }
  set.add(handler)
  return () => { set!.delete(handler) }
}

/** Calls every listener of `event` at once, in the order they were added. */
export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  const set = handlers.get(event)
  if (!set) return
  for (const h of set) (h as Handler<K>)(payload)
}
