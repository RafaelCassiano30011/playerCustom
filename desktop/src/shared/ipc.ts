import type {
  ApplyCollectionDefaultsInput,
  AppSettings,
  CloudCodeInput,
  CloudCodeRequest,
  CloudCredentials,
  CloudStatus,
  CloudSyncResult,
  CloudUploadInput,
  Collection,
  CollectionWithStats,
  CreateCollectionInput,
  DownloadProgress,
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
  UploadProgress,
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

  cloudStatus: 'cloud:status',
  cloudLogin: 'cloud:login',
  cloudRequestCode: 'cloud:requestCode',
  cloudVerifyCode: 'cloud:verifyCode',
  cloudRegister: 'cloud:register',
  cloudLogout: 'cloud:logout',
  cloudSync: 'cloud:sync',
  cloudUpload: 'cloud:upload',
  cloudDownload: 'cloud:download',
  cloudCancelDownload: 'cloud:cancelDownload',
  cloudRemoveOffline: 'cloud:removeOffline',
  cloudDownloads: 'cloud:downloads',

  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowSetFullscreen: 'window:setFullscreen',

  eventFilesDropped: 'event:filesDropped',
  eventCloudStatus: 'event:cloudStatus',
  eventCloudDownload: 'event:cloudDownload',
  eventCloudUpload: 'event:cloudUpload',
  eventLibraryChanged: 'event:libraryChanged'
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
    /** URL que faz o main buscar os bytes na nuvem (streaming). */
    toCloudUrl(remoteId: string): string
  }
  cloud: {
    status(): Promise<CloudStatus>
    login(input: CloudCredentials): Promise<CloudStatus>
    /** Dispara o e-mail com o codigo de acesso. */
    requestCode(email: string): Promise<CloudCodeRequest>
    /** Entra com o codigo recebido; cria a conta no primeiro acesso. */
    verifyCode(input: CloudCodeInput): Promise<CloudStatus>
    register(input: CloudCredentials): Promise<CloudStatus>
    logout(): Promise<CloudStatus>
    /** Puxa catalogo e progresso, e envia o que estava na fila. */
    sync(): Promise<CloudSyncResult>
    /** Envia arquivos locais para a colecao na nuvem. */
    upload(input: CloudUploadInput): Promise<Video[]>
    /** Baixa para assistir offline. Retoma de onde parou. */
    download(videoId: string): Promise<DownloadProgress>
    cancelDownload(videoId: string): Promise<void>
    /** Apaga a copia local; o video continua na nuvem. */
    removeOffline(videoId: string): Promise<Video>
    /** Downloads em andamento (para a UI se recuperar ao remontar). */
    downloads(): Promise<DownloadProgress[]>
    onStatus(handler: (status: CloudStatus) => void): () => void
    onDownload(handler: (progress: DownloadProgress) => void): () => void
    onUpload(handler: (progress: UploadProgress) => void): () => void
  }
  /** O main mexeu na biblioteca (sync, upload, download): recarregar. */
  onLibraryChanged(handler: () => void): () => void
  window: {
    minimize(): void
    maximize(): void
    close(): void
    setFullscreen(value: boolean): Promise<boolean>
  }
  onFilesDropped(handler: (paths: string[]) => void): () => void
}

export const MEDIA_SCHEME = 'media'

/**
 * Prefixo das URLs de video que vivem na nuvem. O handler do protocolo
 * reconhece o prefixo, pede um link assinado e repassa os bytes (com Range),
 * de modo que o token nunca chega ao renderer.
 */
export const CLOUD_PREFIX = 'cloud/'

export function toCloudUrl(remoteId: string): string {
  return `${MEDIA_SCHEME}://${CLOUD_PREFIX}${encodeURIComponent(remoteId)}`
}

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
