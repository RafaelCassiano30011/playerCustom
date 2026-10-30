import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import { db, mutate } from '../storage/database'
import { isCompleted } from '@shared/time'
import type {
  ApplyCollectionDefaultsInput,
  ReorderInput,
  SaveProgressInput,
  UpdateVideoInput,
  Video,
  VideoStatus
} from '@shared/types'

function byPosition(a: Video, b: Video): number {
  return a.position - b.position || a.name.localeCompare(b.name)
}

/** Reescreve `position` de 0..n-1 mantendo a ordem atual do array. */
function normalizePositions(videos: Video[]): void {
  videos.forEach((video, index) => {
    video.position = index
  })
}

function displayName(path: string): string {
  const file = basename(path)
  return file.replace(new RegExp(`${extname(file)}$`), '') || file
}

export const videoRepository = {
  byCollection(collectionId: string): Video[] {
    return db()
      .videos.filter((v) => v.collectionId === collectionId)
      .sort(byPosition)
      .map((v) => ({ ...v }))
  },

  find(id: string): Video | null {
    const video = db().videos.find((v) => v.id === id)
    return video ? { ...video } : null
  },

  /** Ignora caminhos ja presentes na colecao (indice unico logico). */
  importMany(collectionId: string, paths: string[]): Video[] {
    return mutate((state) => {
      const collection = state.collections.find((c) => c.id === collectionId)
      if (!collection) throw new Error(`Colecao ${collectionId} nao encontrada.`)

      const existing = state.videos.filter((v) => v.collectionId === collectionId).sort(byPosition)
      const known = new Set(existing.map((v) => v.path.toLowerCase()))
      const now = Date.now()
      let position = existing.length
      const created: Video[] = []

      for (const path of paths) {
        if (known.has(path.toLowerCase())) continue
        known.add(path.toLowerCase())
        const video: Video = {
          id: randomUUID(),
          collectionId,
          name: displayName(path),
          path,
          duration: 0,
          thumbnail: null,
          introStart: null,
          introEnd: null,
          introSkipTo: null,
          nextEpisodeOffset: state.settings.defaultNextEpisodeOffset,
          position: position++,
          status: 'not_started',
          lastPosition: 0,
          favorite: false,
          lastPlayedAt: null,
          createdAt: now,
          updatedAt: now
        }
        state.videos.push(video)
        created.push({ ...video })
      }

      collection.updatedAt = now
      return created
    })
  },

  update(id: string, input: UpdateVideoInput): Video {
    return mutate((state) => {
      const video = state.videos.find((v) => v.id === id)
      if (!video) throw new Error(`Video ${id} nao encontrado.`)

      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new Error('Nome do video e obrigatorio.')
        video.name = name
      }
      if (input.duration !== undefined && input.duration > 0) video.duration = input.duration
      if (input.thumbnail !== undefined) video.thumbnail = input.thumbnail
      if (input.introStart !== undefined) video.introStart = input.introStart
      if (input.introEnd !== undefined) video.introEnd = input.introEnd
      if (input.introSkipTo !== undefined) video.introSkipTo = input.introSkipTo
      if (input.nextEpisodeOffset !== undefined) video.nextEpisodeOffset = input.nextEpisodeOffset
      if (input.favorite !== undefined) video.favorite = input.favorite
      if (input.status !== undefined) video.status = input.status

      if (input.collectionId !== undefined && input.collectionId !== video.collectionId) {
        const target = state.collections.find((c) => c.id === input.collectionId)
        if (!target) throw new Error(`Colecao ${input.collectionId} nao encontrada.`)
        const origin = video.collectionId
        video.collectionId = target.id
        video.position = state.videos.filter((v) => v.collectionId === target.id).length - 1
        normalizePositions(
          state.videos.filter((v) => v.collectionId === origin).sort(byPosition)
        )
      }

      video.updatedAt = Date.now()
      return { ...video }
    })
  },

  remove(id: string): void {
    mutate((state) => {
      const video = state.videos.find((v) => v.id === id)
      if (!video) return
      const collectionId = video.collectionId
      state.videos = state.videos.filter((v) => v.id !== id)
      state.history = state.history.filter((h) => h.videoId !== id)
      if (state.settings.lastVideoId === id) state.settings.lastVideoId = null
      normalizePositions(state.videos.filter((v) => v.collectionId === collectionId).sort(byPosition))
    })
  },

  reorder({ collectionId, orderedIds }: ReorderInput): Video[] {
    return mutate((state) => {
      const videos = state.videos.filter((v) => v.collectionId === collectionId)
      const index = new Map(videos.map((v) => [v.id, v]))
      const ordered: Video[] = []

      for (const id of orderedIds) {
        const video = index.get(id)
        if (video) {
          ordered.push(video)
          index.delete(id)
        }
      }
      // Ids ausentes do payload vao para o fim preservando a ordem antiga.
      ordered.push(...[...index.values()].sort(byPosition))
      normalizePositions(ordered)

      const now = Date.now()
      for (const video of ordered) video.updatedAt = now
      return ordered.map((v) => ({ ...v }))
    })
  },

  move(collectionId: string, videoId: string, direction: 'up' | 'down'): Video[] {
    const current = this.byCollection(collectionId)
    const from = current.findIndex((v) => v.id === videoId)
    if (from === -1) return current

    const to = direction === 'up' ? from - 1 : from + 1
    if (to < 0 || to >= current.length) return current

    const ids = current.map((v) => v.id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    return this.reorder({ collectionId, orderedIds: ids })
  },

  saveProgress({ videoId, position, duration, completed }: SaveProgressInput): Video {
    return mutate((state) => {
      const video = state.videos.find((v) => v.id === videoId)
      if (!video) throw new Error(`Video ${videoId} nao encontrado.`)

      if (duration && duration > 0) video.duration = duration
      video.lastPosition = Math.max(0, position)
      video.lastPlayedAt = Date.now()
      video.updatedAt = video.lastPlayedAt

      const done = completed ?? isCompleted(video.lastPosition, video.duration)
      const status: VideoStatus = done ? 'completed' : video.lastPosition > 1 ? 'in_progress' : video.status
      video.status = status

      state.settings.lastVideoId = video.id
      state.settings.lastCollectionId = video.collectionId
      return { ...video }
    })
  },

  resetProgress(id: string): Video {
    return mutate((state) => {
      const video = state.videos.find((v) => v.id === id)
      if (!video) throw new Error(`Video ${id} nao encontrado.`)
      video.lastPosition = 0
      video.status = 'not_started'
      video.updatedAt = Date.now()
      return { ...video }
    })
  },

  toggleFavorite(id: string): Video {
    return mutate((state) => {
      const video = state.videos.find((v) => v.id === id)
      if (!video) throw new Error(`Video ${id} nao encontrado.`)
      video.favorite = !video.favorite
      video.updatedAt = Date.now()
      return { ...video }
    })
  },

  favorites(): Video[] {
    return db()
      .videos.filter((v) => v.favorite)
      .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      .map((v) => ({ ...v }))
  },

  /** Videos em andamento, mais recentes primeiro. */
  continueWatching(limit = 12): Video[] {
    return db()
      .videos.filter((v) => v.status === 'in_progress' && v.lastPosition > 0)
      .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      .slice(0, limit)
      .map((v) => ({ ...v }))
  },

  /**
   * Aplica abertura/proximo episodio a todos os videos da colecao de uma vez,
   * sem exigir uma chamada IPC por video. `overwrite: false` so preenche os
   * que ainda nao tem configuracao propria (nao mexe no que ja foi ajustado).
   */
  applyDefaults(input: ApplyCollectionDefaultsInput): Video[] {
    return mutate((state) => {
      const now = Date.now()
      const touched: Video[] = []

      for (const video of state.videos) {
        if (video.collectionId !== input.collectionId) continue

        const hasOwnIntro = video.introStart !== null || video.introEnd !== null
        if (input.overwrite || !hasOwnIntro) {
          video.introStart = input.introStart
          video.introEnd = input.introEnd
          video.introSkipTo = input.introSkipTo
        }

        if (input.overwrite || video.nextEpisodeOffset === null) {
          video.nextEpisodeOffset = input.nextEpisodeOffset
        }

        video.updatedAt = now
        touched.push({ ...video })
      }

      return touched
    })
  },

  search(term: string): Video[] {
    const needle = term.trim().toLowerCase()
    if (!needle) return []
    return db()
      .videos.filter((v) => v.name.toLowerCase().includes(needle))
      .slice(0, 100)
      .map((v) => ({ ...v }))
  }
}
