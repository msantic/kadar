// Info panel of the big view: file, camera, exposure, place and color of the shown image.
// The I key (or ⌘I, or the Info button) shows and hides it; Kadar remembers the choice.

import type { FileEntry } from '../types'

const KEY = 'kadar:info-open'

type Props = Record<string, unknown>

const group = (p: Props, name: string): Props => (p[name] as Props | undefined) ?? {}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** "2025:01:03 15:47:35" → the same moment in the reader's format (the camera's local time). */
function exifDate(text: string | undefined): string | undefined {
  const m = text?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m || m[1] === '0000') return undefined
  return dateFormat.format(new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!))
}

function shutter(seconds: number): string {
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`
  return `1/${Math.round(1 / seconds)} s`
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export interface InfoPanel {
  root: HTMLElement
  isOpen: () => boolean
  toggle: () => void
  show: (entry: FileEntry) => void
}

export function createInfoPanel(onToggle: () => void): InfoPanel {
  const root = document.createElement('aside')
  root.className = 'viewer-info'
  let open = false
  try { open = localStorage.getItem(KEY) === '1' } catch { /* not kept */ }
  root.hidden = !open
  let current: FileEntry | null = null
  let requestNo = 0

  function section(title: string, rows: [string, string | HTMLElement | undefined][]): HTMLElement | null {
    const shown = rows.filter((r): r is [string, string | HTMLElement] => r[1] !== undefined && r[1] !== '')
    if (shown.length === 0) return null
    const box = document.createElement('section')
    const h = document.createElement('h3')
    h.textContent = title
    box.append(h)
    for (const [label, value] of shown) {
      const row = document.createElement('div')
      row.className = 'viewer-info-row'
      const l = document.createElement('span')
      l.className = 'viewer-info-label'
      l.textContent = label
      const v = document.createElement('span')
      v.className = 'viewer-info-value'
      if (typeof value === 'string') v.textContent = value
      else v.append(value)
      row.append(l, v)
      box.append(row)
    }
    return box
  }

  async function render(entry: FileEntry): Promise<void> {
    const mine = ++requestNo
    const [meta, props] = await Promise.all([
      window.viewer.meta.get(entry.path).catch(() => null),
      entry.kind === 'image' ? window.viewer.meta.properties(entry.path).catch(() => null) : Promise.resolve(null),
    ])
    if (mine !== requestNo || !open) return

    const p: Props = props ?? {}
    const exif = group(p, '{Exif}')
    const tiff = group(p, '{TIFF}')
    const gps = group(p, '{GPS}')
    const aux = group(p, '{ExifAux}')
    const w = num(p['PixelWidth']) ?? meta?.width
    const h = num(p['PixelHeight']) ?? meta?.height
    // Rotated photos (EXIF orientation 5–8) show with width and height swapped.
    const turned = (num(p['Orientation']) ?? 1) >= 5
    const [sw, sh] = turned ? [h, w] : [w, h]

    const sections: (HTMLElement | null)[] = []
    sections.push(section('File', [
      ['Name', entry.name],
      ['Kind', `${entry.ext.toUpperCase()} ${entry.kind === 'video' ? 'video' : 'image'}`],
      ['Size', formatBytes(entry.size)],
      ['Pixels', sw && sh ? `${sw} × ${sh}  (${((sw * sh) / 1e6).toFixed(1)} MP)` : undefined],
      ['Length', meta?.durationMs ? duration(meta.durationMs) : undefined],
      ['Taken', exifDate(str(exif['DateTimeOriginal']))],
      ['Modified', dateFormat.format(new Date(entry.mtimeMs))],
      ['Folder', entry.path.slice(0, entry.path.lastIndexOf('/'))],
    ]))

    const make = str(tiff['Make'])
    const model = str(tiff['Model'])
    const camera = make && model && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model ?? make
    const fnum = num(exif['FNumber'])
    const time = num(exif['ExposureTime'])
    const iso = (exif['ISOSpeedRatings'] as unknown[] | undefined)?.map(num).find((v) => v !== undefined)
    const exposure = [fnum ? `ƒ/${fnum}` : '', time ? shutter(time) : '', iso ? `ISO ${iso}` : ''].filter(Boolean).join('  ·  ')
    const focal = num(exif['FocalLength'])
    const focal35 = num(exif['FocalLenIn35mmFilm'])
    const bias = num(exif['ExposureBiasValue'])
    const flash = num(exif['Flash'])
    sections.push(section('Camera', [
      ['Camera', camera],
      ['Lens', str(exif['LensModel']) ?? str(aux['LensModel'])],
      ['Exposure', exposure || undefined],
      ['Focal length', focal ? `${Number(focal.toFixed(1))} mm${focal35 ? `  (${focal35} mm full frame)` : ''}` : undefined],
      ['Compensation', bias ? `${bias > 0 ? '+' : ''}${Number(bias.toFixed(1))} EV` : undefined],
      ['Flash', flash !== undefined ? (flash & 1 ? 'Fired' : 'Off') : undefined],
      ['Software', str(tiff['Software'])],
    ]))

    let lat = num(gps['Latitude'])
    let lon = num(gps['Longitude'])
    if (lat !== undefined && lon !== undefined) {
      if (gps['LatitudeRef'] === 'S') lat = -lat
      if (gps['LongitudeRef'] === 'W') lon = -lon
      const alt = num(gps['Altitude'])
      const place = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`
      const mapBtn = document.createElement('button')
      mapBtn.className = 'viewer-info-link'
      mapBtn.textContent = 'Open in Maps'
      const [la, lo] = [lat, lon]
      mapBtn.addEventListener('click', () => void window.viewer.meta.openUrl(`https://maps.apple.com/?ll=${la},${lo}&q=${encodeURIComponent(entry.name)}`))
      sections.push(section('Place', [
        ['Position', place],
        ['Altitude', alt !== undefined ? `${Math.round(alt)} m` : undefined],
        ['Map', mapBtn],
      ]))
    }

    const depth = num(p['Depth'])
    sections.push(section('Color', [
      ['Profile', str(p['ProfileName'])],
      ['Model', str(p['ColorModel'])],
      ['Depth', depth ? `${depth}-bit` : undefined],
      ['Transparency', p['HasAlpha'] === true ? 'Yes' : undefined],
    ]))

    root.replaceChildren(...sections.filter((s): s is HTMLElement => s !== null))
  }

  return {
    root,
    isOpen: () => open,
    toggle: () => {
      open = !open
      root.hidden = !open
      try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* not kept */ }
      if (open && current) void render(current)
      onToggle()
    },
    show: (entry) => {
      current = entry
      if (open) void render(entry)
    },
  }
}
