export type Kind = 'image' | 'video' | 'unsupported'

const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'svg',
])

const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'm4v', 'webm',
])

export function extOf(filePath: string): string {
  const i = filePath.lastIndexOf('.')
  if (i < 0) return ''
  return filePath.slice(i + 1).toLowerCase()
}

export function kindOf(filePath: string): Kind {
  const ext = extOf(filePath)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return 'unsupported'
}

export function isSupported(filePath: string): boolean {
  return kindOf(filePath) !== 'unsupported'
}

export const SUPPORTED_EXTS = new Set<string>([...IMAGE_EXTS, ...VIDEO_EXTS])
