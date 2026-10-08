import { on } from '../bus'
import { getState, setState, subscribe } from '../store'
import { fileUrl } from '../ipc'
import { updateSession } from '../session'

export interface LightboxHandle {
  root: HTMLElement
  dispose: () => void
}

export function createLightbox(): LightboxHandle {
  const root = document.createElement('div')
  root.className = 'viewer-lightbox'
  root.hidden = true

  const stage = document.createElement('div')
  stage.className = 'viewer-lightbox-stage'

  const img = document.createElement('img')
  img.className = 'viewer-lightbox-img'
  img.draggable = false

  const video = document.createElement('video')
  video.className = 'viewer-lightbox-video'
  video.controls = true
  video.hidden = true

  const close = document.createElement('button')
  close.className = 'viewer-lightbox-close'
  close.textContent = '×'
  close.addEventListener('click', () => hide())

  const caption = document.createElement('div')
  caption.className = 'viewer-lightbox-caption'

  stage.append(img, video)
  root.append(close, stage, caption)

  function hide(): void {
    // Already closed: nothing to undo. Opening a folder calls this too.
    if (root.hidden) return
    root.hidden = true
    video.pause()
    video.removeAttribute('src')
    img.removeAttribute('src')
    setState({ lightboxIndex: null })
    updateSession({ bigView: false })
  }

  function show(index: number): void {
    const { entries } = getState()
    if (index < 0 || index >= entries.length) return
    const entry = entries[index]!
    setState({ lightboxIndex: index, selectedPath: entry.path })
    updateSession({ bigView: true, selectedPath: entry.path })
    root.hidden = false
    caption.textContent = `${entry.name}  —  ${index + 1} / ${entries.length}`
    if (entry.kind === 'video') {
      img.hidden = true
      video.hidden = false
      video.src = fileUrl(entry.path)
      void video.play().catch(() => {})
    } else {
      video.pause()
      video.hidden = true
      video.removeAttribute('src')
      img.hidden = false
      img.src = fileUrl(entry.path)
    }
  }

  function step(delta: number): void {
    const cur = getState().lightboxIndex
    if (cur === null) return
    const next = cur + delta
    show(next)
  }

  root.addEventListener('click', (e) => {
    if (e.target === root || e.target === stage) hide()
  })

  const keyHandler = (e: KeyboardEvent): void => {
    if (root.hidden) return
    if (e.key === 'Escape') { hide(); e.preventDefault() }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault() }
    else if (e.key === 'ArrowLeft')  { step(-1); e.preventDefault() }
    else if (e.key === ' ' && !video.hidden) {
      if (video.paused) void video.play(); else video.pause()
      e.preventDefault()
    }
  }
  window.addEventListener('keydown', keyHandler)

  const off1 = on('lightbox:open',  ({ index }) => show(index))
  const off2 = on('lightbox:close', () => hide())
  const off3 = on('lightbox:step',  ({ delta }) => step(delta))

  const unsub = subscribe((s, prev) => {
    if (s.currentFolder !== prev.currentFolder) hide()
  })

  return {
    root,
    dispose: () => {
      window.removeEventListener('keydown', keyHandler)
      off1(); off2(); off3()
      unsub()
    },
  }
}
