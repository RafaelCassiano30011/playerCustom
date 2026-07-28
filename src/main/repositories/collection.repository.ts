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

  create(input: CreateCollectionInput): Collection {
    const name = input.name.trim()
    if (!name) throw new Error('Nome da colecao e obrigatorio.')

    const now = Date.now()
    const collection: Collection = {
      id: randomUUID(),
      name,
      description: input.description?.trim() || null,
      thumbnail: input.thumbnail || null,
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
