import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import ffmpegPath from 'ffmpeg-static'

const FFMPEG_BIN = ffmpegPath.replace('app.asar', 'app.asar.unpacked')

/**
 * O elemento <video> do Chromium nao expoe a API `audioTracks`, entao nao ha
 * como escolher a faixa de audio de um MKV pelo lado do renderer. Alem disso
 * o Chromium nao decodifica AC3/DTS, comuns em rips com dublagem.
 *
 * Aqui remultiplexamos sob demanda: o video e copiado sem reencode (barato) e
 * apenas a faixa de audio escolhida e convertida para AAC. O resultado sai por
 * um pipe, entao a resposta nao aceita Range — o seek e feito reiniciando o
 * ffmpeg em outro instante (`startSeconds`).
 *
 * `-copyts` e essencial: com `-c:v copy` o ffmpeg nao consegue comecar em um
 * ponto arbitrario e recua ate o keyframe anterior (medido: de 0,6s a 9,6s
 * antes do pedido). Sem preservar os timestamps originais, o player acharia
 * que esta no instante pedido e as legendas sairiam dessincronizadas por essa
 * diferenca. Com `-copyts` o tempo reportado pelo elemento e o tempo real.
 */
export function streamWithAudioTrack(
  path: string,
  audioStreamIndex: number,
  startSeconds: number,
  signal: AbortSignal
): Response {
  if (!existsSync(FFMPEG_BIN)) {
    return new Response('ffmpeg indisponivel', { status: 500 })
  }

  const child: ChildProcessWithoutNullStreams = spawn(
    FFMPEG_BIN,
    [
      // -ss antes de -i: seek por keyframe, sem decodificar o trecho anterior.
      '-ss',
      String(Math.max(0, startSeconds)),
      // Mantem os timestamps da fonte: o player sabe o instante real.
      '-copyts',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-map',
      `0:${audioStreamIndex}`,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
      '-f',
      'matroska',
      '-loglevel',
      'error',
      '-'
    ],
    { windowsHide: true }
  )

  // Sem isso, cada troca de faixa/seek deixaria um ffmpeg orfao processando.
  const kill = (): void => {
    if (!child.killed) child.kill('SIGKILL')
  }
  signal.addEventListener('abort', kill, { once: true })
  child.stdout.on('close', kill)
  child.on('error', kill)

  child.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim()
    if (message) console.error('[transcode]', message)
  })

  return new Response(Readable.toWeb(child.stdout) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/x-matroska',
      'Cache-Control': 'no-store'
    }
  })
}
