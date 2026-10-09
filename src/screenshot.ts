// Screenshot tab — window picker, resize, capture via screencapture CLI

import { loadRunningApps, setupPresetChange, doResize, getSaveDir, setupSaveDir, el, show, hide, persist, formatRatio } from './shared'

interface ScreenshotBridge {
  getRunningApps: () => Promise<string[]>
  resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) => Promise<void>
  takeScreenshot: (p: { appName: string; outputDir: string; format: 'png' | 'webp'; shadow: boolean; trimPx: number; scale: number }) => Promise<string>
  chooseDirectory: () => Promise<string | null>
  getPermissions: () => Promise<{ screen: string; microphone: string }>
  openInFinder: (dirPath: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
}

declare const window: Window & { optimizer: ScreenshotBridge }

let saveDir = '~/Pictures/Screenshots'

// ─── Init ─────────────────────────────────────────────────────────────────────

/** Wires the Screenshot tab, the first time it opens: saved settings, permission check, app list. */
export async function initScreenshot(): Promise<void> {
  saveDir = getSaveDir('screenshot-save-dir', '~/Pictures/Screenshots')
  el('ss-save-dir').textContent = saveDir

  // Persist form values
  persist('ss-size-preset')
  persist('ss-dim-w')
  persist('ss-dim-h')
  persist('ss-format')
  persist('ss-scale')
  persist('ss-shadow-toggle')
  persist('ss-trim-px')

  await checkPermissions()
  await loadRunningApps('ss-window-select')
  persist('ss-window-select')

  el('ss-refresh-btn').addEventListener('click', () => loadRunningApps('ss-window-select'))
  el('ss-perm-settings-btn').addEventListener('click', () => {
    window.optimizer.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    )
  })
  setupPresetChange('ss-size-preset', 'ss-dim-w', 'ss-dim-h', 'ss-dim-inputs', 'ss-dim-ratio')
  el('ss-resize-btn').addEventListener('click', () =>
    doResize('ss-window-select', 'ss-dim-w', 'ss-dim-h', 'ss-size-preset', 'ss-resize-btn'))
  setupSaveDir('ss-save-dir', 'ss-choose-dir-btn', 'screenshot-save-dir', (dir) => { saveDir = dir })
  el('ss-capture-btn').addEventListener('click', captureScreenshot)
  el('ss-show-result-btn').addEventListener('click', onShowResult)

  // Update output dimensions on any relevant change
  const updateOutputDim = (): void => {
    const w = parseInt(el<HTMLInputElement>('ss-dim-w').value, 10) || 0
    const h = parseInt(el<HTMLInputElement>('ss-dim-h').value, 10) || 0
    const trim = parseInt(el<HTMLInputElement>('ss-trim-px').value, 10) || 0
    const scale = parseInt(el<HTMLSelectElement>('ss-scale').value, 10) || 100
    const trimmedW = w - trim * 2
    const trimmedH = h - trim * 2
    const dimEl = el('ss-output-dim')
    const scaleEl = el('ss-scale-dim')
    // Show trimmed dimensions
    if (trimmedW > 0 && trimmedH > 0 && trim > 0) {
      const ratio = formatRatio(trimmedW, trimmedH)
      dimEl.textContent = `→ ${trimmedW} × ${trimmedH}${ratio ? ` (${ratio})` : ''}`
    } else {
      dimEl.textContent = ''
    }
    // Show scaled output dimensions
    const baseW = trimmedW > 0 ? trimmedW : w
    const baseH = trimmedH > 0 ? trimmedH : h
    const outW = Math.round(baseW * scale / 100)
    const outH = Math.round(baseH * scale / 100)
    if (outW > 0 && outH > 0 && scale < 100) {
      scaleEl.textContent = `→ ${outW} × ${outH}`
    } else {
      scaleEl.textContent = ''
    }
  }
  for (const id of ['ss-dim-w', 'ss-dim-h', 'ss-trim-px', 'ss-size-preset', 'ss-scale']) {
    el(id).addEventListener('input', updateOutputDim)
    el(id).addEventListener('change', updateOutputDim)
  }
  updateOutputDim()
}

// ─── Permissions ──────────────────────────────────────────────────────────────

async function checkPermissions(): Promise<void> {
  const perms = await window.optimizer.getPermissions()
  if (perms.screen !== 'granted') {
    el('ss-perm-warning-text').textContent =
      'Grant Screen Recording access in System Settings → Privacy & Security → Screen Recording'
    show('ss-perm-warning')
  } else {
    hide('ss-perm-warning')
  }
}

// ─── Capture ──────────────────────────────────────────────────────────────────

async function captureScreenshot(): Promise<void> {
  const select = el<HTMLSelectElement>('ss-window-select')
  const appName = select.value
  if (!appName) return

  const format = el<HTMLSelectElement>('ss-format').value as 'png' | 'webp'
  const shadow = el<HTMLInputElement>('ss-shadow-toggle').checked
  const trimPx = parseInt(el<HTMLInputElement>('ss-trim-px').value, 10) || 0
  const scale = parseInt(el<HTMLSelectElement>('ss-scale').value, 10) || 100

  const btn = el<HTMLButtonElement>('ss-capture-btn')
  btn.textContent = 'Capturing…'
  btn.disabled = true
  hide('ss-result')
  hide('ss-error')

  try {
    const filePath = await window.optimizer.takeScreenshot({
      appName,
      outputDir: saveDir,
      format,
      shadow,
      trimPx,
      scale,
    })

    el('ss-result-path').textContent = filePath.split('/').pop() ?? filePath
    el<HTMLButtonElement>('ss-show-result-btn').dataset['path'] = filePath
    show('ss-result')
  } catch (err) {
    // Errors from the Mac side arrive as plain text, not as Error objects.
    el('ss-error').textContent = `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`
    show('ss-error')
  } finally {
    btn.textContent = 'Capture Screenshot'
    btn.disabled = false
  }
}

// ─── Result ───────────────────────────────────────────────────────────────────

function onShowResult(): void {
  const filePath = el<HTMLButtonElement>('ss-show-result-btn').dataset['path']
  if (!filePath) return
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  window.optimizer.openInFinder(dir)
}
