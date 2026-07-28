import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, toAudioTrackUrl, toMediaUrl } from '@shared/ipc'
import type { RendererApi } from '@shared/ipc'
import type {
  ApplyCollectionDefaultsInput,
  AppSettings,
  CreateCollectionInput,
  ImportVideosInput,
  ReorderInput,
  SaveProgressInput,
  UpdateCollectionInput,
  UpdateVideoInput
} from '@shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: RendererApi = {
  collections: {
    list: () => invoke(IPC.collectionsList),
    create: (input: CreateCollectionInput) => invoke(IPC.collectionsCreate, input),
    update: (id: string, input: UpdateCollectionInput) => invoke(IPC.collectionsUpdate, id, input),
    remove: (id: string) => invoke(IPC.collectionsDelete, id)
  },
  videos: {
    byCollection: (collectionId: string) => invoke(IPC.videosByCollection, collectionId),
    get: (id: string) => invoke(IPC.videosGet, id),
    import: (input: ImportVideosInput) => invoke(IPC.videosImport, input),
    update: (id: string, input: UpdateVideoInput) => invoke(IPC.videosUpdate, id, input),
    remove: (id: string) => invoke(IPC.videosDelete, id),
    reorder: (input: ReorderInput) => invoke(IPC.videosReorder, input),
    move: (collectionId: string, videoId: string, direction: 'up' | 'down') =>
      invoke(IPC.videosMove, collectionId, videoId, direction),
    saveProgress: (input: SaveProgressInput) => invoke(IPC.videosSaveProgress, input),
    resetProgress: (id: string) => invoke(IPC.videosResetProgress, id),
    toggleFavorite: (id: string) => invoke(IPC.videosToggleFavorite, id),
    favorites: () => invoke(IPC.videosFavorites),
    continueWatching: (limit?: number) => invoke(IPC.videosContinue, limit),
    saveThumbnail: (id: string, dataUrl: string) => invoke(IPC.videosSaveThumbnail, id, dataUrl),
    generateThumbnail: (id: string) => invoke(IPC.videosGenerateThumbnail, id),
    applyDefaults: (input: ApplyCollectionDefaultsInput) => invoke(IPC.videosApplyDefaults, input)
  },
  history: {
    list: (limit?: number) => invoke(IPC.historyList, limit),
    clear: () => invoke(IPC.historyClear)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => invoke(IPC.settingsUpdate, patch)
  },
  search: (term: string) => invoke(IPC.searchQuery, term),
  dialog: {
    pickVideos: () => invoke(IPC.dialogPickVideos),
    pickFolder: () => invoke(IPC.dialogPickFolder),
    pickImage: () => invoke(IPC.dialogPickImage),
    pickSubtitle: () => invoke(IPC.dialogPickSubtitle)
  },
  subtitles: {
    load: (path: string) => invoke(IPC.subtitleLoad, path),
    auto: (videoPath: string) => invoke(IPC.subtitleAuto, videoPath)
  },
  tracks: {
    probe: (videoPath: string) => invoke(IPC.tracksProbe, videoPath),
    extractSubtitle: (videoPath: string, streamIndex: number) =>
      invoke(IPC.tracksExtractSubtitle, videoPath, streamIndex)
  },
  files: {
    resolve: (paths: string[]) => invoke(IPC.filesResolve, paths),
    toMediaUrl,
    toAudioTrackUrl
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximize: () => ipcRenderer.send(IPC.windowMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    setFullscreen: (value: boolean) => invoke(IPC.windowSetFullscreen, value)
  },
  onFilesDropped: (handler: (paths: string[]) => void) => {
    const listener = (_event: unknown, paths: string[]): void => handler(paths)
    ipcRenderer.on(IPC.eventFilesDropped, listener)
    return () => ipcRenderer.removeListener(IPC.eventFilesDropped, listener)
  }
}

/**
 * `File.path` foi removido no Electron 32+. `webUtils.getPathForFile` e a via
 * oficial para descobrir o caminho real de um arquivo arrastado para a janela.
 */
const dnd = {
  pathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('dnd', dnd)
contextBridge.exposeInMainWorld('platform', process.platform)
