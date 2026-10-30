import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { thumbnailsDir } from '../storage/database'
import { generateThumbnail, readDuration } from './track.service'

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/

/** Captura a 12% da duracao: evita telas pretas e logos do inicio. */
const CAPTURE_RATIO = 0.12

export interface GeneratedThumbnail {
  path: string
  duration: number
}

export const thumbnailService = {
  /**
   * Gera a miniatura inteiramente no processo principal, via ffmpeg.
   * Nao usa o decodificador do renderer, entao nao concorre com o video
   * que o usuario esta assistindo.
   */
  async generate(videoId: string, videoPath: string): Promise<GeneratedThumbnail | null> {
    const duration = await readDuration(videoPath)
    const at = duration > 0 ? duration * CAPTURE_RATIO : 5
    const outPath = join(thumbnailsDir(), `${videoId}.jpg`)

    const ok = await generateThumbnail(videoPath, outPath, at)
    if (!ok) return null
    return { path: outPath, duration }
  },

  /** Mantido para miniaturas escolhidas manualmente pelo usuario. */
  async saveDataUrl(videoId: string, dataUrl: string): Promise<string> {
    const match = DATA_URL.exec(dataUrl)
    if (!match) throw new Error('Miniatura invalida: esperado data URL de imagem.')

    const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
    const file = join(thumbnailsDir(), `${videoId}.${extension}`)
    await fs.writeFile(file, Buffer.from(match[2], 'base64'))
    return file
  },

  async remove(path: string | null): Promise<void> {
    if (!path) return
    try {
      await fs.unlink(path)
    } catch {
      // miniatura ja removida
    }
  }
}
