import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { offlineVideosDir } from '../storage/database'
import { videoRepository } from '../repositories/video.repository'
import { signedLink } from './stream.service'
import type { DownloadProgress, Video } from '@shared/types'

/**
 * Download para assistir offline.
 *
 * Grava em `<id>.<ext>.part` e renomeia so no fim: um arquivo `.mp4` presente
 * sempre significa copia completa, entao uma queda de energia nao deixa o app
 * tocando metade de um episodio. O `.part` que sobra e o que permite retomar —
 * o tamanho dele vira o `Range: bytes=<n>-` da proxima tentativa.
 */

export interface DownloadListener {
  (progress: DownloadProgress): void
}

interface Ativo {
  controller: AbortController
  progresso: DownloadProgress
}

const ativos = new Map<string, Ativo>()
const listeners = new Set<DownloadListener>()

export function onDownloadProgress(listener: DownloadListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitir(progresso: DownloadProgress): void {
  for (const listener of listeners) listener({ ...progresso })
}

export function activeDownloads(): DownloadProgress[] {
  return [...ativos.values()].map((a) => ({ ...a.progresso }))
}

function extensaoDe(video: Video): string {
  const match = /\.([a-z0-9]{2,5})$/i.exec(video.name)
  return match ? match[1].toLowerCase() : 'mp4'
}

function destinoDe(video: Video): string {
  return join(offlineVideosDir(), `${video.id}.${extensaoDe(video)}`)
}

async function tamanhoDe(path: string): Promise<number> {
  try {
    const stat = await fs.stat(path)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

/**
 * Baixa o video. Chamada repetida para o mesmo id devolve o progresso em
 * andamento em vez de abrir um segundo download do mesmo arquivo.
 */
export async function download(videoId: string): Promise<DownloadProgress> {
  const emAndamento = ativos.get(videoId)
  if (emAndamento) return { ...emAndamento.progresso }

  const video = videoRepository.find(videoId)
  if (!video) throw new Error('Video nao encontrado.')
  if (!video.remoteId) throw new Error('Este video nao esta na nuvem.')

  const destino = destinoDe(video)
  const parcial = `${destino}.part`

  // Ja baixado: nada a fazer, so garante o vinculo no banco.
  if ((await tamanhoDe(destino)) > 0) {
    if (video.offlinePath !== destino) videoRepository.setOfflinePath(video.id, destino)
    const pronto: DownloadProgress = {
      videoId,
      state: 'done',
      receivedBytes: await tamanhoDe(destino),
      totalBytes: await tamanhoDe(destino),
      fraction: 1,
      error: null
    }
    emitir(pronto)
    return pronto
  }

  const controller = new AbortController()
  const progresso: DownloadProgress = {
    videoId,
    state: 'downloading',
    receivedBytes: await tamanhoDe(parcial),
    totalBytes: video.sizeBytes,
    fraction: 0,
    error: null
  }
  ativos.set(videoId, { controller, progresso })
  emitir(progresso)

  void (async () => {
    try {
      const inicio = progresso.receivedBytes
      const link = await signedLink(video.remoteId!)
      const resposta = await fetch(link.url, {
        headers: inicio > 0 ? { Range: `bytes=${inicio}-` } : undefined,
        signal: controller.signal
      })

      if (!resposta.ok && resposta.status !== 206) {
        throw new Error(`O servidor respondeu ${resposta.status}.`)
      }
      if (!resposta.body) throw new Error('Resposta sem corpo.')

      // 200 depois de pedir Range = o servidor ignorou: recomeca do zero.
      const retomando = resposta.status === 206
      const recebidoAntes = retomando ? inicio : 0
      const tamanhoResposta = Number(resposta.headers.get('content-length') ?? 0)
      progresso.totalBytes = recebidoAntes + tamanhoResposta || video.sizeBytes || 0
      progresso.receivedBytes = recebidoAntes

      const saida = createWriteStream(parcial, { flags: retomando && inicio > 0 ? 'a' : 'w' })
      const entrada = Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0])

      let ultimoAviso = 0
      entrada.on('data', (pedaco: Buffer) => {
        progresso.receivedBytes += pedaco.byteLength
        progresso.fraction =
          progresso.totalBytes > 0
            ? Math.min(1, progresso.receivedBytes / progresso.totalBytes)
            : 0
        // avisa no maximo 4x por segundo: o renderer nao precisa de mais
        const agora = Date.now()
        if (agora - ultimoAviso > 250) {
          ultimoAviso = agora
          emitir(progresso)
        }
      })

      await pipeline(entrada, saida)
      await fs.rename(parcial, destino)

      videoRepository.setOfflinePath(video.id, destino)
      progresso.state = 'done'
      progresso.fraction = 1
      emitir(progresso)
    } catch (error) {
      const cancelado =
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      progresso.state = cancelado ? 'idle' : 'error'
      progresso.error = cancelado ? null : error instanceof Error ? error.message : String(error)
      emitir(progresso)
    } finally {
      ativos.delete(videoId)
    }
  })()

  return { ...progresso }
}

/** Para o download e mantem o `.part` para retomar depois. */
export function cancel(videoId: string): void {
  ativos.get(videoId)?.controller.abort()
}

/** Apaga a copia local (e o `.part`). O video continua na nuvem. */
export async function removeOffline(videoId: string): Promise<Video> {
  cancel(videoId)
  const video = videoRepository.find(videoId)
  if (!video) throw new Error('Video nao encontrado.')

  const destino = video.offlinePath ?? destinoDe(video)
  await fs.rm(destino, { force: true })
  await fs.rm(`${destino}.part`, { force: true })

  emitir({
    videoId,
    state: 'idle',
    receivedBytes: 0,
    totalBytes: video.sizeBytes,
    fraction: 0,
    error: null
  })
  return videoRepository.setOfflinePath(videoId, null)
}

/**
 * Na inicializacao, confere se as copias offline continuam no disco. O
 * usuario pode ter limpado a pasta entre duas execucoes, e um `offlinePath`
 * apontando para arquivo inexistente faria o player falhar em vez de cair
 * para o streaming.
 */
export async function verifyOfflineCopies(videos: Video[]): Promise<number> {
  let corrigidos = 0
  for (const video of videos) {
    if (!video.offlinePath) continue
    if ((await tamanhoDe(video.offlinePath)) > 0) continue
    videoRepository.setOfflinePath(video.id, null)
    corrigidos++
  }
  return corrigidos
}
