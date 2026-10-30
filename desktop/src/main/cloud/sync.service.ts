import { cloudJson } from './api-client'
import { session } from './session'
import { collectionRepository } from '../repositories/collection.repository'
import { videoRepository } from '../repositories/video.repository'
import { naturalCompare } from '../services/file.service'
import type { CloudSyncResult } from '@shared/types'
import type { Paginated, RemoteChanges, RemoteCollection, RemoteFile } from './dto'

/**
 * Espelha o acervo da nuvem na biblioteca local.
 *
 * A biblioteca local continua sendo a fonte de verdade para o que a interface
 * mostra — o sync so escreve nela. Isso e o que mantem o app inteiro
 * funcionando offline sem nenhum caminho especial na UI: sem rede, a lista
 * vem do `library.json` como sempre; o que muda e a origem dos bytes.
 *
 * Catalogo vem das listagens (`/collections`, `/collections/:id/files`),
 * porque e de la que vem `collectionIds` e `durationSeconds`. O `/sync/changes`
 * entra so para o incremental de progresso e exclusoes, que e o que roda a
 * cada poucos minutos.
 */

const PAGE = 200

async function paginate<T>(path: string): Promise<T[]> {
  const itens: T[] = []
  let cursor: string | undefined
  // teto de seguranca: 50 paginas de 200 = 10k itens
  for (let pagina = 0; pagina < 50; pagina++) {
    const query = new URLSearchParams({ limit: String(PAGE) })
    if (cursor) query.set('cursor', cursor)
    const sep = path.includes('?') ? '&' : '?'
    const resposta = await cloudJson<Paginated<T>>(`${path}${sep}${query.toString()}`)
    itens.push(...resposta.items)
    if (!resposta.nextCursor) break
    cursor = resposta.nextCursor
  }
  return itens
}

/**
 * Ordem dos episodios: o servidor guarda `collection_files.position`, mas a
 * listagem ordena por nome/data, nao por posicao. Ordenar por nome com
 * comparacao natural coloca "Ep 2" antes de "Ep 10" — o que bate com a forma
 * como arquivos de serie sao nomeados.
 */
function sortEpisodes(files: RemoteFile[]): RemoteFile[] {
  return [...files].sort((a, b) => naturalCompare(a.originalName, b.originalName))
}

function displayName(originalName: string): string {
  return originalName.replace(/\.[a-z0-9]+$/i, '') || originalName
}

export interface PullResult {
  collections: number
  videos: number
  removed: number
}

/** Puxa colecoes e arquivos, criando/atualizando os espelhos locais. */
export async function pullCatalog(): Promise<PullResult> {
  const remoteCollections = await paginate<RemoteCollection>('/api/v1/collections')
  const vistos: string[] = []
  let videos = 0

  for (const remota of remoteCollections) {
    const local = collectionRepository.upsertRemote({
      remoteId: remota.id,
      name: remota.name,
      description: remota.description
    })

    const arquivos = sortEpisodes(
      await paginate<RemoteFile>(`/api/v1/collections/${remota.id}/files?sort=name&order=asc`)
    )

    arquivos.forEach((arquivo, indice) => {
      videoRepository.upsertRemote({
        remoteId: arquivo.id,
        collectionId: local.id,
        name: displayName(arquivo.originalName),
        duration: arquivo.durationSeconds ?? 0,
        sizeBytes: arquivo.sizeBytes,
        position: indice
      })
      vistos.push(arquivo.id)
      videos++
    })
  }

  // Arquivos avulsos (sem colecao) tambem fazem parte do acervo.
  const soltos = await paginate<RemoteFile>('/api/v1/files?sort=name&order=asc')
  const semColecao = soltos.filter((f) => f.collectionIds.length === 0)
  if (semColecao.length > 0) {
    const avulsos = collectionRepository.upsertRemote({
      remoteId: '__sem_colecao__',
      name: 'Nuvem',
      description: 'Arquivos enviados sem colecao.'
    })
    sortEpisodes(semColecao).forEach((arquivo, indice) => {
      videoRepository.upsertRemote({
        remoteId: arquivo.id,
        collectionId: avulsos.id,
        name: displayName(arquivo.originalName),
        duration: arquivo.durationSeconds ?? 0,
        sizeBytes: arquivo.sizeBytes,
        position: indice
      })
      vistos.push(arquivo.id)
      videos++
    })
  }

  // O que o app conhecia e o servidor nao tem mais sai do cache local.
  const conhecidos = videoRepository.remoteIds().filter((id) => id !== '__sem_colecao__')
  const presentes = new Set(vistos)
  const removed = videoRepository.removeRemotes(conhecidos.filter((id) => !presentes.has(id)))

  return { collections: remoteCollections.length, videos, removed }
}

/**
 * Incremental: aplica posicoes e exclusoes desde o ultimo cursor.
 * Mais barato que o `pullCatalog`, e e o que roda no intervalo de fundo.
 */
export async function pullChanges(): Promise<{ progressPulled: number; removed: number }> {
  const since = session.syncCursor
  const mudancas = await cloudJson<RemoteChanges>(
    `/api/v1/sync/changes?since=${since}&limit=${PAGE}`
  )

  let progressPulled = 0
  for (const progresso of mudancas.progress) {
    const atualizado = videoRepository.applyRemoteProgress({
      remoteId: progresso.fileId,
      positionSeconds: progresso.positionSeconds,
      durationSeconds: progresso.durationSeconds,
      completed: progresso.completed === 1,
      updatedAt: progresso.updatedAt
    })
    if (atualizado) progressPulled++
  }

  const apagados = mudancas.files.filter((f) => f.deleted).map((f) => f.id)
  const removed = videoRepository.removeRemotes(apagados)

  session.setSyncCursor(mudancas.cursor)
  return { progressPulled, removed }
}

export type { CloudSyncResult }
