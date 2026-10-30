import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { EmbeddedTrackInfo, ProbeResult } from '@shared/types'

/**
 * Caminho do binario nao muda quando empacotado (fica fora do asar via
 * asarUnpack no electron-builder.yml), mas o replace cobre o caso do dev
 * tambem rodar a partir de dentro de um asar por engano.
 */
function resolveBinary(path: string): string {
  return path.replace('app.asar', 'app.asar.unpacked')
}

const FFMPEG_BIN = resolveBinary(ffmpegPath)
const FFPROBE_BIN = resolveBinary(ffprobeStatic.path)

interface FfprobeStream {
  index: number
  codec_type: 'audio' | 'subtitle' | 'video' | string
  codec_name?: string
  disposition?: { default?: number }
  tags?: Record<string, string>
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${bin} saiu com codigo ${code}: ${stderr.slice(0, 400)}`))
    })
  })
}

function toTrackInfo(stream: FfprobeStream): EmbeddedTrackInfo {
  return {
    index: stream.index,
    codec: stream.codec_name ?? 'desconhecido',
    language: stream.tags?.language ?? null,
    title: stream.tags?.title ?? null,
    isDefault: stream.disposition?.default === 1
  }
}

/** Ffprobe so le o cabecalho/index do container: rapido mesmo em arquivos grandes. */
export async function probeTracks(path: string): Promise<ProbeResult> {
  if (!existsSync(FFPROBE_BIN)) return { audio: [], subtitle: [] }

  try {
    const { stdout } = await run(FFPROBE_BIN, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      path
    ])
    const parsed = JSON.parse(stdout) as { streams?: FfprobeStream[] }
    const streams = parsed.streams ?? []
    return {
      audio: streams.filter((s) => s.codec_type === 'audio').map(toTrackInfo),
      subtitle: streams.filter((s) => s.codec_type === 'subtitle').map(toTrackInfo)
    }
  } catch (error) {
    console.error('[tracks] falha ao sondar faixas', path, error)
    return { audio: [], subtitle: [] }
  }
}

function subtitleCacheDir(): string {
  return join(app.getPath('userData'), 'subtitle-cache')
}

/**
 * Gera a miniatura com ffmpeg, fora do renderer.
 *
 * Decodificar o video no renderer (via <video> + canvas) disputa o mesmo
 * decodificador de midia que o player esta usando — em arquivos HEVC 10-bit
 * isso deixa a abertura do video visivelmente lenta. Aqui um processo
 * separado faz seek por keyframe (`-ss` antes de `-i`) e decodifica um unico
 * frame, sem tocar no pipeline do renderer.
 */
export async function generateThumbnail(
  videoPath: string,
  outPath: string,
  atSeconds: number
): Promise<boolean> {
  if (!existsSync(FFMPEG_BIN)) return false
  try {
    await run(FFMPEG_BIN, [
      '-y',
      // -ss antes de -i: seek rapido por keyframe, nao decodifica ate la.
      '-ss',
      String(Math.max(0, Math.floor(atSeconds))),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2',
      '-q:v',
      '4',
      outPath
    ])
    return existsSync(outPath)
  } catch (error) {
    console.error('[tracks] falha ao gerar miniatura', videoPath, error)
    return false
  }
}

/** Duracao em segundos lida do container, sem decodificar o video. */
export async function readDuration(videoPath: string): Promise<number> {
  if (!existsSync(FFPROBE_BIN)) return 0
  try {
    const { stdout } = await run(FFPROBE_BIN, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      videoPath
    ])
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } }
    const duration = Number(parsed.format?.duration ?? 0)
    return Number.isFinite(duration) ? duration : 0
  } catch {
    return 0
  }
}

/** Nome estavel por arquivo+faixa: evita reextrair a cada abertura do video. */
function cacheKey(path: string, streamIndex: number): string {
  const hash = createHash('sha1').update(path).digest('hex').slice(0, 16)
  return `${hash}-${streamIndex}.srt`
}

/**
 * Extrai uma faixa de legenda embutida (MKV/MP4) para .srt em disco.
 * So funciona para legendas em texto (SRT/ASS/SSA/MOV_TEXT); legendas de
 * imagem (PGS, VobSub) nao podem virar texto e o ffmpeg vai falhar — nesse
 * caso devolvemos null e a UI avisa que a faixa nao e extraivel.
 */
export async function extractSubtitleTrack(path: string, streamIndex: number): Promise<string | null> {
  if (!existsSync(FFMPEG_BIN)) return null

  const { mkdirSync } = await import('node:fs')
  const dir = subtitleCacheDir()
  mkdirSync(dir, { recursive: true })

  const outPath = join(dir, cacheKey(path, streamIndex))
  if (existsSync(outPath)) return outPath

  try {
    await run(FFMPEG_BIN, [
      '-y',
      '-i',
      path,
      '-map',
      `0:${streamIndex}`,
      '-c:s',
      'srt',
      outPath
    ])
    return existsSync(outPath) ? outPath : null
  } catch (error) {
    console.error('[tracks] falha ao extrair legenda embutida', path, streamIndex, error)
    return null
  }
}
