import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { JsonStore } from './json-store'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings, Collection, Video } from '@shared/types'

export interface HistoryRecord {
  id: number
  videoId: string
  collectionId: string
  playedAt: number
  position: number
}

export interface DatabaseShape {
  version: number
  collections: Collection[]
  videos: Video[]
  history: HistoryRecord[]
  settings: AppSettings
  nextHistoryId: number
}

export const EMPTY_DB: DatabaseShape = {
  version: 1,
  collections: [],
  videos: [],
  history: [],
  settings: DEFAULT_SETTINGS,
  nextHistoryId: 1
}

let store: JsonStore<DatabaseShape> | null = null

/** Normaliza dados vindos do disco, preenchendo campos novos. */
function migrate(raw: unknown): DatabaseShape {
  const source = (raw ?? {}) as Partial<DatabaseShape>
  return {
    version: 1,
    collections: Array.isArray(source.collections) ? source.collections : [],
    videos: Array.isArray(source.videos) ? source.videos : [],
    history: Array.isArray(source.history) ? source.history : [],
    settings: { ...DEFAULT_SETTINGS, ...(source.settings ?? {}) },
    nextHistoryId:
      typeof source.nextHistoryId === 'number'
        ? source.nextHistoryId
        : (source.history?.length ?? 0) + 1
  }
}

export function initStorage(): JsonStore<DatabaseShape> {
  if (store) return store
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  store = new JsonStore<DatabaseShape>({
    file: join(dir, 'library.json'),
    defaults: EMPTY_DB,
    debounceMs: 250,
    migrate
  })
  return store
}

export function getStore(): JsonStore<DatabaseShape> {
  if (!store) throw new Error('Armazenamento nao inicializado. Chame initStorage() antes.')
  return store
}

export function db(): DatabaseShape {
  return getStore().state
}

/** Mutacao + persistencia agendada. */
export function mutate<R>(mutator: (state: DatabaseShape) => R): R {
  return getStore().update(mutator)
}

export function closeStorage(): void {
  store?.dispose()
  store = null
}

/** Pasta das miniaturas geradas automaticamente. */
export function thumbnailsDir(): string {
  const dir = join(app.getPath('userData'), 'thumbnails')
  mkdirSync(dir, { recursive: true })
  return dir
}
