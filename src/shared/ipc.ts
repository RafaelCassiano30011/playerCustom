import type {
  ApplyCollectionDefaultsInput,
  AppSettings,
  Collection,
  CollectionWithStats,
  CreateCollectionInput,
  HistoryEntry,
  ImportVideosInput,
  MediaFileInfo,
  ProbeResult,
  ReorderInput,
  SaveProgressInput,
  SearchResult,
  SubtitleTrack,
  UpdateCollectionInput,
  UpdateVideoInput,
  Video
} from './types'

/** Canais IPC. Tipados para evitar strings soltas nas duas pontas. */
export const IPC = {
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsUpdate: 'collections:update',
  collectionsDelete: 'collections:delete',

  videosByCollection: 'videos:byCollection',
  videosGet: 'videos:get',
  videosImport: 'videos:import',
  videosUpdate: 'videos:update',
  videosDelete: 'videos:delete',
  videosReorder: 'videos:reorder',
  videosMove: 'videos:move',
  videosSaveProgress: 'videos:saveProgress',
  videosResetProgress: 'videos:resetProgress',
  videosToggleFavorite: 'videos:toggleFavorite',
  videosFavorites: 'videos:favorites',
  videosContinue: 'videos:continue',
  videosSaveThumbnail: 'videos:saveThumbnail',
  videosGenerateThumbnail: 'videos:generateThumbnail',
  videosApplyDefaults: 'videos:applyDefaults',

  historyList: 'history:list',
  historyClear: 'history:clear',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  searchQuery: 'search:query',

  dialogPickVideos: 'dialog:pickVideos',
  dialogPickFolder: 'dialog:pickFolder',
  dialogPickImage: 'dialog:pickImage',
  dialogPickSubtitle: 'dialog:pickSubtitle',

  subtitleLoad: 'subtitle:load',
  subtitleAuto: 'subtitle:auto',

  tracksProbe: 'tracks:probe',
  tracksExtractSubtitle: 'tracks:extractSubtitle',

  filesResolve: 'files:resolve',

  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowSetFullscreen: 'window:setFullscreen',

  eventFilesDropped: 'event:filesDropped'
} as const

/** Superficie exposta em `window.api`. */
export interface RendererApi {
  collections: {
    list(): Promise<CollectionWithStats[]>
    create(input: CreateCollectionInput): Promise<Collection>
    update(id: string, input: UpdateCollectionInput): Promise<Collection>
    remove(id: string): Promise<void>
  }
  videos: {
    byCollection(collectionId: string): Promise<Video[]>
    get(id: string): Promise<Video | null>
    import(input: ImportVideosInput): Promise<Video[]>
    update(id: string, input: UpdateVideoInput): Promise<Video>
    remove(id: string): Promise<void>
    reorder(input: ReorderInput): Promise<Video[]>
    move(collectionId: string, videoId: string, direction: 'up' | 'down'): Promise<Video[]>
    saveProgress(input: SaveProgressInput): Promise<Video>
    resetProgress(id: string): Promise<Video>
    toggleFavorite(id: string): Promise<Video>
    favorites(): Promise<Video[]>
    continueWatching(limit?: number): Promise<Video[]>
    saveThumbnail(id: string, dataUrl: string): Promise<Video>
    /** Gera a miniatura via ffmpeg no processo principal (nao usa o decoder do renderer). */
    generateThumbnail(id: string): Promise<Video | null>
    /** Aplica abertura/proximo episodio a todos os videos da colecao em uma unica chamada. */
    applyDefaults(input: ApplyCollectionDefaultsInput): Promise<Video[]>
  }
  history: {
    list(limit?: number): Promise<HistoryEntry[]>
    clear(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  search(term: string): Promise<SearchResult>
  dialog: {
    pickVideos(): Promise<string[]>
    pickFolder(): Promise<string[]>
    pickImage(): Promise<string | null>
    pickSubtitle(): Promise<string | null>
  }
  subtitles: {
    load(path: string): Promise<SubtitleTrack | null>
    auto(videoPath: string): Promise<SubtitleTrack | null>
  }
  tracks: {
    /** Faixas de audio/legenda embutidas no arquivo (MKV/MP4), via ffprobe. */
    probe(videoPath: string): Promise<ProbeResult>
    /** Extrai uma faixa de legenda embutida (texto) para .srt em cache. */
    extractSubtitle(videoPath: string, streamIndex: number): Promise<string | null>
  }
  files: {
    resolve(paths: string[]): Promise<MediaFileInfo[]>
    /** Converte caminho absoluto em URL do protocolo `media://`. */
    toMediaUrl(path: string): string
    /** URL que remultiplexa o arquivo com a faixa de audio escolhida. */
    toAudioTrackUrl(path: string, audioStreamIndex: number, startSeconds: number): string
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
    setFullscreen(value: boolean): Promise<boolean>
  }
  onFilesDropped(handler: (paths: string[]) => void): () => void
}

export const MEDIA_SCHEME = 'media'

export function toMediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://${encodeURIComponent(absolutePath)}`
}

/**
 * URL que forca uma faixa de audio especifica. O arquivo passa pelo ffmpeg,
 * entao o stream comeca em `startSeconds` e nao aceita seek por Range.
 */
export function toAudioTrackUrl(
  absolutePath: string,
  audioStreamIndex: number,
  startSeconds: number
): string {
  const query = `a=${audioStreamIndex}&t=${Math.max(0, Math.floor(startSeconds))}`
  return `${MEDIA_SCHEME}://${encodeURIComponent(absolutePath)}?${query}`
}
