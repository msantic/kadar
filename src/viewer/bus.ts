export interface BusEvents {
  'thumb:ready': { srcPath: string; cachePath: string }
  'folder:request': { path: string }
  'lightbox:open': { index: number }
  'lightbox:close': void
  'lightbox:step': { delta: number }
  'toast': { text: string }
  'folder:refresh': void
  'rename:start': void
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
