import { create } from 'zustand'
import type {
  ApplyCollectionDefaultsInput,
  CollectionWithStats,
  CreateCollectionInput,
  UpdateCollectionInput,
  UpdateVideoInput,
  Video
} from '@shared/types'
import { toast } from './toast.store'

interface LibraryState {
  collections: CollectionWithStats[]
  videos: Video[]
  selectedCollectionId: string | null
  loadingCollections: boolean
  loadingVideos: boolean
  importing: boolean

  loadCollections: () => Promise<CollectionWithStats[]>
  selectCollection: (id: string | null) => Promise<void>
  loadVideos: (collectionId: string) => Promise<Video[]>
  refreshCurrent: () => Promise<void>

  createCollection: (input: CreateCollectionInput) => Promise<CollectionWithStats | null>
  updateCollection: (id: string, input: UpdateCollectionInput) => Promise<void>
  deleteCollection: (id: string) => Promise<void>

  importVideos: (collectionId: string, paths: string[]) => Promise<Video[]>
  updateVideo: (id: string, input: UpdateVideoInput) => Promise<Video | null>
  deleteVideo: (id: string) => Promise<void>
  reorder: (collectionId: string, orderedIds: string[]) => Promise<void>
  move: (collectionId: string, videoId: string, direction: 'up' | 'down') => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  resetProgress: (id: string) => Promise<void>
  applyCollectionDefaults: (input: ApplyCollectionDefaultsInput) => Promise<boolean>
  /** Aplica no cache local uma versao ja persistida (ex.: progresso). */
  patchVideoLocal: (video: Video) => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  collections: [],
  videos: [],
  selectedCollectionId: null,
  loadingCollections: false,
  loadingVideos: false,
  importing: false,

  loadCollections: async () => {
    set({ loadingCollections: true })
    try {
      const collections = await window.api.collections.list()
      set({ collections })
      return collections
    } catch (error) {
      toast.error(error)
      return []
    } finally {
      set({ loadingCollections: false })
    }
  },

  selectCollection: async (id) => {
    set({ selectedCollectionId: id, videos: [] })
    if (!id) return
    await get().loadVideos(id)
    void window.api.settings.update({ lastCollectionId: id })
  },

  loadVideos: async (collectionId) => {
    set({ loadingVideos: true })
    try {
      const videos = await window.api.videos.byCollection(collectionId)
      if (get().selectedCollectionId === collectionId) set({ videos })
      return videos
    } catch (error) {
      toast.error(error)
      return []
    } finally {
      set({ loadingVideos: false })
    }
  },

  refreshCurrent: async () => {
    const id = get().selectedCollectionId
    await get().loadCollections()
    if (id) await get().loadVideos(id)
  },

  createCollection: async (input) => {
    try {
      const collection = await window.api.collections.create(input)
      const collections = await get().loadCollections()
      return collections.find((c) => c.id === collection.id) ?? null
    } catch (error) {
      toast.error(error)
      return null
    }
  },

  updateCollection: async (id, input) => {
    try {
      await window.api.collections.update(id, input)
      await get().loadCollections()
    } catch (error) {
      toast.error(error)
    }
  },

  deleteCollection: async (id) => {
    try {
      await window.api.collections.remove(id)
      if (get().selectedCollectionId === id) set({ selectedCollectionId: null, videos: [] })
      await get().loadCollections()
      toast.success('Colecao removida.')
    } catch (error) {
      toast.error(error)
    }
  },

  importVideos: async (collectionId, paths) => {
    if (paths.length === 0) return []
    set({ importing: true })
    try {
      const created = await window.api.videos.import({ collectionId, paths })
      await get().refreshCurrent()
      if (created.length === 0) toast.info('Nenhum video novo encontrado.')
      else toast.success(`${created.length} video(s) importado(s).`)
      return created
    } catch (error) {
      toast.error(error)
      return []
    } finally {
      set({ importing: false })
    }
  },

  updateVideo: async (id, input) => {
    try {
      const video = await window.api.videos.update(id, input)
      get().patchVideoLocal(video)
      return video
    } catch (error) {
      toast.error(error)
      return null
    }
  },

  deleteVideo: async (id) => {
    try {
      await window.api.videos.remove(id)
      set((state) => ({ videos: state.videos.filter((v) => v.id !== id) }))
      await get().loadCollections()
    } catch (error) {
      toast.error(error)
    }
  },

  reorder: async (collectionId, orderedIds) => {
    // Otimista: a lista ja aparece na nova ordem antes da resposta do main.
    const previous = get().videos
    const index = new Map(previous.map((v) => [v.id, v]))
    const optimistic = orderedIds
      .map((id) => index.get(id))
      .filter((v): v is Video => Boolean(v))
      .map((v, position) => ({ ...v, position }))
    set({ videos: optimistic })

    try {
      const videos = await window.api.videos.reorder({ collectionId, orderedIds })
      if (get().selectedCollectionId === collectionId) set({ videos })
    } catch (error) {
      set({ videos: previous })
      toast.error(error)
    }
  },

  move: async (collectionId, videoId, direction) => {
    try {
      const videos = await window.api.videos.move(collectionId, videoId, direction)
      if (get().selectedCollectionId === collectionId) set({ videos })
    } catch (error) {
      toast.error(error)
    }
  },

  toggleFavorite: async (id) => {
    try {
      const video = await window.api.videos.toggleFavorite(id)
      get().patchVideoLocal(video)
    } catch (error) {
      toast.error(error)
    }
  },

  resetProgress: async (id) => {
    try {
      const video = await window.api.videos.resetProgress(id)
      get().patchVideoLocal(video)
      await get().loadCollections()
    } catch (error) {
      toast.error(error)
    }
  },

  applyCollectionDefaults: async (input) => {
    try {
      const updated = await window.api.videos.applyDefaults(input)
      const byId = new Map(updated.map((v) => [v.id, v]))
      set((state) => ({
        videos: state.videos.map((v) => byId.get(v.id) ?? v)
      }))
      toast.success(`Aplicado a ${updated.length} episodio(s).`)
      return true
    } catch (error) {
      toast.error(error)
      return false
    }
  },

  patchVideoLocal: (video) =>
    set((state) => ({
      videos: state.videos.map((v) => (v.id === video.id ? video : v))
    }))
}))
