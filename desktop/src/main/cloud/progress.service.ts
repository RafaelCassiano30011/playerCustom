import { CloudError, OfflineError, cloudJson } from './api-client'
import { session } from './session'
import type { PendingProgress } from './session'
import { videoRepository } from '../repositories/video.repository'
import type { RemoteProgress } from './dto'
import type { SaveProgressInput, Video } from '@shared/types'

/**
 * Progresso de reproducao na nuvem.
 *
 * O caminho de escrita e sempre o mesmo, online ou offline: grava local,
 * enfileira, tenta enviar. Quem decide se deu para enviar e a rede, nao a
 * interface — por isso o player nao conhece dois modos.
 *
 * O `updatedAt` enviado e o momento em que ESTE aparelho registrou a posicao.
 * E o que o servidor usa no last-write-wins, e e o que faz uma fila acumulada
 * offline nao sobrescrever o que a TV assistiu depois.
 */

/** Uma posicao por chamada; o endpoint e por arquivo. */
async function push(item: PendingProgress): Promise<boolean> {
  const resposta = await cloudJson<RemoteProgress>(`/api/v1/progress/${item.remoteId}`, {
    method: 'PUT',
    body: {
      positionSeconds: item.positionSeconds,
      durationSeconds: item.durationSeconds,
      completed: item.completed,
      updatedAt: item.updatedAt
    }
  })

  // applied: false = a posicao no servidor e mais nova. Adotamos a dele.
  if (resposta.applied === false) {
    videoRepository.applyRemoteProgress({
      remoteId: resposta.fileId,
      positionSeconds: resposta.positionSeconds,
      durationSeconds: resposta.durationSeconds,
      completed: resposta.completed === 1,
      updatedAt: resposta.updatedAt
    })
  }
  return true
}

let flushing = false

/**
 * Envia a fila. Devolve quantas posicoes sairam.
 *
 * Offline interrompe a rodada e mantem a fila (tenta de novo depois). Um 404
 * descarta o item: o arquivo nao existe mais no servidor, e insistir deixaria
 * a fila travada para sempre.
 */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0
  const fila = session.queue
  if (fila.length === 0) return 0

  flushing = true
  const enviados: string[] = []
  try {
    for (const item of fila) {
      try {
        await push(item)
        enviados.push(item.remoteId)
      } catch (error) {
        if (error instanceof OfflineError) break
        if (error instanceof CloudError && error.status === 404) {
          enviados.push(item.remoteId)
          continue
        }
        if (error instanceof CloudError && error.status === 401) break
        throw error
      }
    }
  } finally {
    if (enviados.length > 0) session.dequeue(enviados)
    flushing = false
  }
  return enviados.length
}

/**
 * Grava a posicao localmente e, quando o video vive na nuvem, enfileira o
 * envio. Chamado pelo mesmo IPC que o player ja usava.
 */
export function saveProgress(input: SaveProgressInput): Video {
  const video = videoRepository.saveProgress(input)

  if (video.remoteId) {
    session.enqueue({
      remoteId: video.remoteId,
      positionSeconds: video.lastPosition,
      durationSeconds: video.duration,
      completed: video.status === 'completed',
      updatedAt: video.updatedAt
    })
    // dispara sem esperar: salvar progresso nao pode travar a reproducao
    void flushQueue().catch(() => undefined)
  }

  return video
}

/** Avisa o servidor que o video foi aberto (base do "Continuar assistindo"). */
export async function markOpened(remoteId: string): Promise<void> {
  try {
    await cloudJson(`/api/v1/progress/${remoteId}/opened`, { method: 'POST' })
  } catch {
    // sem rede o "continuar" fica local; a proxima posicao enviada cobre isso
  }
}
