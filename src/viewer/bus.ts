export interface BusEvents {
  'thumb:ready': { srcPath: string; cachePath: string }
  'folder:request': { path: string }
  'lightbox:open': { index: number }
  'lightbox:close': void
  'lightbox:step': { delta: number }
  /** Short message at the bottom; with `action`, it shows a button and stays longer. */
  'toast': { text: string; action?: { label: string; run: () => void } }
  'folder:refresh': void
  /** Go up, back or forward in the folder history. */
  'folder:go': { to: 'up' | 'back' | 'forward' }
  'rename:start': void
  'export:open': { path: string }
  /** A menu bar item, by its id. */
  'menu': { id: string }
  'info:toggle': void
  'info:show': void
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<keyof BusEvents, Set<Handler<any>>>()

export function on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
  }
  set.add(handler)
  return () => { set!.delete(handler) }
}

export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  const set = handlers.get(event)
  if (!set) return
  for (const h of set) (h as Handler<K>)(payload)
}
