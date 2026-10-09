// Shared utilities for Record and Screenshot tabs — window picker, resize, save directory.
// The Optimize tab uses the element and form-value helpers too. Talks to Rust through
// `window.optimizer` (see installCaptureBridge in bridge.ts).

import { readStored, writeStored } from './storage'

declare const window: Window & {
  optimizer: {
    getRunningApps: () => Promise<string[]>
    resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) => Promise<void>
    chooseDirectory: () => Promise<string | null>
  }
}

/** Window sizes and top-left positions in points, keyed by the preset menu's value. */
export const SIZE_PRESETS: Record<string, { width: number; height: number; x: number; y: number }> = {
  '1944x1100': { width: 1944, height: 1100, x: 100, y: 80 },
  '1920x1080': { width: 1920, height: 1080, x: 0, y: 0 },
  '1280x720': { width: 1280, height: 720, x: 0, y: 0 },
  '2560x1440': { width: 2560, height: 1440, x: 0, y: 0 },
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

/** The element with this id. Not checked: a missing id gives null typed as T. */
export function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/** Removes the `hidden` attribute. A missing id is ignored. */
export function show(id: string): void {
  document.getElementById(id)?.removeAttribute('hidden')
}

/** Sets the `hidden` attribute. A missing id is ignored. */
export function hide(id: string): void {
  document.getElementById(id)?.setAttribute('hidden', '')
}

// ─── Running Apps ─────────────────────────────────────────────────────────────

/** Fills the `<select>` with the names of running apps. On failure it shows one disabled line. */
export async function loadRunningApps(selectId: string): Promise<void> {
  const select = el<HTMLSelectElement>(selectId)
  select.innerHTML = '<option>Loading…</option>'
  try {
    const apps = await window.optimizer.getRunningApps()
    select.innerHTML = ''
    if (apps.length === 0) {
      select.innerHTML = '<option disabled value="">No apps found</option>'
      return
    }
    for (const appName of apps) {
      const opt = document.createElement('option')
      opt.value = appName
      opt.textContent = appName
      select.appendChild(opt)
    }
  } catch (err) {
    select.innerHTML = '<option disabled value="">Failed to list apps</option>'
    select.title = String(err)
  }
}

// ─── Aspect Ratio ─────────────────────────────────────────────────────────────

const COMMON_RATIOS: [number, number, string][] = [
  [16, 9, '16:9'],
  [16, 10, '16:10'],
  [4, 3, '4:3'],
  [3, 2, '3:2'],
  [21, 9, '21:9'],
  [32, 9, '32:9'],
  [5, 4, '5:4'],
  [1, 1, '1:1'],
]

/** The nearest common ratio such as "16:9", or '' when none is within 2%. */
export function formatRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return ''
  const actual = w / h
  let best = ''
  let bestDiff = Infinity
  for (const [rw, rh, label] of COMMON_RATIOS) {
    const diff = Math.abs(actual - rw / rh)
    if (diff < bestDiff) {
      bestDiff = diff
      best = label
    }
  }
  // Only show if within 2% of a common ratio
  if (bestDiff / actual < 0.02) return best
  return ''
}

// ─── Preset / Resize ──────────────────────────────────────────────────────────

/** Wires the size preset menu: a preset fills and locks width and height; "custom" unlocks them. */
export function setupPresetChange(
  presetSelectId: string,
  wInputId: string,
  hInputId: string,
  dimInputsId: string,
  ratioId?: string,
): void {
  const presetSelect = el<HTMLSelectElement>(presetSelectId)
  const dimInputs = el(dimInputsId)
  const wInput = el<HTMLInputElement>(wInputId)
  const hInput = el<HTMLInputElement>(hInputId)
  const ratioEl = ratioId ? el(ratioId) : null

  const update = (): void => {
    const preset = SIZE_PRESETS[presetSelect.value]
    if (preset) {
      wInput.value = String(preset.width)
      hInput.value = String(preset.height)
      dimInputs.style.opacity = '0.5'
      wInput.readOnly = true
      hInput.readOnly = true
    } else {
      dimInputs.style.opacity = '1'
      wInput.readOnly = false
      hInput.readOnly = false
    }
    if (ratioEl) {
      ratioEl.textContent = formatRatio(parseInt(wInput.value, 10), parseInt(hInput.value, 10))
    }
  }

  presetSelect.addEventListener('change', update)
  if (ratioEl) {
    wInput.addEventListener('input', update)
    hInput.addEventListener('input', update)
  }
  update()
}

/** Resizes the chosen app's front window and moves it to the preset's position (0, 0 for Custom). Shows the result on the button. */
export async function doResize(
  windowSelectId: string,
  wInputId: string,
  hInputId: string,
  presetSelectId: string,
  resizeBtnId: string,
): Promise<void> {
  const windowSelect = el<HTMLSelectElement>(windowSelectId)
  const selectedOpt = windowSelect.selectedOptions[0]
  if (!selectedOpt) return

  const appName = selectedOpt.value || selectedOpt.textContent || ''
  const wInput = el<HTMLInputElement>(wInputId)
  const hInput = el<HTMLInputElement>(hInputId)
  const presetSelect = el<HTMLSelectElement>(presetSelectId)
  const preset = SIZE_PRESETS[presetSelect.value]

  const width = parseInt(wInput.value, 10)
  const height = parseInt(hInput.value, 10)
  const x = preset?.x ?? 0
  const y = preset?.y ?? 0

  const btn = el<HTMLButtonElement>(resizeBtnId)
  btn.textContent = 'Resizing…'
  btn.disabled = true

  try {
    await window.optimizer.resizeWindow({ app: appName, width, height, x, y })
    btn.textContent = 'Done ✓'
    setTimeout(() => {
      btn.textContent = 'Resize'
      btn.disabled = false
    }, 1500)
  } catch (err) {
    btn.textContent = 'Failed'
    btn.title = String(err)
    btn.disabled = false
    setTimeout(() => {
      btn.textContent = 'Resize'
      btn.title = ''
    }, 3000)
  }
}

// ─── Save Directory ───────────────────────────────────────────────────────────

/** The saved output folder, or `defaultDir` when none is saved. */
export function getSaveDir(storageKey: string, defaultDir: string): string {
  return readStored(storageKey) || defaultDir
}

/** Wires the "choose folder" button: saves the choice, shows it, then calls `onChange`. */
export function setupSaveDir(
  dirElId: string,
  btnId: string,
  storageKey: string,
  onChange: (dir: string) => void,
): void {
  el(btnId).addEventListener('click', async () => {
    const dir = await window.optimizer.chooseDirectory()
    if (dir) {
      writeStored(storageKey, dir)
      el(dirElId).textContent = dir
      onChange(dir)
    }
  })
}

// ─── Persist form values ─────────────────────────────────────────────────────

/**
 * Restore a form element's value from localStorage and auto-save on change.
 * Works with <select>, <input type="number/text">, and <input type="checkbox">.
 */
export function persist(elementId: string, storageKey?: string): void {
  const key = storageKey ?? `persist:${elementId}`
  const element = document.getElementById(elementId) as HTMLInputElement | HTMLSelectElement | null
  if (!element) return

  const saved = readStored(key)

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    if (saved !== null) element.checked = saved === '1'
    element.addEventListener('change', () => {
      writeStored(key, element.checked ? '1' : '0')
    })
  } else {
    if (saved !== null) element.value = saved
    element.addEventListener('change', () => {
      writeStored(key, element.value)
    })
    // Also save on input for number fields (as user types)
    if (element instanceof HTMLInputElement) {
      element.addEventListener('input', () => {
        writeStored(key, element.value)
      })
    }
  }
}
