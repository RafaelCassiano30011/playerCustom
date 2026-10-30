import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { cloudFetch, cloudJson } from './api-client'
import { collectionRepository } from '../repositories/collection.repository'
import { videoRepository } from '../repositories/video.repository'
import { fileService } from '../services/file.service'
import { readDuration } from '../services/track.service'
import type { RemoteFile, RemoteUploadInit } from './dto'
import type { UploadProgress, Video } from '@shared/types'

/**
 * Envio de arquivos locais para a nuvem.
 *
 * Segue os tres passos da API (autoriza, envia, confirma). Arquivo grande vai
 * em partes do tamanho que o servidor pediu — o R2 exige que todas as partes,
 * menos a ultima, tenham o mesmo tamanho, entao o `partSize` da resposta e
 * obrigatorio, nao sugestao.
 *
 * A duracao sai do ffprobe local e e enviada depois do `complete`: o servidor
 * nao abre o video, e sem isso a lista na TV nao teria duracao nenhuma.
 */

export interface UploadListener {
  (progress: UploadProgress): void
}

const listeners = new Set<UploadListener>()

export function onUploadProgress(listener: UploadListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitir(progresso: UploadProgress): void {
  for (const listener of listeners) listener({ ...progresso })
}

/** Le um pedaco do arquivo sem carregar o resto na memoria. */
async function lerParte(path: string, inicio: number, tamanho: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(tamanho)
    const { bytesRead } = await handle.read(buffer, 0, tamanho, inicio)
    return bytesRead === tamanho ? buffer : buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function enviarArquivo(
  path: string,
  sizeBytes: number,
  collectionRemoteId: string | null,
  progresso: UploadProgress
): Promise<RemoteFile> {
  const init = await cloudJson<RemoteUploadInit>('/api/v1/files/uploads', {
    method: 'POST',
    body: {
      fileName: basename(path),
      sizeBytes,
      ...(collectionRemoteId ? { collectionId: collectionRemoteId } : {})
    }
  })

  const enviarParte = async (corpo: Buffer, rota: string): Promise<void> => {
    const resposta = await cloudFetch(rota, {
      method: 'PUT',
      raw: corpo,
      // Content-Length fica para o fetch calcular: definir a mao e proibido
      // pela especificacao e o undici ignora ou reclama, dependendo da versao.
      headers: { 'Content-Type': 'application/octet-stream' },
      // arquivo grande em rede domestica: 10 min por parte
      timeoutMs: 10 * 60_000
    })
    if (!resposta.ok) {
      const texto = await resposta.text()
      throw new Error(`Falha ao enviar (${resposta.status}): ${texto.slice(0, 200)}`)
    }
    progresso.sentBytes += corpo.byteLength
    progresso.fraction = Math.min(1, progresso.sentBytes / Math.max(1, progresso.totalBytes))
    emitir(progresso)
  }

  if (init.strategy === 'single') {
    await enviarParte(await lerParte(path, 0, sizeBytes), `/api/v1/files/uploads/${init.uploadId}/content`)
  } else {
    const partSize = init.partSize ?? 64 * 1024 * 1024
    const total = Math.ceil(sizeBytes / partSize)
    for (let numero = 1; numero <= total; numero++) {
      const inicio = (numero - 1) * partSize
      const tamanho = Math.min(partSize, sizeBytes - inicio)
      await enviarParte(
        await lerParte(path, inicio, tamanho),
        `/api/v1/files/uploads/${init.uploadId}/parts/${numero}`
      )
    }
  }

  await cloudJson(`/api/v1/files/uploads/${init.uploadId}/complete`, { method: 'POST' })

  const duracao = await readDuration(path)
  if (duracao > 0) {
    await cloudJson(`/api/v1/files/${init.fileId}`, {
      method: 'PATCH',
      body: { durationSeconds: duracao }
    })
  }

  return cloudJson<RemoteFile>(`/api/v1/files/${init.fileId}`)
}

/**
 * Envia os arquivos e devolve os videos espelhados localmente, prontos para a
 * interface. Um arquivo que falha nao derruba os outros: o erro vai no evento
 * de progresso e a fila continua.
 */
export async function upload(collectionId: string, paths: string[]): Promise<Video[]> {
  let colecao = collectionRepository.find(collectionId)
  if (!colecao) throw new Error('Colecao nao encontrada.')

  const arquivos = await fileService.resolve(paths)
  if (arquivos.length === 0) return []

  // Colecao que nasceu offline ainda nao existe no servidor: cria agora, para
  // o arquivo subir ja dentro da serie certa em vez de cair em "Nuvem".
  if (!colecao.remoteId) {
    const remota = await cloudJson<{ id: string }>('/api/v1/collections', {
      method: 'POST',
      body: { name: colecao.name, ...(colecao.description ? { description: colecao.description } : {}) }
    })
    colecao = collectionRepository.attachRemote(colecao.id, remota.id)
  }

  const criados: Video[] = []
  const base = videoRepository.byCollection(collectionId).length

  for (const [indice, arquivo] of arquivos.entries()) {
    const progresso: UploadProgress = {
      path: arquivo.path,
      name: arquivo.name,
      state: 'uploading',
      sentBytes: 0,
      totalBytes: arquivo.size,
      fraction: 0,
      error: null
    }
    emitir(progresso)

    try {
      const remoto = await enviarArquivo(arquivo.path, arquivo.size, colecao.remoteId, progresso)
      const video = videoRepository.upsertRemote({
        remoteId: remoto.id,
        collectionId,
        name: remoto.originalName.replace(/\.[a-z0-9]+$/i, ''),
        duration: remoto.durationSeconds ?? 0,
        sizeBytes: remoto.sizeBytes,
        position: base + indice
      })
      // o arquivo ja esta no disco: vale como copia offline desde o primeiro dia
      criados.push(videoRepository.setOfflinePath(video.id, arquivo.path))

      progresso.state = 'done'
      progresso.fraction = 1
      emitir(progresso)
    } catch (error) {
      progresso.state = 'error'
      progresso.error = error instanceof Error ? error.message : String(error)
      emitir(progresso)
    }
  }

  return criados
}
