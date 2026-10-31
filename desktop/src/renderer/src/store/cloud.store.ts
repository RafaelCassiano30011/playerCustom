import { create } from 'zustand'
import type {
  CloudCodeRequest,
  CloudStatus,
  DownloadProgress,
  UploadProgress
} from '@shared/types'
import { toast } from './toast.store'
import { useLibraryStore } from './library.store'

/**
 * Estado da nuvem no renderer.
 *
 * Nao guarda catalogo: a biblioteca continua vindo do `library.store`, que le
 * o cache local do main. Aqui ficam so sessao, conectividade e o andamento
 * dos downloads/uploads — o que a interface precisa para mostrar o que esta
 * disponivel offline e o que vai por streaming.
 */

const STATUS_INICIAL: CloudStatus = {
  signedIn: false,
  email: null,
  apiBaseUrl: '',
  online: true,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  pendingProgress: 0
}

interface CloudState {
  status: CloudStatus
  /** Progresso por `video.id`. */
  downloads: Record<string, DownloadProgress>
  uploads: UploadProgress[]
  busy: boolean

  init: () => Promise<void>
  refreshStatus: () => Promise<void>
  login: (email: string, password: string) => Promise<boolean>
  requestCode: (email: string) => Promise<CloudCodeRequest | null>
  verifyCode: (email: string, code: string) => Promise<boolean>
  register: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  sync: () => Promise<void>
  upload: (collectionId: string, paths: string[]) => Promise<void>
  download: (videoId: string) => Promise<void>
  cancelDownload: (videoId: string) => Promise<void>
  removeOffline: (videoId: string) => Promise<void>
}

export const useCloudStore = create<CloudState>((set, get) => ({
  status: STATUS_INICIAL,
  downloads: {},
  uploads: [],
  busy: false,

  init: async () => {
    await get().refreshStatus()

    const emAndamento = await window.api.cloud.downloads()
    if (emAndamento.length > 0) {
      set({ downloads: Object.fromEntries(emAndamento.map((d) => [d.videoId, d])) })
    }

    window.api.cloud.onStatus((status) => set({ status }))

    window.api.cloud.onDownload((progress) => {
      set((state) => ({ downloads: { ...state.downloads, [progress.videoId]: progress } }))
      if (progress.state === 'done' || progress.state === 'error') {
        // o vinculo da copia offline mudou no main: recarrega a lista
        void useLibraryStore.getState().refreshCurrent()
        if (progress.error) toast.error(progress.error)
      }
    })

    window.api.cloud.onUpload((progress) => {
      set((state) => {
        const outros = state.uploads.filter((u) => u.path !== progress.path)
        // concluido sai da lista; o que falhou fica visivel para o usuario ver
        return {
          uploads: progress.state === 'done' ? outros : [...outros, progress]
        }
      })
      if (progress.state === 'error' && progress.error) toast.error(progress.error)
      if (progress.state === 'done') void useLibraryStore.getState().refreshCurrent()
    })

    // o main avisa quando o sync mexeu na biblioteca
    window.api.onLibraryChanged(() => {
      void useLibraryStore.getState().refreshCurrent()
    })
  },

  refreshStatus: async () => {
    try {
      set({ status: await window.api.cloud.status() })
    } catch (error) {
      toast.error(error)
    }
  },

  login: async (email, password) => {
    set({ busy: true })
    try {
      set({ status: await window.api.cloud.login({ email, password }) })
      toast.success('Conectado a nuvem.')
      return true
    } catch (error) {
      toast.error(error)
      return false
    } finally {
      set({ busy: false })
    }
  },

  requestCode: async (email) => {
    set({ busy: true })
    try {
      return await window.api.cloud.requestCode(email)
    } catch (error) {
      toast.error(error)
      return null
    } finally {
      set({ busy: false })
    }
  },

  verifyCode: async (email, code) => {
    set({ busy: true })
    try {
      set({ status: await window.api.cloud.verifyCode({ email, code }) })
      toast.success('Conectado a nuvem.')
      return true
    } catch (error) {
      toast.error(error)
      return false
    } finally {
      set({ busy: false })
    }
  },

  register: async (email, password) => {
    set({ busy: true })
    try {
      set({ status: await window.api.cloud.register({ email, password }) })
      toast.success('Conta criada.')
      return true
    } catch (error) {
      toast.error(error)
      return false
    } finally {
      set({ busy: false })
    }
  },

  logout: async () => {
    set({ busy: true })
    try {
      set({ status: await window.api.cloud.logout() })
      await useLibraryStore.getState().refreshCurrent()
    } catch (error) {
      toast.error(error)
    } finally {
      set({ busy: false })
    }
  },

  sync: async () => {
    set({ busy: true })
    try {
      const resultado = await window.api.cloud.sync()
      await useLibraryStore.getState().refreshCurrent()
      await get().refreshStatus()
      toast.success(
        `Sincronizado: ${resultado.videos} video(s), ${resultado.progressPushed} posicao(oes) enviada(s).`
      )
    } catch (error) {
      toast.error(error)
    } finally {
      set({ busy: false })
    }
  },

  upload: async (collectionId, paths) => {
    try {
      const criados = await window.api.cloud.upload({ collectionId, paths })
      await useLibraryStore.getState().refreshCurrent()
      if (criados.length > 0) toast.success(`${criados.length} video(s) enviado(s).`)
    } catch (error) {
      toast.error(error)
    }
  },

  download: async (videoId) => {
    try {
      const progresso = await window.api.cloud.download(videoId)
      set((state) => ({ downloads: { ...state.downloads, [videoId]: progresso } }))
    } catch (error) {
      toast.error(error)
    }
  },

  cancelDownload: async (videoId) => {
    try {
      await window.api.cloud.cancelDownload(videoId)
    } catch (error) {
      toast.error(error)
    }
  },

  removeOffline: async (videoId) => {
    try {
      await window.api.cloud.removeOffline(videoId)
      await useLibraryStore.getState().refreshCurrent()
      toast.info('Copia local removida. O video continua na nuvem.')
    } catch (error) {
      toast.error(error)
    }
  }
}))
