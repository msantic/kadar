// Shared utilities for Record and Screenshot tabs — window picker, resize, save directory

declare const window: Window & {
  optimizer: {
    getRunningApps: () => Promise<string[]>
    resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) => Promise<void>
    chooseDirectory: () => Promise<string | null>
  }
}

export const SIZE_PRESETS: Record<string, { width: number; height: number; x: number; y: number }> = {
  '1944x1100': { width: 1944, height: 1100, x: 100, y: 80 },
  '1920x1080': { width: 1920, height: 1080, x: 0, y: 0 },
  '1280x720': { width: 1280, height: 720, x: 0, y: 0 },
  '2560x1440': { width: 2560, height: 1440, x: 0, y: 0 },
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

export function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export function show(id: string): void {
  document.getElementById(id)?.removeAttribute('hidden')
}

export function hide(id: string): void {
  document.getElementById(id)?.setAttribute('hidden', '')
}

// ─── Running Apps ─────────────────────────────────────────────────────────────

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
    console.error('getRunningApps failed:', err)
    select.innerHTML = '<option disabled value="">Failed to list apps</option>'
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
    btn.disabled = false
    console.error('resize-window failed:', err)
  }
}

// ─── Save Directory ───────────────────────────────────────────────────────────

export function getSaveDir(storageKey: string, defaultDir: string): string {
  return localStorage.getItem(storageKey) || defaultDir
}

export function setupSaveDir(
  dirElId: string,
  btnId: string,
  storageKey: string,
  onChange: (dir: string) => void,
): void {
  el(btnId).addEventListener('click', async () => {
    const dir = await window.optimizer.chooseDirectory()
    if (dir) {
      localStorage.setItem(storageKey, dir)
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

  const saved = localStorage.getItem(key)

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    if (saved !== null) element.checked = saved === '1'
    element.addEventListener('change', () => {
      localStorage.setItem(key, element.checked ? '1' : '0')
    })
  } else {
    if (saved !== null) element.value = saved
    element.addEventListener('change', () => {
      localStorage.setItem(key, element.value)
    })
    // Also save on input for number fields (as user types)
    if (element instanceof HTMLInputElement) {
      element.addEventListener('input', () => {
        localStorage.setItem(key, element.value)
      })
    }
  }
}
