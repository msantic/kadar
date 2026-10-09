// Kadar window: Viewer, Optimize, Record and Screenshot tabs, running on the Rust backend.

import './style.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { installCaptureBridge, installViewerBridge } from './bridge'
import type { OpenItem } from './viewer'
import { initOptimize } from './optimize'

installViewerBridge()
installCaptureBridge()

// Safety net: an error that no code handles still tells the user, in the viewer's message line.
window.addEventListener('unhandledrejection', (e) => {
  const reason: unknown = e.reason
  const text = reason instanceof Error ? reason.message : String(reason)
  void import('./viewer/bus').then(({ emit }) => emit('toast', { text: `Something failed: ${text}` }))
})

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

function switchTab(tab: string, open: OpenItem[] = []): void {
  if (!(tab in panels)) tab = 'viewer'
  activeTab = tab
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== tab
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset['tab'] === tab)
  })
  try { localStorage.setItem('persist:active-tab', tab) } catch { /* private mode */ }

  // Loaded after the bridge exists: the viewer reads `window.viewer` when its modules load.
  if (tab === 'viewer') {
    if (!viewerStarted) {
      viewerStarted = true
      void import('./viewer').then(({ initViewer }) => initViewer(open))
    } else if (open.length > 0) {
      void import('./viewer').then(({ openItems }) => openItems(open))
    }
  }
  if (tab === 'record' && !recorderStarted) {
    recorderStarted = true
    void import('./recorder').then(({ initRecorder }) => initRecorder())
  }
  if (tab === 'screenshot' && !screenshotStarted) {
    screenshotStarted = true
    void import('./screenshot').then(({ initScreenshot }) => initScreenshot())
  }
}

document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset['tab'] ?? 'viewer'))
})

initOptimize(() => activeTab === 'optimize')

let saved: string | null = null
try { saved = localStorage.getItem('persist:active-tab') } catch { /* private mode */ }

// Commands that are safe to run when they arrive from another tab: they only open or arrange
// the viewer. Commands on the selected files (Trash, Rename, Export, ...) must not run on a
// selection the user cannot see, so from another tab they only bring the viewer to the front.
const SAFE_FROM_OTHER_TABS = /^(open-folder|filter|zoom-in|zoom-out|go:.*|sort:.*)$/

// Menu bar: tabs switch here; everything else is a viewer command, shown in the viewer.
void listen<string>('menu', (e) => {
  const id = e.payload
  if (id.startsWith('tab:')) { switchTab(id.slice(4)); return }
  const fromOtherTab = activeTab !== 'viewer'
  switchTab('viewer')
  if (fromOtherTab && !SAFE_FROM_OTHER_TABS.test(id)) return
  void import('./viewer/bus').then(({ emit }) => emit('menu', { id }))
})

// Files opened from Finder: at launch they wait in Rust; later ones announce themselves.
// Listen first, then take, so none is missed in between.
const takeOpened = (): Promise<OpenItem[]> => invoke<OpenItem[]>('take_opened')
void listen('open-paths', async () => {
  const items = await takeOpened()
  if (items.length > 0) switchTab('viewer', items)
}).then(async () => {
  const items = await takeOpened()
  switchTab(items.length > 0 ? 'viewer' : saved ?? 'viewer', items)
})
