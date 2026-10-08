// Kadar window: Viewer and Optimize tabs, running on the Rust backend.

import '../src/renderer/style.css'
import { installCaptureBridge, installViewerBridge } from './bridge'
import { initOptimize } from './optimize'

installViewerBridge()
installCaptureBridge()

const panels: Record<string, HTMLElement> = {
  viewer: document.getElementById('panel-viewer')!,
  optimize: document.getElementById('panel-optimize')!,
  record: document.getElementById('panel-record')!,
  screenshot: document.getElementById('panel-screenshot')!,
}
let activeTab = 'viewer'
let viewerStarted = false
let screenshotStarted = false
let recorderStarted = false

function switchTab(tab: string): void {
  if (!(tab in panels)) tab = 'viewer'
  activeTab = tab
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== tab
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset['tab'] === tab)
  })
  try { localStorage.setItem('persist:active-tab', tab) } catch { /* private mode */ }

  // Loaded after the bridge exists: the viewer reads `window.viewer` when its modules load.
  if (tab === 'viewer' && !viewerStarted) {
    viewerStarted = true
    void import('../src/renderer/viewer').then(({ initViewer }) => initViewer())
  }
  if (tab === 'record' && !recorderStarted) {
    recorderStarted = true
    void import('./recorder').then(({ initRecorder }) => initRecorder())
  }
  if (tab === 'screenshot' && !screenshotStarted) {
    screenshotStarted = true
    void import('../src/renderer/screenshot').then(({ initScreenshot }) => initScreenshot())
  }
}

document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset['tab'] ?? 'viewer'))
})

initOptimize(() => activeTab === 'optimize')

let saved: string | null = null
try { saved = localStorage.getItem('persist:active-tab') } catch { /* private mode */ }
switchTab(saved ?? 'viewer')
