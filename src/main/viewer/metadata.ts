import sharp from 'sharp'
import fs from 'fs-extra'
import { kindOf } from './formats'

export interface FileMetadata {
  width?: number
  height?: number
  durationMs?: number
  sizeBytes: number
  mtimeMs: number
}

export async function getMetadata(filePath: string): Promise<FileMetadata> {
  const st = await fs.stat(filePath)
  const base: FileMetadata = { sizeBytes: st.size, mtimeMs: st.mtimeMs }
  const kind = kindOf(filePath)
  if (kind === 'image') {
    try {
      const m = await sharp(filePath, { failOn: 'none' }).metadata()
      base.width = m.width
      base.height = m.height
    } catch {}
  }
  // Video duration via ffprobe is phase-2 polish; skip for now.
  return base
}
