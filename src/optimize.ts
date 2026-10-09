// Optimize tab: drop files or folders, get web-ready copies in an "optimized" folder beside them.
// Drops arrive through Tauri, which gives real file paths.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { el, hide, persist, show } from './shared'
import { words } from './platform'
import { baseName } from './paths'

interface Progress {
  file: string
  status: 'processing' | 'done' | 'skipped' | 'error'
  percent?: number
  outPath?: string
  error?: string
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'])


interface QueueItem { el: HTMLLIElement; status: string }
const items = new Map<string, QueueItem>()

let startJob: ((paths: string[]) => Promise<number>) | null = null

/** Optimizes files from elsewhere (the viewer) with this tab's settings; they also show in its list.
 *  Returns how many files it took. */
export function optimizePaths(paths: string[]): Promise<number> {
  if (!startJob) return Promise.reject(new Error('The optimizer is not ready.'))
  return startJob(paths)
}

/** Wires the Optimize tab once at launch. `isActive` says whether the tab is in front; drops count only then. */
export function initOptimize(isActive: () => boolean): void {
  const dropZone = el('drop-zone')
  const queue = el('queue')
  const fileList = el('file-list')
  const summary = el('queue-summary')
  const imageFormat = el<HTMLSelectElement>('image-format')

  persist('image-format')
  persist('max-width')
  persist('video-preset')

  const updateDropSub = (): void => {
    const label = imageFormat.selectedOptions[0]?.textContent ?? 'WebP'
    el('drop-sub').innerHTML = `Images → ${label} &nbsp;·&nbsp; MOV, MP4, MKV, WebM, AVI → compressed MP4`
  }
  imageFormat.addEventListener('change', updateDropSub)
  updateDropSub()

  void getCurrentWebview().onDragDropEvent(async (event) => {
    if (!isActive()) return
    const p = event.payload
    if (p.type === 'enter' || p.type === 'over') {
      dropZone.classList.add('drag-over')
    } else if (p.type === 'leave') {
      dropZone.classList.remove('drag-over')
    } else if (p.type === 'drop') {
      dropZone.classList.remove('drag-over')
      hide('optimize-error')
      await start(p.paths).catch((err) => {
        el('optimize-error').textContent = `Optimize failed: ${String(err)}`
        show('optimize-error')
      })
    }
  })

  void listen<Progress>('file-progress', (e) => onProgress(e.payload))

  el('clear-btn').addEventListener('click', () => {
    items.clear()
    fileList.innerHTML = ''
    queue.hidden = true
    summary.textContent = ''
  })

  startJob = start

  async function start(paths: string[]): Promise<number> {
    const files = await invoke<string[]>('optimize_expand', { paths })
    if (files.length === 0) return 0
    files.forEach(addToQueue)
    const options = {
      maxWidth: parseInt(el<HTMLSelectElement>('max-width').value, 10),
      imageFormat: imageFormat.value,
      videoPreset: el<HTMLSelectElement>('video-preset').value,
    }
    await invoke('optimize_files', { files, options })
    return files.length
  }

  function onProgress(data: Progress): void {
    if (!items.has(data.file)) addToQueue(data.file)
    const item = items.get(data.file)!
    item.status = data.status
    item.el.dataset['status'] = data.status
    const statusEl = item.el.querySelector('.item-status')!

    if (data.status === 'processing') {
      statusEl.textContent = data.percent && data.percent > 0 ? `${data.percent}%` : 'Processing…'
    } else if (data.status === 'done' || data.status === 'skipped') {
      statusEl.textContent = data.status === 'done' ? 'Done ✓' : 'Already exists'
      if (data.outPath) {
        const outPath = data.outPath
        const pathEl = item.el.querySelector('.item-path') as HTMLElement
        pathEl.textContent = `${words.showInFileManager} →`
        pathEl.style.cursor = 'pointer'
        pathEl.onclick = () => void invoke('reveal_in_finder', { path: outPath })
      }
    } else if (data.status === 'error') {
      statusEl.textContent = `Error: ${data.error}`
    }
    updateSummary()
  }

  function addToQueue(filePath: string): void {
    if (items.has(filePath)) return
    queue.hidden = false
    const fileName = baseName(filePath)
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
    const kind = VIDEO_EXTS.has(ext) ? 'video' : 'image'

    const li = document.createElement('li')
    li.className = 'queue-item'
    li.dataset['status'] = 'queued'
    const type = document.createElement('span')
    type.className = `item-type ${kind}`
    type.textContent = kind
    const info = document.createElement('div')
    info.className = 'item-info'
    const name = document.createElement('span')
    name.className = 'item-name'
    name.textContent = fileName
    const path = document.createElement('span')
    path.className = 'item-path'
    path.textContent = filePath
    info.append(name, path)
    const status = document.createElement('span')
    status.className = 'item-status'
    status.textContent = 'Queued'
    li.append(type, info, status)

    fileList.appendChild(li)
    items.set(filePath, { el: li, status: 'queued' })
    updateSummary()
  }

  function updateSummary(): void {
    const done = [...items.values()].filter((i) => i.status === 'done' || i.status === 'skipped').length
    summary.textContent = `${done} of ${items.size} complete`
  }
}
