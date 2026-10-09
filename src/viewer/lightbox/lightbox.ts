import { emit, on } from '../bus'
import { getState, setState, subscribe } from '../store'
import { fileUrl } from '../ipc'
import { updateSession } from '../session'
import { copySelection, selectOnly } from '../selection'
import type { FileEntry } from '../types'
import { createInfoPanel } from '../info/info'

export interface LightboxHandle {
  root: HTMLElement
  dispose: () => void
}

const MAX_SCALE = 16
const STAGE_PADDING = 40
/** "100%": one image pixel per screen pixel, so a Retina screen shows the real sharpness. */
const actualPixels = (): number => 1 / (window.devicePixelRatio || 1)

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Big view. Images open fitted to the window. Pinch or ⌘-scroll zooms at the pointer,
 * scrolling or dragging moves a zoomed image, double-click switches fit ↔ 100%,
 * keys: 0 fit, 1 100% (one image pixel per screen pixel), + / − zoom. The images before and after load early,
 * so the arrow keys show them at once.
 */
export function createLightbox(): LightboxHandle {
  const root = document.createElement('div')
  root.className = 'viewer-lightbox'
  root.hidden = true

  const stage = document.createElement('div')
  stage.className = 'viewer-lightbox-stage'

  let img = makeImage()

  const video = document.createElement('video')
  video.className = 'viewer-lightbox-video'
  video.controls = true
  video.hidden = true

  const close = document.createElement('button')
  close.className = 'viewer-lightbox-close'
  close.textContent = '×'
  close.addEventListener('click', () => hide())

  const exportBtn = document.createElement('button')
  exportBtn.className = 'viewer-lightbox-export'
  exportBtn.textContent = 'Export for Web…'
  exportBtn.title = 'Rotate, crop and size this image for the web (⌘E)'
  exportBtn.addEventListener('click', () => { if (current) emit('export:open', { paths: [current.path] }) })

  // Info panel on the right; the stage narrows so the image stays fully visible.
  const info = createInfoPanel(() => root.classList.toggle('with-info', info.isOpen()))
  root.classList.toggle('with-info', info.isOpen())
  const infoBtn = document.createElement('button')
  infoBtn.className = 'viewer-lightbox-info-btn'
  infoBtn.textContent = 'Info'
  infoBtn.title = 'Show or hide details (I)'
  infoBtn.addEventListener('click', () => info.toggle())

  const caption = document.createElement('div')
  caption.className = 'viewer-lightbox-caption'

  stage.append(img, video)
  root.append(close, exportBtn, infoBtn, stage, caption, info.root)

  // Zoom state of the shown image: screen position = translate + scale × image pixel.
  let scale = 1
  let fitScale = 1
  let tx = 0
  let ty = 0
  let fitted = true
  let current: FileEntry | null = null

  // Decoded images by path: the shown one and its two neighbours.
  const preloaded = new Map<string, HTMLImageElement>()

  function makeImage(src?: string): HTMLImageElement {
    const el = document.createElement('img')
    el.className = 'viewer-lightbox-img'
    el.draggable = false
    el.decoding = 'async'
    if (src) el.src = src
    return el
  }

  function imageFor(entry: FileEntry): HTMLImageElement {
    let el = preloaded.get(entry.path)
    if (!el) {
      el = makeImage(fileUrl(entry.path))
      preloaded.set(entry.path, el)
    }
    return el
  }

  function preloadAround(index: number): void {
    const { entries } = getState()
    const keep = new Set<string>()
    for (const i of [index - 1, index, index + 1]) {
      const e = entries[i]
      if (!e || e.kind !== 'image') continue
      keep.add(e.path)
      const el = imageFor(e)
      if (i !== index) void el.decode().catch(() => {})
    }
    for (const path of preloaded.keys()) if (!keep.has(path)) preloaded.delete(path)
  }

  // ─── Zoom and pan ──────────────────────────────────────────────────────────

  function natural(): { w: number; h: number } {
    return { w: img.naturalWidth || 1, h: img.naturalHeight || 1 }
  }

  function apply(): void {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    img.classList.toggle('zoomed', scale > fitScale + 1e-6)
    drawCaption()
  }

  /** Keeps a zoomed image covering the stage, and centers an image smaller than the stage. */
  function clampPan(): void {
    const { w, h } = natural()
    const sw = stage.clientWidth
    const sh = stage.clientHeight
    const iw = w * scale
    const ih = h * scale
    tx = iw <= sw ? (sw - iw) / 2 : Math.min(0, Math.max(sw - iw, tx))
    ty = ih <= sh ? (sh - ih) / 2 : Math.min(0, Math.max(sh - ih, ty))
  }

  function fit(): void {
    const { w, h } = natural()
    const availW = Math.max(1, stage.clientWidth - STAGE_PADDING * 2)
    const availH = Math.max(1, stage.clientHeight - STAGE_PADDING * 2)
    fitScale = Math.min(availW / w, availH / h, 1)
    scale = fitScale
    fitted = true
    clampPan()
    apply()
  }

  function zoomAt(next: number, cx: number, cy: number): void {
    const s = Math.max(fitScale, Math.min(MAX_SCALE, next))
    tx = cx - (cx - tx) * (s / scale)
    ty = cy - (cy - ty) * (s / scale)
    scale = s
    fitted = Math.abs(s - fitScale) < 1e-6
    clampPan()
    apply()
  }

  function zoomAtCenter(next: number): void {
    zoomAt(next, stage.clientWidth / 2, stage.clientHeight / 2)
  }

  function stagePoint(e: MouseEvent): { x: number; y: number } {
    const r = stage.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // Pinch arrives as a wheel event with ctrlKey. ⌘-scroll zooms too; plain scrolling moves.
  // Two-finger swipe left or right on a fitted image goes to the next or previous one, as in
  // Photos. One swipe = one step: after a step, the rest of the motion (and the trackpad's
  // momentum) is ignored until the fingers have rested for a moment.
  const SWIPE_DISTANCE = 60
  const SWIPE_REST_MS = 220
  let swipeSum = 0
  let swipeLocked = false
  let swipeTimer: ReturnType<typeof setTimeout> | null = null
  function swipe(e: WheelEvent): void {
    if (swipeTimer !== null) clearTimeout(swipeTimer)
    swipeTimer = setTimeout(() => { swipeSum = 0; swipeLocked = false }, SWIPE_REST_MS)
    if (swipeLocked || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    swipeSum += e.deltaX
    if (Math.abs(swipeSum) < SWIPE_DISTANCE) return
    swipeLocked = true
    step(swipeSum > 0 ? 1 : -1)
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      if (img.hidden) return
      const p = stagePoint(e)
      zoomAt(scale * Math.exp(-e.deltaY * 0.01), p.x, p.y)
    } else if (!img.hidden && !fitted) {
      tx -= e.deltaX
      ty -= e.deltaY
      clampPan()
      apply()
    } else {
      swipe(e)
    }
  }, { passive: false })

  let drag: { x: number; y: number; tx: number; ty: number } | null = null
  stage.addEventListener('pointerdown', (e) => {
    if (fitted || e.target !== img || e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, tx, ty }
    stage.setPointerCapture(e.pointerId)
    img.classList.add('dragging')
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    tx = drag.tx + (e.clientX - drag.x)
    ty = drag.ty + (e.clientY - drag.y)
    clampPan()
    apply()
  })
  const endDrag = (): void => {
    drag = null
    img.classList.remove('dragging')
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

  // Double-click: fitted → 100% at the pointer (2× when the image is already 100% or larger).
  stage.addEventListener('dblclick', (e) => {
    if (img.hidden || e.target !== img) return
    if (fitted) {
      const p = stagePoint(e)
      zoomAt(fitScale >= actualPixels() ? fitScale * 2 : actualPixels(), p.x, p.y)
    } else {
      fit()
    }
  })

  new ResizeObserver(() => {
    if (root.hidden || img.hidden) return
    if (fitted) fit()
    else { clampPan(); apply() }
  }).observe(stage)

  // ─── Show and hide ─────────────────────────────────────────────────────────

  function drawCaption(): void {
    const { entries, lightboxIndex } = getState()
    if (!current || lightboxIndex === null) return
    // The counter counts images and videos only, not the subfolder tiles before them.
    const folders = entries.filter((e) => e.kind === 'folder').length
    const parts = [`${current.name}  —  ${lightboxIndex + 1 - folders} / ${entries.length - folders}`]
    if (!img.hidden && img.naturalWidth) {
      parts.push(`${img.naturalWidth} × ${img.naturalHeight}`)
      parts.push(formatBytes(current.size))
      parts.push(`${fitted ? 'Fit · ' : ''}${Math.round((scale / actualPixels()) * 100)}%`)
    } else {
      parts.push(formatBytes(current.size))
    }
    caption.textContent = parts.join('  ·  ')
  }

  function hide(): void {
    // Already closed: nothing to undo. Opening a folder calls this too.
    if (root.hidden) return
    root.hidden = true
    video.pause()
    video.removeAttribute('src')
    preloaded.clear()
    current = null
    setState({ lightboxIndex: null })
    updateSession({ bigView: false })
  }

  function show(index: number): void {
    const { entries } = getState()
    if (index < 0 || index >= entries.length) return
    const entry = entries[index]!
    if (entry.kind === 'folder') {
      emit('folder:request', { path: entry.path })
      return
    }
    current = entry
    selectOnly(index)
    setState({ lightboxIndex: index })
    updateSession({ bigView: true })
    root.hidden = false

    exportBtn.hidden = entry.kind !== 'image'
    info.show(entry)
    if (entry.kind === 'video') {
      img.hidden = true
      video.hidden = false
      video.src = fileUrl(entry.path)
      void video.play().catch(() => {})
    } else {
      video.pause()
      video.hidden = true
      video.removeAttribute('src')
      const next = imageFor(entry)
      if (next !== img) {
        img.replaceWith(next)
        img = next
      }
      img.hidden = false
      if (img.complete && img.naturalWidth) fit()
      else {
        img.style.transform = 'scale(0)'
        img.onload = () => { if (current === entry) fit() }
      }
    }
    drawCaption()
    preloadAround(index)
  }

  /** Next or previous image or video; subfolder tiles are skipped. */
  function step(delta: number): void {
    const cur = getState().lightboxIndex
    if (cur === null) return
    const { entries } = getState()
    let i = cur + delta
    while (i >= 0 && i < entries.length && entries[i]!.kind === 'folder') i += delta
    if (i >= 0 && i < entries.length) show(i)
  }

  root.addEventListener('click', (e) => {
    if (e.target === root || e.target === stage) hide()
  })

  const keyHandler = (e: KeyboardEvent): void => {
    // A key the grid used (Space that just opened this view) must not close it again.
    if (root.hidden || e.defaultPrevented) return
    const zoomable = !img.hidden
    // Cmd+C copies the shown file, Shift+Cmd+C its path, as in the grid.
    if (e.metaKey && e.key.toLowerCase() === 'c') { void copySelection(e.shiftKey); e.preventDefault(); return }
    if (e.metaKey && e.key.toLowerCase() === 'e' && current?.kind === 'image') { emit('export:open', { paths: [current.path] }); e.preventDefault(); return }
    if (e.key.toLowerCase() === 'i' && !e.altKey && !e.ctrlKey) { info.toggle(); e.preventDefault(); return }
    if (e.metaKey) return
    if (e.key === 'Escape') { hide(); e.preventDefault() }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault() }
    else if (e.key === 'ArrowLeft')  { step(-1); e.preventDefault() }
    else if (zoomable && e.key === '0') { fit(); e.preventDefault() }
    else if (zoomable && e.key === '1') { zoomAtCenter(actualPixels()); e.preventDefault() }
    else if (zoomable && (e.key === '+' || e.key === '=')) { zoomAtCenter(scale * 1.25); e.preventDefault() }
    else if (zoomable && (e.key === '-' || e.key === '_')) { zoomAtCenter(scale / 1.25); e.preventDefault() }
    else if (e.key === ' ' && !video.hidden) {
      if (video.paused) void video.play(); else video.pause()
      e.preventDefault()
    }
    // Space opens and closes, as Quick Look does. (For a video, Space plays and pauses.)
    else if (e.key === ' ' || e.key === 'Enter') { hide(); e.preventDefault() }
  }
  window.addEventListener('keydown', keyHandler)

  on('info:toggle', () => info.toggle())
  on('info:show', () => { if (!info.isOpen()) info.toggle() })

  const off1 = on('lightbox:open',  ({ index }) => show(index))
  const off2 = on('lightbox:close', () => hide())
  const off3 = on('lightbox:step',  ({ delta }) => step(delta))

  const unsub = subscribe((s, prev) => {
    if (s.currentFolder !== prev.currentFolder) hide()
    // The folder changed on disk and the shown image moved: keep the counter right.
    else if (s.lightboxIndex !== prev.lightboxIndex && s.lightboxIndex !== null) drawCaption()
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
