import type { Kind } from './formats'

export interface ThumbJob {
  srcPath: string
  kind: Kind
  targetSize: number
  targetPath: string
  mtimeMs: number
  size: number
}

export type WorkerIn =
  | { type: 'init'; ffmpegPath: string }
  | { type: 'gen'; requestId: string; jobs: ThumbJob[] }
  | { type: 'cancel'; requestId: string }

export type WorkerOut =
  | { type: 'ready'; requestId: string; srcPath: string; cachePath: string }
  | { type: 'error'; requestId: string; srcPath: string; message: string }
  | { type: 'done';  requestId: string }
