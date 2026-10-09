// "Export for web" of one image. Left: the image with a crop frame. Right: rotate, crop shape,
// width, format and quality. Every change makes the real result in Rust, so the size shown is
// exact, and the Result and Compare views show the compressed picture itself. Copy or Save uses
// that result. With several images (batch), the same settings go to all and a sheet shows the results.
// Opens on the bus event `export:open`.

import { on, emit } from '../bus'
import { fileUrl } from '../ipc'
import { getState } from '../store'
import type { BatchItem, ExportOptions, ExportResult } from '../types'
import { formatBytes, savingPercent } from '../format'

interface Rect { x: number; y: number; w: number; h: number }
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const SETTINGS_KEY = 'kadar:export'
const MIN_CROP_PX = 24
const ASPECTS: Record<string, number | null> = {
  free: null, original: -1, '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16,
}
const WIDTHS = [0, 3840, 2560, 1920, 1600, 1200, 1080, 800, 640, 400]

interface Settings { aspect: string; width: number; format: ExportOptions['format']; quality: number }

function loadSettings(): Settings {
  const fallback: Settings = { aspect: 'free', width: 1600, format: 'webp', quality: 80 }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) } : fallback
  } catch { return fallback }
}

function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* not kept */ }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'export-row')
  row.append(el('span', 'export-label', label), control)
  return row
}

let exportOpen = false

/** True while Export for Web is in front. Menu commands for the grid wait until it closes. */
export function isExportOpen(): boolean {
  return exportOpen
}

/** Builds the Export for Web screen, hidden until `export:open`. Settings are kept between launches. */
export function createExport(): HTMLElement {
  const settings = loadSettings()

  const root = el('div', 'export')
  root.hidden = true
  const stage = el('div', 'export-stage')
  const frame = el('div', 'export-frame')       // the rotated image, fitted to the stage
  const img = el('img', 'export-img')
  img.draggable = false
  const cropBox = el('div', 'export-crop')
  const handles: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  for (const h of handles) {
    const d = el('div', `export-handle export-handle-${h}`)
    d.dataset['handle'] = h
    cropBox.append(d)
  }
  const result = el('img', 'export-result')
  result.hidden = true
  // Batch mode: a sheet of the results, each with its size.
  const sheet = el('div', 'export-sheet')
  sheet.hidden = true
  frame.append(img, cropBox)
  // Compare: the uncompressed edit over the result; a line you drag shows the original on its
  // left and the result on its right. "Actual pixels" shows both at one image pixel per screen
  // pixel, where compression marks are visible.
  const compare = el('div', 'export-compare')
  compare.hidden = true
  const cmpWrap = el('div', 'export-compare-wrap')
  const cmpResult = el('img', 'export-compare-img')
  const cmpOrig = el('img', 'export-compare-img export-compare-orig')
  const cmpLine = el('div', 'export-compare-line')
  const cmpLeft = el('span', 'export-compare-label export-compare-label-left', 'Original')
  const cmpRight = el('span', 'export-compare-label export-compare-label-right', 'Result')
  for (const i of [cmpResult, cmpOrig]) i.draggable = false
  cmpWrap.append(cmpResult, cmpOrig, cmpLine, cmpLeft, cmpRight)
  compare.append(cmpWrap)
  stage.append(frame, result, sheet, compare)

  // ─── Settings panel ────────────────────────────────────────────────────────
  const panel = el('div', 'export-panel')
  const title = el('div', 'export-title', 'Export for Web')
  const source = el('div', 'export-source')

  const rotateRow = el('div', 'export-buttons')
  const rotLeft = el('button', 'export-btn', '⟲ Rotate Left')
  const rotRight = el('button', 'export-btn', '⟳ Rotate Right')
  rotateRow.append(rotLeft, rotRight)

  const aspect = el('select', 'export-select')
  for (const [value, label] of [['free', 'Free'], ['original', 'Original'], ['1:1', 'Square 1:1'], ['4:5', 'Portrait 4:5'],
    ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', 'Wide 16:9'], ['9:16', 'Story 9:16']] as const) {
    aspect.append(new Option(label, value))
  }
  aspect.value = settings.aspect
  const resetCrop = el('button', 'export-link', 'Reset')

  const width = el('select', 'export-select')
  for (const w of WIDTHS) width.append(new Option(w === 0 ? 'Original size' : `${w} px wide`, String(w)))
  width.value = String(settings.width)

  const format = el('select', 'export-select')
  for (const [value, label] of [['webp', 'WebP'], ['jpg', 'JPG'], ['png', 'PNG (lossless)']] as const) format.append(new Option(label, value))
  format.value = settings.format

  const quality = el('input', 'export-range')
  quality.type = 'range'
  quality.min = '30'
  quality.max = '100'
  quality.value = String(settings.quality)
  const qualityValue = el('span', 'export-value', String(settings.quality))
  const qualityWrap = el('div', 'export-inline')
  qualityWrap.append(quality, qualityValue)
  const qualityRow = labeled('Quality', qualityWrap)

  const info = el('div', 'export-info', '…')
  // What the stage shows: the crop frame, the result alone, or Compare.
  type View = 'crop' | 'result' | 'compare'
  const viewRow = el('div', 'export-segmented')
  const viewButtons: Record<View, HTMLButtonElement> = {
    crop: el('button', '', 'Crop'),
    result: el('button', '', 'Result'),
    compare: el('button', '', 'Compare'),
  }
  viewRow.append(viewButtons.crop, viewButtons.result, viewButtons.compare)
  const actualLabel = el('label', 'export-check')
  const actual = el('input')
  actual.type = 'checkbox'
  actualLabel.append(actual, document.createTextNode(' Actual pixels (1:1)'))
  let view: View = 'crop'

  const actions = el('div', 'export-buttons')
  const copyBtn = el('button', 'export-btn export-primary', 'Copy')
  copyBtn.title = 'Copy the result (⌘C)'
  const saveBtn = el('button', 'export-btn', 'Save')
  saveBtn.title = 'Save into the "optimized" folder next to the image (⌘S)'
  const closeBtn = el('button', 'export-btn', 'Close')
  actions.append(copyBtn, saveBtn, closeBtn)

  const cropRow = el('div', 'export-inline')
  cropRow.append(aspect, resetCrop)
  panel.append(
    title, source, rotateRow, labeled('Crop', cropRow), labeled('Width', width), labeled('Format', format),
    qualityRow, info, viewRow, actualLabel, actions,
  )
  root.append(stage, panel)

  // ─── State ─────────────────────────────────────────────────────────────────
  let path = ''
  let sourceSize = 0
  let turns = 0
  let crop: Rect = { x: 0, y: 0, w: 1, h: 1 } // fractions of the rotated image
  let latest: ExportResult | null = null
  let requestNo = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const rotated = (): { w: number; h: number } => {
    const w = img.naturalWidth || 1
    const h = img.naturalHeight || 1
    return turns % 2 === 1 ? { w: h, h: w } : { w, h }
  }

  /** Ratio width / height in rotated pixels, or null for a free crop. */
  function ratio(): number | null {
    const r = ASPECTS[aspect.value]
    if (r === undefined || r === null) return null
    if (r === -1) { const d = rotated(); return d.w / d.h }
    return r
  }

  /** The largest centered crop with the chosen shape. */
  function fullCrop(): void {
    const r = ratio()
    const d = rotated()
    if (r === null) { crop = { x: 0, y: 0, w: 1, h: 1 }; return }
    let w = d.w
    let h = w / r
    if (h > d.h) { h = d.h; w = h * r }
    crop = { x: (d.w - w) / 2 / d.w, y: (d.h - h) / 2 / d.h, w: w / d.w, h: h / d.h }
  }

  // ─── Layout ────────────────────────────────────────────────────────────────
  function layout(): void {
    const d = rotated()
    const availW = Math.max(1, stage.clientWidth - 48)
    const availH = Math.max(1, stage.clientHeight - 48)
    const s = Math.min(availW / d.w, availH / d.h)
    const fw = d.w * s
    const fh = d.h * s
    frame.style.width = `${fw}px`
    frame.style.height = `${fh}px`
    // The image keeps its own size and turns about its center inside the frame.
    const iw = (img.naturalWidth || 1) * s
    const ih = (img.naturalHeight || 1) * s
    img.style.width = `${iw}px`
    img.style.height = `${ih}px`
    img.style.left = `${(fw - iw) / 2}px`
    img.style.top = `${(fh - ih) / 2}px`
    img.style.transform = `rotate(${turns * 90}deg)`
    drawCrop()
  }

  function drawCrop(): void {
    const fw = frame.clientWidth
    const fh = frame.clientHeight
    cropBox.style.left = `${crop.x * fw}px`
    cropBox.style.top = `${crop.y * fh}px`
    cropBox.style.width = `${crop.w * fw}px`
    cropBox.style.height = `${crop.h * fh}px`
    cropBox.classList.toggle('locked', ratio() !== null)
  }

  new ResizeObserver(() => { if (!root.hidden) layout() }).observe(stage)

  // ─── Crop dragging ─────────────────────────────────────────────────────────
  let drag: { handle: Handle; x: number; y: number; start: Rect } | null = null

  cropBox.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const handle = (target.dataset['handle'] as Handle | undefined) ?? 'move'
    drag = { handle, x: e.clientX, y: e.clientY, start: { ...crop } }
    cropBox.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  cropBox.addEventListener('pointermove', (e) => {
    if (!drag) return
    const fw = frame.clientWidth
    const fh = frame.clientHeight
    const dx = (e.clientX - drag.x) / fw
    const dy = (e.clientY - drag.y) / fh
    const s = drag.start
    const minW = MIN_CROP_PX / fw
    const minH = MIN_CROP_PX / fh
    let { x, y, w, h } = s
    const hs = drag.handle
    if (hs === 'move') {
      x = Math.min(Math.max(0, s.x + dx), 1 - s.w)
      y = Math.min(Math.max(0, s.y + dy), 1 - s.h)
    } else {
      if (hs.includes('e')) w = Math.min(Math.max(minW, s.w + dx), 1 - s.x)
      if (hs.includes('s')) h = Math.min(Math.max(minH, s.h + dy), 1 - s.y)
      if (hs.includes('w')) { const nx = Math.min(Math.max(0, s.x + dx), s.x + s.w - minW); w = s.w + (s.x - nx); x = nx }
      if (hs.includes('n')) { const ny = Math.min(Math.max(0, s.y + dy), s.y + s.h - minH); h = s.h + (s.y - ny); y = ny }
      const r = ratio()
      if (r !== null) {
        // Keep the shape: height follows width (in screen pixels), anchored at the far corner.
        const nh = (w * fw) / r / fh
        const fixedTop = hs.includes('s')
        let ny = fixedTop ? y : y + h - nh
        let hh = nh
        if (ny < 0) { hh += ny; ny = 0 }
        if (ny + hh > 1) hh = 1 - ny
        const nw = (hh * fh * r) / fw
        if (hs.includes('w')) x = x + w - nw
        w = nw
        h = hh
        y = ny
      }
    }
    crop = { x, y, w, h }
    drawCrop()
  })

  const endDrag = (): void => {
    if (!drag) return
    drag = null
    schedule()
  }
  cropBox.addEventListener('pointerup', endDrag)
  cropBox.addEventListener('pointercancel', endDrag)

  // ─── Result ────────────────────────────────────────────────────────────────
  function options(): ExportOptions {
    const full = crop.x <= 0.0005 && crop.y <= 0.0005 && crop.w >= 0.999 && crop.h >= 0.999
    const w = Number(width.value)
    // Batch: no rotation or free crop; a fixed shape is cut from each image's center.
    const shape = ASPECTS[aspect.value]
    return {
      turns: batch.length > 1 ? 0 : turns,
      crop: batch.length > 1 || full ? null : crop,
      aspect: batch.length > 1 && typeof shape === 'number' && shape > 0 ? shape : null,
      maxWidth: w > 0 ? w : null,
      format: format.value as ExportOptions['format'],
      quality: Number(quality.value),
    }
  }

  // ─── Batch ─────────────────────────────────────────────────────────────────
  let batch: string[] = []
  /** Size in bytes of each source file of the batch, for the "smaller" figure. */
  let batchSizes = new Map<string, number>()
  let batchItems: BatchItem[] = []
  let currentRun = 0
  /** True while Rust works on a batch, so closing the screen can stop it. */
  let batchRunning = false
  window.viewer.share.onExportProgress(({ run, done, total }) => {
    if (run === currentRun) info.textContent = `Working…  ${done} / ${total}`
  })

  async function updateBatch(): Promise<void> {
    const run = Date.now()
    currentRun = run
    batchItems = []
    info.textContent = `Working…  0 / ${batch.length}`
    batchRunning = true
    try {
      const items = await window.viewer.share.exportBatch(batch, options(), run)
      if (run !== currentRun) return
      batchItems = items
      const done = items.filter((i) => i.result)
      const total = done.reduce((sum, i) => sum + i.result!.bytes, 0)
      // Compare with the sources that worked only, so failed images do not inflate the saving.
      const doneSource = done.reduce((sum, i) => sum + (batchSizes.get(i.source) ?? 0), 0)
      const saving = savingPercent(doneSource, total)
      const failed = items.length - done.length
      info.textContent = `${done.length} images  ·  ${formatBytes(total)} total${saving > 0 ? `  ·  ${saving}% smaller` : ''}`
        + (failed > 0 ? `  ·  ${failed} failed` : '')
      sheet.replaceChildren(...items.map((i) => {
        const tile = el('figure', 'export-tile')
        if (i.result) {
          const pic = el('img')
          pic.src = fileUrl(i.result.path)
          pic.draggable = false
          tile.append(pic, el('figcaption', '', `${i.result.width} × ${i.result.height}  ·  ${formatBytes(i.result.bytes)}`))
        } else {
          tile.append(el('figcaption', 'export-tile-error', `${i.source.split('/').pop()}: ${i.error ?? 'failed'}`))
        }
        return tile
      }))
    } catch (err) {
      if (run === currentRun) info.textContent = `Error: ${String(err)}`
    } finally {
      if (run === currentRun) batchRunning = false
    }
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => void update(), 120)
  }

  async function update(): Promise<void> {
    if (batch.length > 1) return updateBatch()
    const mine = ++requestNo
    info.textContent = 'Working…'
    try {
      const r = await window.viewer.share.exportImage(path, options())
      if (mine !== requestNo) return
      latest = r
      const saving = savingPercent(sourceSize, r.bytes)
      info.textContent = `${r.width} × ${r.height}  ·  ${formatBytes(r.bytes)}${saving > 0 ? `  ·  ${saving}% smaller` : ''}`
      if (view === 'result') result.src = fileUrl(r.path)
      if (view === 'compare') {
        const ref = await window.viewer.share.exportReference(path, options())
        if (mine !== requestNo) return
        cmpRight.textContent = `${format.selectedOptions[0]?.textContent?.split(' ')[0] ?? ''}${format.value === 'png' ? '' : ` ${quality.value}`}  ·  ${formatBytes(r.bytes)}`
        cmpResult.onload = () => sizeCompare()
        cmpResult.src = fileUrl(r.path)
        cmpOrig.src = fileUrl(ref.path)
      }
    } catch (err) {
      if (mine === requestNo) info.textContent = `Error: ${String(err)}`
    }
  }

  function setView(next: View): void {
    view = next
    for (const [name, btn] of Object.entries(viewButtons)) btn.classList.toggle('active', name === next)
    frame.hidden = next !== 'crop'
    result.hidden = next !== 'result'
    compare.hidden = next !== 'compare'
    actualLabel.hidden = next !== 'compare'
    if (next === 'crop') layout()
    if (next === 'result' && latest) result.src = fileUrl(latest.path)
    if (next === 'compare') schedule()
  }
  for (const [name, btn] of Object.entries(viewButtons)) btn.addEventListener('click', () => setView(name as View))

  // Compare sizing: fitted, or one image pixel per screen pixel (then the area scrolls).
  let split = 0.5
  function sizeCompare(): void {
    const w = cmpResult.naturalWidth || 1
    const h = cmpResult.naturalHeight || 1
    let s: number
    if (actual.checked) s = 1 / (window.devicePixelRatio || 1)
    else s = Math.min((compare.clientWidth - 48) / w, (compare.clientHeight - 48) / h, 1)
    cmpWrap.style.width = `${w * s}px`
    cmpWrap.style.height = `${h * s}px`
    compare.classList.toggle('actual', actual.checked)
    drawSplit()
  }
  function drawSplit(): void {
    const pct = `${(split * 100).toFixed(2)}%`
    cmpOrig.style.clipPath = `inset(0 calc(100% - ${pct}) 0 0)`
    cmpLine.style.left = pct
  }
  actual.addEventListener('change', () => sizeCompare())
  new ResizeObserver(() => { if (!compare.hidden) sizeCompare() }).observe(compare)
  let splitting = false
  cmpWrap.addEventListener('pointerdown', (e) => {
    splitting = true
    cmpWrap.setPointerCapture(e.pointerId)
    moveSplit(e)
  })
  cmpWrap.addEventListener('pointermove', (e) => { if (splitting) moveSplit(e) })
  cmpWrap.addEventListener('pointerup', () => { splitting = false })
  function moveSplit(e: PointerEvent): void {
    const r = cmpWrap.getBoundingClientRect()
    split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    drawSplit()
  }

  function remember(): void {
    saveSettings({ aspect: aspect.value, width: Number(width.value), format: format.value as Settings['format'], quality: Number(quality.value) })
  }

  // ─── Controls ──────────────────────────────────────────────────────────────
  rotLeft.addEventListener('click', () => { turns = (turns + 3) % 4; fullCrop(); layout(); schedule() })
  rotRight.addEventListener('click', () => { turns = (turns + 1) % 4; fullCrop(); layout(); schedule() })
  aspect.addEventListener('change', () => { fullCrop(); drawCrop(); remember(); schedule() })
  resetCrop.addEventListener('click', () => { fullCrop(); drawCrop(); schedule() })
  width.addEventListener('change', () => { remember(); schedule() })
  format.addEventListener('change', () => {
    qualityRow.hidden = format.value === 'png'
    remember()
    schedule()
  })
  quality.addEventListener('input', () => { qualityValue.textContent = quality.value })
  quality.addEventListener('change', () => { remember(); schedule() })

  async function copy(): Promise<void> {
    if (batch.length > 1) {
      const results = batchItems.flatMap((i) => (i.result ? [i.result.path] : []))
      if (results.length === 0) return
      try {
        await window.viewer.share.exportCopyMany(results)
        emit('toast', { text: `Copied ${results.length} files` })
      } catch (err) {
        emit('toast', { text: `Copy failed: ${String(err)}` })
      }
      return
    }
    if (!latest) return
    try {
      await window.viewer.share.exportCopy(latest.path)
      emit('toast', { text: `Copied ${latest.width} × ${latest.height} · ${formatBytes(latest.bytes)}` })
    } catch (err) {
      emit('toast', { text: `Copy failed: ${String(err)}` })
    }
  }

  async function save(): Promise<void> {
    if (batch.length > 1) {
      const pairs = batchItems.flatMap((i): [string, string][] => (i.result ? [[i.source, i.result.path]] : []))
      if (pairs.length === 0) return
      try {
        const saved = await window.viewer.share.exportSaveMany(pairs)
        const folder = saved[0]!.slice(0, saved[0]!.lastIndexOf('/'))
        emit('toast', {
          text: `Saved ${saved.length} files → "optimized" folder`,
          action: { label: 'Show in Finder', run: () => void window.viewer.fs.openDefault(folder) },
        })
      } catch (err) {
        emit('toast', { text: `Save failed: ${String(err)}` })
      }
      return
    }
    if (!latest) return
    try {
      const saved = await window.viewer.share.exportSave(path, latest.path)
      emit('toast', {
        text: `Saved → optimized/${saved.split('/').pop()}`,
        action: { label: 'Show in Finder', run: () => void window.viewer.fs.revealInFinder(saved) },
      })
    } catch (err) {
      emit('toast', { text: `Save failed: ${String(err)}` })
    }
  }

  copyBtn.addEventListener('click', () => void copy())
  saveBtn.addEventListener('click', () => void save())
  closeBtn.addEventListener('click', () => close())

  // Keys while open; they stop here, so the grid and the big view behind do not react.
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return
    const typing = (e.target as HTMLElement | null)?.tagName === 'SELECT'
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.metaKey && e.key.toLowerCase() === 'c') { e.preventDefault(); void copy() }
    else if (e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); void save() }
    else if (!typing && !e.metaKey && batch.length <= 1 && e.key.toLowerCase() === 'r') { e.preventDefault(); rotRight.click() }
    // Every other key also stops here, so the arrows, Space or I do not act on the screens
    // behind. Fields still get their keys: this stops only the page's own key handlers.
    e.stopImmediatePropagation()
  }, { capture: true })

  function close(): void {
    // A batch still at work stops at its next image; there is no one left to show it to.
    if (batchRunning) void window.viewer.share.exportStop()
    batchRunning = false
    root.hidden = true
    exportOpen = false
    img.removeAttribute('src')
    result.removeAttribute('src')
    cmpResult.removeAttribute('src')
    cmpOrig.removeAttribute('src')
    sheet.replaceChildren()
    latest = null
    batchItems = []
    currentRun = 0
    requestNo++
  }

  /** Single mode: rotate, free crop and the Crop / Result / Compare views; batch mode: the results sheet. */
  function setMode(many: boolean): void {
    title.textContent = many ? `Export ${batch.length} Images for Web` : 'Export for Web'
    rotateRow.hidden = many
    resetCrop.hidden = many
    viewRow.hidden = many
    actualLabel.hidden = true
    sheet.hidden = !many
    frame.hidden = many
    result.hidden = true
    compare.hidden = true
    // A free crop needs a frame to drag; in batch mode it means "keep the whole image".
    aspect.options[0]!.textContent = many ? 'Whole image' : 'Free'
  }

  function open(p: string, size: number): void {
    batch = [p]
    setMode(false)
    path = p
    sourceSize = size
    turns = 0
    latest = null
    split = 0.5
    qualityRow.hidden = format.value === 'png'
    source.textContent = `${p.split('/').pop()}  ·  ${formatBytes(size)}`
    root.hidden = false
    exportOpen = true
    img.onload = () => { fullCrop(); setView('crop'); schedule() }
    img.onerror = () => { info.textContent = 'Kadar cannot read this image.' }
    img.src = fileUrl(p)
  }

  function openBatch(paths: string[]): void {
    batch = paths
    const sizes = new Map(getState().entries.map((e) => [e.path, e.size]))
    batchSizes = new Map(paths.map((p) => [p, sizes.get(p) ?? 0]))
    sourceSize = paths.reduce((sum, p) => sum + (sizes.get(p) ?? 0), 0)
    setMode(true)
    qualityRow.hidden = format.value === 'png'
    source.textContent = `${paths.length} images  ·  ${formatBytes(sourceSize)}`
    sheet.replaceChildren()
    root.hidden = false
    exportOpen = true
    schedule()
  }

  on('export:open', ({ paths }) => {
    if (paths.length > 1) { openBatch(paths); return }
    const p = paths[0]
    if (!p) return
    void window.viewer.meta.get(p).then((m) => open(p, m.sizeBytes)).catch(() => open(p, 0))
  })

  return root
}
