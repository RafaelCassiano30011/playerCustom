import { randomUUID } from 'node:crypto'
import { db, mutate } from '../storage/database'
import type {
  Collection,
  CollectionWithStats,
  CreateCollectionInput,
  UpdateCollectionInput
} from '@shared/types'

export const collectionRepository = {
  list(): CollectionWithStats[] {
    const state = db()
    return state.collections
      .map<CollectionWithStats>((collection) => {
        const videos = state.videos.filter((v) => v.collectionId === collection.id)
        return {
          ...collection,
          videoCount: videos.length,
          completedCount: videos.filter((v) => v.status === 'completed').length,
          totalDuration: videos.reduce((acc, v) => acc + (v.duration || 0), 0)
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  find(id: string): Collection | null {
    return db().collections.find((c) => c.id === id) ?? null
  },

  findByRemote(remoteId: string): Collection | null {
    return db().collections.find((c) => c.remoteId === remoteId) ?? null
  },

  /** Liga uma colecao local a uma que acabou de ser criada no servidor. */
  attachRemote(id: string, remoteId: string): Collection {
    return mutate((state) => {
      const collection = state.collections.find((c) => c.id === id)
      if (!collection) throw new Error(`Colecao ${id} nao encontrada.`)
      collection.remoteId = remoteId
      collection.updatedAt = Date.now()
      return { ...collection }
    })
  },

  /**
   * Cria ou atualiza a colecao que corresponde a uma do servidor.
   *
   * O par local/remoto e ligado por `remoteId`. Quando ja existe uma colecao
   * local com o mesmo nome e sem vinculo, ela e adotada em vez de duplicada —
   * e o que acontece na primeira sincronizacao de quem ja usava o app offline.
   */
  upsertRemote(input: { remoteId: string; name: string; description: string | null }): Collection {
    return mutate((state) => {
      const now = Date.now()
      let collection = state.collections.find((c) => c.remoteId === input.remoteId)

      if (!collection) {
        const nome = input.name.trim().toLowerCase()
        collection = state.collections.find(
          (c) => c.remoteId === null && c.name.trim().toLowerCase() === nome
        )
      }

      if (collection) {
        collection.remoteId = input.remoteId
        collection.name = input.name
        collection.description = input.description
        collection.updatedAt = now
        return { ...collection }
      }

      const criada: Collection = {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        thumbnail: null,
        remoteId: input.remoteId,
        createdAt: now,
        updatedAt: now
      }
      state.collections.push(criada)
      return { ...criada }
    })
  },

  create(input: CreateCollectionInput): Collection {
    const name = input.name.trim()
    if (!name) throw new Error('Nome da colecao e obrigatorio.')

    const now = Date.now()
    const collection: Collection = {
      id: randomUUID(),
      name,
      description: input.description?.trim() || null,
      thumbnail: input.thumbnail || null,
      remoteId: null,
      createdAt: now,
      updatedAt: now
    }
    mutate((state) => state.collections.push(collection))
    return collection
  },

  update(id: string, input: UpdateCollectionInput): Collection {
    return mutate((state) => {
      const collection = state.collections.find((c) => c.id === id)
      if (!collection) throw new Error(`Colecao ${id} nao encontrada.`)

      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new Error('Nome da colecao e obrigatorio.')
        collection.name = name
      }
      if (input.description !== undefined) collection.description = input.description || null
      if (input.thumbnail !== undefined) collection.thumbnail = input.thumbnail || null
      collection.updatedAt = Date.now()
      return { ...collection }
    })
  },

  remove(id: string): void {
    mutate((state) => {
      state.collections = state.collections.filter((c) => c.id !== id)
      state.videos = state.videos.filter((v) => v.collectionId !== id)
      state.history = state.history.filter((h) => h.collectionId !== id)
      if (state.settings.lastCollectionId === id) state.settings.lastCollectionId = null
    })
  }
}
