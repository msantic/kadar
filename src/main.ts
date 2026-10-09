// Kadar window: Viewer, Optimize, Record and Screenshot tabs, running on the Rust backend.

import './style.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { installCaptureBridge, installViewerBridge } from './bridge'
import type { OpenItem } from './viewer'
import { initOptimize } from './optimize'
import { applyWords, system } from './platform'
import { commandForKey, isBrowserKey } from './shortcuts'

installViewerBridge()
installCaptureBridge()
// Words such as "Show in Finder" follow the system Kadar runs on.
applyWords()

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

/** Tabs this system cannot run yet (Screenshot and Record on Windows); see `platform_features`. */
const unavailable = new Set<string>()

function switchTab(tab: string, open: OpenItem[] = []): void {
  if (!(tab in panels) || unavailable.has(tab)) tab = 'viewer'
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

// Undo, Copy and Select All are Kadar's own menu items. In a text field they act on its text;
// elsewhere on the Viewer's files, but never from another tab.
const EDIT_ITEMS = new Set(['undo', 'copy', 'select-all'])

/** Runs an Edit menu item on the focused text field. False when no text field has the focus. */
function editText(id: string): boolean {
  const field = document.activeElement
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false
  if (id === 'select-all') field.select()
  else if (id === 'undo') document.execCommand('undo')
  else if (id === 'copy') {
    // Number fields have no text selection: copy their whole value.
    const start = field.selectionStart
    const text = start === null ? field.value : field.value.slice(start, field.selectionEnd ?? start)
    if (text) void invoke('copy_text', { text })
  }
  return true
}

/** Runs one command from the menu bar (Mac) or from a key (Windows, Linux): tabs switch here;
 *  everything else is a viewer command, shown in the viewer. */
function runCommand(id: string): void {
  if (id.startsWith('tab:')) { switchTab(id.slice(4)); return }
  if (EDIT_ITEMS.has(id)) {
    if (editText(id) || activeTab !== 'viewer') return
    void import('./viewer/bus').then(({ emit }) => emit('menu', { id }))
    return
  }
  const fromOtherTab = activeTab !== 'viewer'
  switchTab('viewer')
  if (fromOtherTab && !SAFE_FROM_OTHER_TABS.test(id)) return
  void import('./viewer/bus').then(({ emit }) => emit('menu', { id }))
}

// The Mac menu bar sends its clicks and keys as "menu" events.
void listen<string>('menu', (e) => runCommand(e.payload))

// Windows and Linux have no menu bar: the window maps the same keys to the same commands. A key
// that other code in the window takes (preventDefault) does not run twice. Keys that would make
// the browser engine reload, search or go back are stopped first.
if (system !== 'mac') {
  window.addEventListener('keydown', (e) => {
    if (isBrowserKey(e)) e.preventDefault()
    const target = e.target as HTMLElement | null
    const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    const id = commandForKey(e, system, typing)
    if (!id) return
    const stoppedByUs = e.defaultPrevented
    setTimeout(() => { if (stoppedByUs || !e.defaultPrevented) runCommand(id) }, 0)
  }, { capture: true })
}

// Tabs that are not ready on this system yet (Screenshot and Record on Windows) stay hidden.
void invoke<{ screenshot: boolean; record: boolean }>('platform_features').then((f) => {
  const hide = (tab: string): void => {
    unavailable.add(tab)
    document.querySelector<HTMLElement>(`.tab-btn[data-tab="${tab}"]`)?.setAttribute('hidden', '')
    if (activeTab === tab) switchTab('viewer')
  }
  if (!f.screenshot) hide('screenshot')
  if (!f.record) hide('record')
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
