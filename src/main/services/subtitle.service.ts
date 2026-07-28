import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { SubtitleCue, SubtitleTrack } from '@shared/types'

const TIMECODE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

/** Parser de .srt e .vtt (mesma estrutura de blocos separados por linha vazia). */
export function parseSubtitles(content: string): SubtitleCue[] {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  let id = 0

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue
    if (lines[0].trim().toUpperCase().startsWith('WEBVTT')) continue

    const timeIndex = lines.findIndex((line) => TIMECODE.test(line))
    if (timeIndex === -1) continue

    const match = TIMECODE.exec(lines[timeIndex])
    if (!match) continue

    const start = toSeconds(match[1], match[2], match[3], match[4])
    const end = toSeconds(match[5], match[6], match[7], match[8])
    const text = lines
      .slice(timeIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim()

    if (!text || end <= start) continue
    cues.push({ id: id++, start, end, text })
  }

  return cues.sort((a, b) => a.start - b.start)
}

export const subtitleService = {
  async load(path: string): Promise<SubtitleTrack | null> {
    try {
      const content = await fs.readFile(path, 'utf-8')
      const cues = parseSubtitles(content)
      if (cues.length === 0) return null
      return { path, label: basename(path), cues }
    } catch (error) {
      console.error('[subtitles] falha ao ler', path, error)
      return null
    }
  },

  /** Procura legenda com o mesmo nome-base do video na mesma pasta. */
  async findForVideo(videoPath: string): Promise<SubtitleTrack | null> {
    const dir = dirname(videoPath)
    const base = basename(videoPath, extname(videoPath))
    for (const ext of ['srt', 'vtt']) {
      const candidate = join(dir, `${base}.${ext}`)
      try {
        await fs.access(candidate)
        return await this.load(candidate)
      } catch {
        // nao existe: tenta proxima extensao
      }
    }
    return null
  }
}
