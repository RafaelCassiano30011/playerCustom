import { db, mutate } from '../storage/database'
import type { HistoryEntry } from '@shared/types'

const MAX_ENTRIES = 500
/** Nao registra nova entrada se a ultima do mesmo video for recente. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000

export const historyRepository = {
  record(videoId: string, collectionId: string, position: number): void {
    mutate((state) => {
      const now = Date.now()
      const last = state.history[state.history.length - 1]
      if (last && last.videoId === videoId && now - last.playedAt < DEDUPE_WINDOW_MS) {
        last.playedAt = now
        last.position = position
        return
      }
      state.history.push({
        id: state.nextHistoryId++,
        videoId,
        collectionId,
        playedAt: now,
        position
      })
      if (state.history.length > MAX_ENTRIES) {
        state.history = state.history.slice(-MAX_ENTRIES)
      }
    })
  },

  list(limit = 100): HistoryEntry[] {
    const state = db()
    const videos = new Map(state.videos.map((v) => [v.id, v]))
    const collections = new Map(state.collections.map((c) => [c.id, c]))

    return [...state.history]
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, limit)
      .map<HistoryEntry>((entry) => ({
        ...entry,
        videoName: videos.get(entry.videoId)?.name ?? 'Video removido',
        collectionName: collections.get(entry.collectionId)?.name ?? 'Colecao removida'
      }))
  },

  clear(): void {
    mutate((state) => {
      state.history = []
      state.nextHistoryId = 1
    })
  }
}
