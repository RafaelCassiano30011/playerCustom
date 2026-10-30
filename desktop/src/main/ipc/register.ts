import { dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  SUPPORTED_SUBTITLE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS
} from '@shared/types'
import type {
  ApplyCollectionDefaultsInput,
  AppSettings,
  CloudCredentials,
  CloudUploadInput,
  CreateCollectionInput,
  ImportVideosInput,
  ReorderInput,
  SaveProgressInput,
  SearchResult,
  UpdateCollectionInput,
  UpdateVideoInput
} from '@shared/types'
import { collectionRepository } from '../repositories/collection.repository'
import { videoRepository } from '../repositories/video.repository'
import { historyRepository } from '../repositories/history.repository'
import { settingsRepository } from '../repositories/settings.repository'
import { fileService } from '../services/file.service'
import { subtitleService } from '../services/subtitle.service'
import { thumbnailService } from '../services/thumbnail.service'
import { extractSubtitleTrack, probeTracks } from '../services/track.service'
import { getMainWindow } from '../window'
import * as cloud from '../cloud'

/** Envolve handlers para que erros virem rejeicoes legiveis no renderer. */
function handle<T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as never[]))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[ipc] ${channel}`, error)
      throw new Error(message)
    }
  })
}

export function registerIpcHandlers(): void {
  /* ---------- Colecoes ---------- */
  handle(IPC.collectionsList, () => collectionRepository.list())
  handle(IPC.collectionsCreate, (input: CreateCollectionInput) => collectionRepository.create(input))
  handle(IPC.collectionsUpdate, (id: string, input: UpdateCollectionInput) =>
    collectionRepository.update(id, input)
  )
  handle(IPC.collectionsDelete, (id: string) => collectionRepository.remove(id))

  /* ---------- Videos ---------- */
  handle(IPC.videosByCollection, (collectionId: string) =>
    videoRepository.byCollection(collectionId)
  )
  handle(IPC.videosGet, (id: string) => videoRepository.find(id))
  handle(IPC.videosImport, async ({ collectionId, paths }: ImportVideosInput) => {
    const files = await fileService.resolve(paths)
    return videoRepository.importMany(
      collectionId,
      files.map((f) => f.path)
    )
  })
  handle(IPC.videosUpdate, (id: string, input: UpdateVideoInput) =>
    videoRepository.update(id, input)
  )
  handle(IPC.videosDelete, async (id: string) => {
    const video = videoRepository.find(id)
    videoRepository.remove(id)
    await thumbnailService.remove(video?.thumbnail ?? null)
  })
  handle(IPC.videosReorder, (input: ReorderInput) => videoRepository.reorder(input))
  handle(IPC.videosMove, (collectionId: string, videoId: string, direction: 'up' | 'down') =>
    videoRepository.move(collectionId, videoId, direction)
  )
  handle(IPC.videosSaveProgress, (input: SaveProgressInput) => {
    // Grava local e, se o video vive na nuvem, enfileira o envio da posicao.
    const video = cloud.saveProgress(input)
    historyRepository.record(video.id, video.collectionId, video.lastPosition)
    return video
  })
  handle(IPC.videosResetProgress, (id: string) => videoRepository.resetProgress(id))
  handle(IPC.videosToggleFavorite, (id: string) => videoRepository.toggleFavorite(id))
  handle(IPC.videosFavorites, () => videoRepository.favorites())
  handle(IPC.videosContinue, (limit?: number) => videoRepository.continueWatching(limit))
  handle(IPC.videosSaveThumbnail, async (id: string, dataUrl: string) => {
    const path = await thumbnailService.saveDataUrl(id, dataUrl)
    return videoRepository.update(id, { thumbnail: path })
  })
  handle(IPC.videosGenerateThumbnail, async (id: string) => {
    const video = videoRepository.find(id)
    if (!video) return null
    const result = await thumbnailService.generate(video.id, video.path)
    if (!result) return null
    return videoRepository.update(id, {
      thumbnail: result.path,
      ...(result.duration > 0 && !video.duration ? { duration: result.duration } : {})
    })
  })
  handle(IPC.videosApplyDefaults, (input: ApplyCollectionDefaultsInput) =>
    videoRepository.applyDefaults(input)
  )

  /* ---------- Historico ---------- */
  handle(IPC.historyList, (limit?: number) => historyRepository.list(limit))
  handle(IPC.historyClear, () => historyRepository.clear())

  /* ---------- Configuracoes ---------- */
  handle(IPC.settingsGet, () => settingsRepository.get())
  handle(IPC.settingsUpdate, (patch: Partial<AppSettings>) => settingsRepository.update(patch))

  /* ---------- Busca ---------- */
  handle(IPC.searchQuery, (term: string): SearchResult => {
    const needle = term.trim().toLowerCase()
    if (!needle) return { collections: [], videos: [] }
    return {
      collections: collectionRepository.list().filter((c) => c.name.toLowerCase().includes(needle)),
      videos: videoRepository.search(needle)
    }
  })

  /* ---------- Dialogos ---------- */
  handle(IPC.dialogPickVideos, async () => {
    const window = getMainWindow()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      title: 'Selecionar videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: [...SUPPORTED_VIDEO_EXTENSIONS] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.dialogPickFolder, async () => {
    const window = getMainWindow()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      title: 'Selecionar pasta',
      properties: ['openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.dialogPickImage, async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Selecionar miniatura',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.dialogPickSubtitle, async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Selecionar legenda',
      properties: ['openFile'],
      filters: [{ name: 'Legendas', extensions: [...SUPPORTED_SUBTITLE_EXTENSIONS] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  /* ---------- Nuvem ---------- */
  handle(IPC.cloudStatus, () => cloud.status())
  handle(IPC.cloudLogin, ({ email, password }: CloudCredentials) =>
    cloud.signInExisting(email, password)
  )
  handle(IPC.cloudRegister, ({ email, password }: CloudCredentials) =>
    cloud.signUp(email, password)
  )
  handle(IPC.cloudLogout, () => cloud.signOut())
  handle(IPC.cloudSync, () => cloud.sync(true))
  handle(IPC.cloudUpload, ({ collectionId, paths }: CloudUploadInput) =>
    cloud.upload(collectionId, paths)
  )
  handle(IPC.cloudDownload, (videoId: string) => cloud.download(videoId))
  handle(IPC.cloudCancelDownload, (videoId: string) => cloud.cancelDownload(videoId))
  handle(IPC.cloudRemoveOffline, (videoId: string) => cloud.removeOffline(videoId))
  handle(IPC.cloudDownloads, () => cloud.activeDownloads())

  /* ---------- Legendas e arquivos ---------- */
  handle(IPC.subtitleLoad, (path: string) => subtitleService.load(path))
  handle(IPC.subtitleAuto, (videoPath: string) => subtitleService.findForVideo(videoPath))
  handle(IPC.tracksProbe, (videoPath: string) => probeTracks(videoPath))
  handle(IPC.tracksExtractSubtitle, (videoPath: string, streamIndex: number) =>
    extractSubtitleTrack(videoPath, streamIndex)
  )
  handle(IPC.filesResolve, (paths: string[]) => fileService.resolve(paths))

  /* ---------- Janela ---------- */
  ipcMain.on(IPC.windowMinimize, () => getMainWindow()?.minimize())
  ipcMain.on(IPC.windowMaximize, () => {
    const window = getMainWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getMainWindow()?.close())
  handle(IPC.windowSetFullscreen, (value: boolean) => {
    const window = getMainWindow()
    if (!window) return false
    window.setFullScreen(value)
    return window.isFullScreen()
  })
}
