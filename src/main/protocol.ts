import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME } from '@shared/ipc'
import { streamWithAudioTrack } from './services/transcode.service'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

function mimeFor(path: string): string {
  return MIME[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

/** Deve rodar antes de `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

/** 1MB de chunk: o padrao do Node (64KB) gera round trips demais em video de bitrate alto. */
const CHUNK_SIZE = 1024 * 1024

function toStream(path: string, start: number, end: number): ReadableStream {
  const stream = createReadStream(path, { start, end, highWaterMark: CHUNK_SIZE })
  return Readable.toWeb(stream) as ReadableStream
}

/**
 * Serve arquivos locais para as tags <video>/<img> sem desligar webSecurity.
 * Implementa Range (HTTP 206) — sem isso, seek em arquivos grandes trava.
 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const raw = request.url.slice(`${MEDIA_SCHEME}://`.length)
    const queryAt = raw.indexOf('?')
    const params = new URLSearchParams(queryAt >= 0 ? raw.slice(queryAt + 1) : '')
    const path = decodeURIComponent(queryAt >= 0 ? raw.slice(0, queryAt) : raw).replace(/\/$/, '')

    // Faixa de audio escolhida: precisa passar pelo ffmpeg (ver transcode.service).
    const audioParam = params.get('a')
    if (audioParam !== null) {
      const audioIndex = Number(audioParam)
      const start = Number(params.get('t') ?? 0)
      if (Number.isFinite(audioIndex)) {
        return streamWithAudioTrack(
          path,
          audioIndex,
          Number.isFinite(start) ? start : 0,
          request.signal
        )
      }
    }

    let size: number
    try {
      const stat = await fs.stat(path)
      if (!stat.isFile()) return new Response('Not a file', { status: 404 })
      size = stat.size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const type = mimeFor(path)
    const range = request.headers.get('Range')

    if (!range) {
      return new Response(toStream(path, 0, size - 1), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes'
        }
      })
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (!match) {
      return new Response('Invalid range', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }

    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1

    if (Number.isNaN(start) || start >= size || end < start) {
      return new Response('Invalid range', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }

    return new Response(toStream(path, start, end), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
