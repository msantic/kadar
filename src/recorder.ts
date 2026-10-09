// Record tab: pick a window or the whole screen, count down, record, stop, save an MP4.
// The Mac records (ScreenCaptureKit); Rust makes the final file. No browser recording here.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { doResize, el, getSaveDir, hide, persist, setupPresetChange, setupSaveDir, show } from './shared'

const WHOLE_SCREEN = '__screen__'
const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

interface Microphone { id: string; name: string }

let saveDir = '~/Movies/Recordings'
let timer: ReturnType<typeof setInterval> | null = null
let busy = false

export async function initRecorder(): Promise<void> {
  saveDir = getSaveDir('recorder-save-dir', saveDir)
  el('save-dir').textContent = saveDir

  for (const id of ['size-preset', 'dim-w', 'dim-h', 'system-audio-toggle', 'normalize-audio-toggle', 'raw-output-toggle']) {
    persist(id)
  }

  await checkScreenAccess()
  await loadTargets()
  persist('window-select')
  await loadMicrophones()
  persist('mic-select')

  el('refresh-sources-btn').addEventListener('click', () => void loadTargets())
  el('perm-settings-btn').addEventListener('click', () => void invoke('open_external', { url: SETTINGS_URL }))
  setupPresetChange('size-preset', 'dim-w', 'dim-h', 'dim-inputs', 'dim-ratio')
  el('resize-btn').addEventListener('click', () => {
    if (el<HTMLSelectElement>('window-select').value === WHOLE_SCREEN) return
    void doResize('window-select', 'dim-w', 'dim-h', 'size-preset', 'resize-btn')
  })
  setupSaveDir('save-dir', 'choose-dir-btn', 'recorder-save-dir', (dir) => { saveDir = dir })
  el('record-btn').addEventListener('click', () => void start())
  el('stop-btn').addEventListener('click', () => void stop())
  el('show-result-btn').addEventListener('click', () => {
    const path = el<HTMLButtonElement>('show-result-btn').dataset['path']
    if (path) void invoke('reveal_in_finder', { path })
  })

  // The Mac stopped the recording on its own (for example a failed first frame).
  void listen<string>('record-failed', (e) => {
    stopTimer()
    hide('record-active')
    show('record-idle')
    showError(`Recording stopped: ${e.payload}`)
    void invoke('record_stop').catch(() => {})
  })

  void listen<number>('record-progress', (e) => {
    el('stop-btn').textContent = `Saving… ${e.payload}%`
  })
}

/** Errors show in the Record tab itself; the page cannot rely on pop-up alerts. */
function showError(text: string): void {
  el('record-error').textContent = text
  show('record-error')
}

async function checkScreenAccess(): Promise<boolean> {
  const perms = await invoke<{ screen: string }>('capture_permissions')
  if (perms.screen === 'granted') {
    hide('perm-warning')
    return true
  }
  el('perm-warning-text').textContent =
    'Allow Kadar in System Settings → Privacy & Security → Screen Recording, then reopen Kadar.'
  el('perm-settings-btn').style.display = 'inline-block'
  show('perm-warning')
  return false
}

async function loadTargets(): Promise<void> {
  const select = el<HTMLSelectElement>('window-select')
  const previous = select.value
  const apps = await invoke<string[]>('capture_running_apps')
  select.innerHTML = ''
  const screen = new Option('Entire screen', WHOLE_SCREEN)
  select.append(screen, ...apps.map((name) => new Option(name, name)))
  if (previous && [...select.options].some((o) => o.value === previous)) select.value = previous
}

async function loadMicrophones(): Promise<void> {
  const select = el<HTMLSelectElement>('mic-select')
  const mics = await invoke<Microphone[]>('record_microphones')
  select.innerHTML = ''
  select.append(new Option('None', ''), ...mics.map((m) => new Option(m.name, m.id)))
}

function beep(isGo: boolean): void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = isGo ? 880 : 440
  const duration = isGo ? 0.35 : 0.12
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.start()
  osc.stop(ctx.currentTime + duration)
  setTimeout(() => void ctx.close(), duration * 1000 + 100)
}

/** 3, 2, 1 with beeps and a Dock badge, so you can switch to the app you record. */
async function countdown(): Promise<void> {
  const number = el('countdown-number')
  const win = getCurrentWindow()
  show('countdown-overlay')
  for (let n = 3; n > 0; n--) {
    number.textContent = String(n)
    number.style.animation = 'none'
    void number.offsetHeight // restart the CSS animation
    number.style.animation = ''
    beep(false)
    void win.setBadgeLabel(String(n))
    await new Promise((r) => setTimeout(r, 1000))
  }
  beep(true)
  void win.setBadgeLabel(undefined)
  hide('countdown-overlay')
}

async function start(): Promise<void> {
  if (busy) return
  busy = true
  try {
    if (!(await checkScreenAccess())) return
    const micId = el<HTMLSelectElement>('mic-select').value
    if (micId && (await invoke<string>('record_mic_access')) !== 'granted') {
      showError('Kadar cannot use the microphone. Allow it in System Settings → Privacy & Security → Microphone.')
      return
    }
    hide('record-result')
    hide('record-error')
    await countdown()
    await invoke('record_start', {
      options: {
        target: el<HTMLSelectElement>('window-select').value || WHOLE_SCREEN,
        micId: micId || null,
        systemAudio: el<HTMLInputElement>('system-audio-toggle').checked,
        outputDir: saveDir,
        normalizeAudio: el<HTMLInputElement>('normalize-audio-toggle').checked,
        rawOutput: el<HTMLInputElement>('raw-output-toggle').checked,
      },
    })
    hide('record-idle')
    show('record-active')
    startTimer()
  } catch (err) {
    showError(`Recording failed: ${String(err)}`)
  } finally {
    busy = false
  }
}

async function stop(): Promise<void> {
  if (busy) return
  busy = true
  stopTimer()
  const stopBtn = el<HTMLButtonElement>('stop-btn')
  stopBtn.textContent = 'Saving…'
  stopBtn.disabled = true
  try {
    const path = await invoke<string>('record_stop')
    el('result-path').textContent = path.split('/').pop() ?? path
    el<HTMLButtonElement>('show-result-btn').dataset['path'] = path
    show('record-result')
  } catch (err) {
    showError(`Saving failed: ${String(err)}`)
  } finally {
    hide('record-active')
    show('record-idle')
    stopBtn.textContent = 'Stop'
    stopBtn.disabled = false
    busy = false
  }
}

function startTimer(): void {
  let seconds = 0
  const draw = (): void => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    el('record-timer').textContent = `${m}:${s}`
  }
  draw()
  timer = setInterval(() => { seconds++; draw() }, 1000)
}

function stopTimer(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}
