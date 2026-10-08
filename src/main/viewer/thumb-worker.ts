// Runs inside Electron utilityProcess.fork(). Generates image/video thumbnails.
// Receives typed messages from the main process, writes WebP files to the
// provided targetPath, and posts back ready/error/done events.

import os from 'os'
import fs from 'fs-extra'
import { createRequire } from 'module'
import sharp from 'sharp'
import type { ThumbJob, WorkerIn, WorkerOut } from './thumb-worker-ipc'

const require_ = createRequire(import.meta.url)
const ffmpegModule = require_('fluent-ffmpeg')

const parentPort = (process as unknown as { parentPort: NodeJS.EventEmitter & { postMessage: (m: WorkerOut) => void } }).parentPort

const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 6))
const VIDEO_COST = 2

interface QueueItem { requestId: string; job: ThumbJob }
const queue: QueueItem[] = []
const cancelled = new Set<string>()
const inFlightByRequest = new Map<string, number>()
let activeCost = 0
let ffmpegReady = false

function post(msg: WorkerOut): void {
  parentPort.postMessage(msg)
}

function costOf(job: ThumbJob): number {
  return job.kind === 'video' ? VIDEO_COST : 1
}

function pump(): void {
  while (activeCost < POOL_SIZE && queue.length > 0) {
    // Drop head items belonging to cancelled requests.
    while (queue.length > 0 && cancelled.has(queue[0]!.requestId)) {
      queue.shift()
    }
    if (queue.length === 0) break
    const next = queue[0]!
    const cost = costOf(next.job)
    if (activeCost + cost > POOL_SIZE && activeCost > 0) break
    queue.shift()
    activeCost += cost
    inFlightByRequest.set(next.requestId, (inFlightByRequest.get(next.requestId) ?? 0) + 1)
    runJob(next).finally(() => {
      activeCost -= cost
      const n = (inFlightByRequest.get(next.requestId) ?? 1) - 1
      if (n <= 0) {
        inFlightByRequest.delete(next.requestId)
        post({ type: 'done', requestId: next.requestId })
      } else {
        inFlightByRequest.set(next.requestId, n)
      }
      pump()
    })
  }
}

async function runJob(item: QueueItem): Promise<void> {
  const { requestId, job } = item
  try {
    await fs.ensureDir(job.targetPath.slice(0, job.targetPath.lastIndexOf('/')))
    if (job.kind === 'image') {
      await generateImage(job)
    } else if (job.kind === 'video') {
      await generateVideo(job)
    } else {
      throw new Error(`unsupported kind: ${job.kind}`)
    }
    post({ type: 'ready', requestId, srcPath: job.srcPath, cachePath: job.targetPath })
  } catch (err) {
    post({
      type: 'error', requestId, srcPath: job.srcPath,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function generateImage(job: ThumbJob): Promise<void> {
  await sharp(job.srcPath, { failOn: 'none', animated: false, pages: 1 })
    .rotate()
    .resize(job.targetSize, job.targetSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toFile(job.targetPath)
}

function generateVideo(job: ThumbJob): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegReady) {
      reject(new Error('ffmpeg not initialized'))
      return
    }
    // Fast-seek: -ss before -i. Seek to 1s (clamped later), grab one frame.
    const tmp = `${job.targetPath}.tmp.png`
    ffmpegModule(job.srcPath)
      .inputOptions(['-ss', '00:00:01.000'])
      .outputOptions([
        '-frames:v', '1',
        '-vf', `scale='min(${job.targetSize},iw)':-2`,
      ])
      .output(tmp)
      .on('end', async () => {
        try {
          await sharp(tmp)
            .resize(job.targetSize, job.targetSize, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 78, effort: 4 })
            .toFile(job.targetPath)
          await fs.remove(tmp).catch(() => {})
          resolve()
        } catch (e) {
          await fs.remove(tmp).catch(() => {})
          reject(e as Error)
        }
      })
      .on('error', async (err: Error) => {
        // Fallback: some videos shorter than 1s — retry at 0.
        await fs.remove(tmp).catch(() => {})
        ffmpegModule(job.srcPath)
          .inputOptions(['-ss', '00:00:00.000'])
          .outputOptions(['-frames:v', '1', '-vf', `scale='min(${job.targetSize},iw)':-2`])
          .output(tmp)
          .on('end', async () => {
            try {
              await sharp(tmp)
                .resize(job.targetSize, job.targetSize, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 78, effort: 4 })
                .toFile(job.targetPath)
              await fs.remove(tmp).catch(() => {})
              resolve()
            } catch (e) {
              await fs.remove(tmp).catch(() => {})
              reject(e as Error)
            }
          })
          .on('error', (e2: Error) => {
            void err
            reject(e2)
          })
          .run()
      })
      .run()
  })
}

console.log('[thumb-worker] started, parentPort:', !!parentPort)

parentPort.on('message', (event: { data: WorkerIn }) => {
  const msg = event.data
  console.log('[thumb-worker] received:', msg.type)
  if (msg.type === 'init') {
    ffmpegModule.setFfmpegPath(msg.ffmpegPath)
    ffmpegReady = true
    console.log('[thumb-worker] init done, ffmpeg path set')
    return
  }
  if (msg.type === 'gen') {
    console.log('[thumb-worker] gen:', msg.jobs.length, 'jobs')
    for (const job of msg.jobs) queue.push({ requestId: msg.requestId, job })
    if (!inFlightByRequest.has(msg.requestId)) inFlightByRequest.set(msg.requestId, 0)
    pump()
    return
  }
  if (msg.type === 'cancel') {
    cancelled.add(msg.requestId)
    // Prune queue eagerly.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i]!.requestId === msg.requestId) queue.splice(i, 1)
    }
    if ((inFlightByRequest.get(msg.requestId) ?? 0) === 0) {
      inFlightByRequest.delete(msg.requestId)
      post({ type: 'done', requestId: msg.requestId })
    }
    return
  }
})
