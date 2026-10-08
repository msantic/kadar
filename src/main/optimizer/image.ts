import path from 'path'
import fs from 'fs-extra'
import sharp from 'sharp'
import slugify from 'slugify'

export interface ImageProgressEvent {
  file: string
  status: 'processing' | 'done' | 'skipped' | 'error'
  outPath?: string
  error?: string
}

export type ImageFormat = 'webp' | 'png' | 'jpg'

export interface ImageOptions {
  maxWidth?: number
  format?: ImageFormat
  onProgress?: (event: ImageProgressEvent) => void
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png'])

async function findImages(dir: string): Promise<string[]> {
  const results: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip our own output dir — with png/jpg output it holds the same
      // extensions we scan for, which would feed results back as inputs.
      if (entry.name === 'optimized') continue
      results.push(...(await findImages(full)))
    } else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
  return results
}

/** Apply the encoder for the requested output format. PNG stays lossless — it is
 *  usually picked for transparency or crisp UI art, where quantisation shows. */
function encode(pipeline: sharp.Sharp, format: ImageFormat): sharp.Sharp {
  if (format === 'png') return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
  if (format === 'jpg') return pipeline.jpeg({ quality: 80, mozjpeg: true })
  return pipeline.webp({ quality: 80 })
}

export async function optimizeImages(
  inputPath: string,
  options: ImageOptions = {},
): Promise<void> {
  const { maxWidth = 1600, format = 'webp', onProgress = () => {} } = options

  const stat = await fs.stat(inputPath)
  const isSingleFile = stat.isFile()

  const files = isSingleFile ? [inputPath] : await findImages(inputPath)
  const outputDir = isSingleFile
    ? path.join(path.dirname(inputPath), 'optimized')
    : path.join(inputPath, 'optimized')

  await fs.ensureDir(outputDir)

  for (const file of files) {
    const friendlyName = slugify(path.parse(file).name, { lower: true, strict: true })
    const outPath = path.join(outputDir, `${friendlyName}.${format}`)

    if (await fs.pathExists(outPath)) {
      onProgress({ file, status: 'skipped', outPath })
      continue
    }

    onProgress({ file, status: 'processing' })

    try {
      await encode(
        sharp(file).resize({ width: maxWidth, withoutEnlargement: true }).rotate(),
        format,
      ).toFile(outPath)

      onProgress({ file, status: 'done', outPath })
    } catch (err) {
      onProgress({ file, status: 'error', error: (err as Error).message })
    }
  }
}
