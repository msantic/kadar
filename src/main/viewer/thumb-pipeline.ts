import { app, utilityProcess, type UtilityProcess, type BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { kindOf } from './formats'
import { lookup, reserveTarget, ensureCacheDir, evictIfNeeded } from './thumb-cache'
import type { ThumbJob, WorkerIn, WorkerOut } from './thumb-worker-ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface FileInfo { srcPath: string; mtimeMs: number; size: number }

export interface ThumbRequestResult {
  cached: Record<string, string>
  pending: string[]
}

let worker: UtilityProcess | null = null
let mainWin: BrowserWindow | null = null

function resolveFfmpegPath(): string {
  const require_ = createRequire(import.meta.url)
  const raw = require_('ffmpeg-static') as string
  return raw.includes('app.asar') ? raw.replace('app.asar', 'app.asar.unpacked') : raw
}

function spawnWorker(): void {
  const workerPath = path.join(__dirname, 'viewer/thumb-worker.js')
  console.log('[thumb-pipeline] spawning worker at', workerPath)
  worker = utilityProcess.fork(workerPath, [], { serviceName: 'viewer-thumb-worker' })
  worker.on('message', (msg: WorkerOut) => {
    console.log('[thumb-pipeline] worker msg:', msg.type, msg.type === 'ready' ? msg.srcPath : '')
    if (!mainWin || mainWin.isDestroyed()) return
    if (msg.type === 'ready') {
      mainWin.webContents.send('viewer:thumb:ready', {
        requestId: msg.requestId, srcPath: msg.srcPath, cachePath: msg.cachePath,
      })
    } else if (msg.type === 'error') {
      mainWin.webContents.send('viewer:thumb:error', {
        requestId: msg.requestId, srcPath: msg.srcPath, message: msg.message,
      })
    } else if (msg.type === 'done') {
      mainWin.webContents.send('viewer:thumb:done', { requestId: msg.requestId })
    }
  })
  worker.on('exit', (code) => {
    console.log('[thumb-pipeline] worker exited with code:', code)
    worker = null
  })
  worker.stdout?.on('data', (data: Buffer) => console.log('[thumb-worker stdout]', data.toString()))
  worker.stderr?.on('data', (data: Buffer) => console.error('[thumb-worker stderr]', data.toString()))
  const init: WorkerIn = { type: 'init', ffmpegPath: resolveFfmpegPath() }
  worker.postMessage(init)
}

function ensureWorker(): UtilityProcess {
  if (!worker) spawnWorker()
  return worker!
}

export function initPipeline(win: BrowserWindow): void {
  mainWin = win
  void ensureCacheDir().then(() => {
    spawnWorker()
    void evictIfNeeded()
    setInterval(() => { void evictIfNeeded() }, 60 * 60 * 1000).unref()
  })
  app.on('before-quit', () => {
    worker?.kill()
    worker = null
  })
}

export async function handleRequest(
  requestId: string,
  files: FileInfo[],
  targetSize: number,
): Promise<ThumbRequestResult> {
  const cached: Record<string, string> = {}
  const jobs: ThumbJob[] = []

  await Promise.all(files.map(async (f) => {
    const kind = kindOf(f.srcPath)
    if (kind === 'unsupported') return
    const hit = await lookup({ srcPath: f.srcPath, mtimeMs: f.mtimeMs, size: f.size, targetSize })
    if (hit) {
      cached[f.srcPath] = hit
      return
    }
    const { targetPath } = await reserveTarget({ srcPath: f.srcPath, mtimeMs: f.mtimeMs, size: f.size, targetSize })
    jobs.push({
      srcPath: f.srcPath, kind, targetSize, targetPath, mtimeMs: f.mtimeMs, size: f.size,
    })
  }))

  if (jobs.length > 0) {
    console.log('[thumb-pipeline] dispatching', jobs.length, 'jobs for request', requestId)
    const w = ensureWorker()
    const msg: WorkerIn = { type: 'gen', requestId, jobs }
    w.postMessage(msg)
  } else {
    console.log('[thumb-pipeline] all', files.length, 'files were cached')
  }

  return { cached, pending: jobs.map((j) => j.srcPath) }
}

export function handleCancel(requestId: string): void {
  if (!worker) return
  const msg: WorkerIn = { type: 'cancel', requestId }
  worker.postMessage(msg)
}
