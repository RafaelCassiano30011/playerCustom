/**
 * Tipos de dominio compartilhados entre main, preload e renderer.
 * Fonte unica da verdade: alterar aqui reflete nas tres camadas.
 */

export type VideoStatus = 'not_started' | 'in_progress' | 'completed'

/**
 * De onde vem a midia.
 *
 * `local`: arquivo que o usuario importou do disco.
 * `cloud`: arquivo que vive no R2. Toca por streaming, ou do disco quando
 * baixado para assistir offline (`offlinePath`).
 */
export type VideoSource = 'local' | 'cloud'

export type DownloadState = 'idle' | 'queued' | 'downloading' | 'done' | 'error'

export type RepeatMode = 'off' | 'one' | 'all'

export interface Collection {
  id: string
  name: string
  description: string | null
  thumbnail: string | null
  /** Id da colecao no servidor; null quando e so local. */
  remoteId: string | null
  createdAt: number
  updatedAt: number
}

export interface CollectionWithStats extends Collection {
  videoCount: number
  completedCount: number
  totalDuration: number
}

export interface Video {
  id: string
  collectionId: string
  name: string
  path: string
  /** Duracao total em segundos (0 enquanto desconhecida). */
  duration: number
  thumbnail: string | null
  /** Segundo em que o botao "Pular abertura" aparece. */
  introStart: number | null
  /** Segundo em que o botao "Pular abertura" some. */
  introEnd: number | null
  /** Segundo de destino ao clicar em "Pular abertura". */
  introSkipTo: number | null
  /** Quantos segundos antes do fim exibir "Proximo episodio". */
  nextEpisodeOffset: number | null
  position: number
  status: VideoStatus
  lastPosition: number
  favorite: boolean
  lastPlayedAt: number | null
  source: VideoSource
  /** Id do arquivo no servidor; null quando e so local. */
  remoteId: string | null
  /** Tamanho em bytes (0 quando desconhecido). */
  sizeBytes: number
  /** Copia baixada para assistir offline; null quando so existe na nuvem. */
  offlinePath: string | null
  createdAt: number
  updatedAt: number
}

export interface HistoryEntry {
  id: number
  videoId: string
  collectionId: string
  playedAt: number
  position: number
  videoName: string
  collectionName: string
}

/** Estilo de fundo do texto da legenda. */
export type SubtitleBackground = 'none' | 'box' | 'blur'

export interface SubtitleStyle {
  fontSize: number
  fontFamily: string
  color: string
  /** Peso da fonte: 400 normal, 700 negrito. */
  fontWeight: 400 | 500 | 600 | 700 | 800
  background: SubtitleBackground
  /** Opacidade do fundo, 0..1 (ignorado quando background e 'none'). */
  backgroundOpacity: number
  /** Contorno preto ao redor das letras, em pixels (0 desliga). */
  outlineWidth: number
  /** Sombra projetada atras do texto. */
  shadow: boolean
  /** Distancia do texto ate a base do video, em % da altura. */
  bottomOffset: number
  /** Largura maxima do bloco de texto, em % da largura do video. */
  maxWidth: number
  lineHeight: number
  /** Deslocamento de sincronia em segundos (negativo adianta). */
  delay: number
}

export interface AppSettings {
  volume: number
  muted: boolean
  playbackRate: number
  autoPlayNext: boolean
  shuffle: boolean
  repeat: RepeatMode
  seekStep: number
  volumeStep: number
  defaultNextEpisodeOffset: number
  subtitlesEnabled: boolean
  /** @deprecated Mantido para compatibilidade; use `subtitleStyle.fontSize`. */
  subtitleFontSize: number
  subtitleStyle: SubtitleStyle
  autoThumbnails: boolean
  lastCollectionId: string | null
  lastVideoId: string | null
  theme: 'dark' | 'midnight'
  /** Base da API na nuvem (sem barra no fim). */
  cloudApiBaseUrl: string
  /** Sincroniza catalogo e progresso em segundo plano. */
  cloudAutoSync: boolean
  /** Enviar para a nuvem todo video importado, sem pedir. */
  cloudAutoUpload: boolean
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 26,
  fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
  color: '#ffffff',
  fontWeight: 600,
  background: 'box',
  backgroundOpacity: 0.6,
  outlineWidth: 0,
  shadow: true,
  bottomOffset: 8,
  maxWidth: 80,
  lineHeight: 1.35,
  delay: 0
}

/** Opcoes de fonte oferecidas na interface. */
export const SUBTITLE_FONTS: Array<{ label: string; value: string }> = [
  { label: 'Padrao do sistema', value: 'Inter, "Segoe UI", system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Georgia (serifada)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Monoespacada', value: 'Consolas, "Courier New", monospace' }
]

export const DEFAULT_SETTINGS: AppSettings = {
  volume: 0.8,
  muted: false,
  playbackRate: 1,
  autoPlayNext: true,
  shuffle: false,
  repeat: 'off',
  seekStep: 10,
  volumeStep: 0.05,
  defaultNextEpisodeOffset: 60,
  subtitlesEnabled: true,
  subtitleFontSize: 24,
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  autoThumbnails: true,
  lastCollectionId: null,
  lastVideoId: null,
  theme: 'dark',
  cloudApiBaseUrl: 'https://playercustom-api.player-d22.workers.dev',
  cloudAutoSync: true,
  cloudAutoUpload: true
}

/* ---------- Payloads de entrada ---------- */

export interface CreateCollectionInput {
  name: string
  description?: string | null
  thumbnail?: string | null
}

export type UpdateCollectionInput = Partial<CreateCollectionInput>

export interface ImportVideosInput {
  collectionId: string
  paths: string[]
}

export interface UpdateVideoInput {
  name?: string
  duration?: number
  thumbnail?: string | null
  introStart?: number | null
  introEnd?: number | null
  introSkipTo?: number | null
  nextEpisodeOffset?: number | null
  favorite?: boolean
  status?: VideoStatus
  collectionId?: string
}

export interface SaveProgressInput {
  videoId: string
  position: number
  duration?: number
  completed?: boolean
}

/* ---------- Nuvem ---------- */

export interface CloudCodeInput {
  email: string
  code: string
}

/** Resposta do pedido de codigo: quanto vale e quando pode pedir outro. */
export interface CloudCodeRequest {
  retryAfter: number
  expiresIn: number
}

export interface CloudCredentials {
  email: string
  password: string
}

export interface CloudStatus {
  /** Ha sessao gravada (mesmo que o acesso tenha expirado). */
  signedIn: boolean
  email: string | null
  apiBaseUrl: string
  /** Ultima chamada a API funcionou. Falso enquanto offline. */
  online: boolean
  syncing: boolean
  lastSyncAt: number | null
  lastError: string | null
  /** Posicoes ainda nao enviadas, acumuladas enquanto offline. */
  pendingProgress: number
}

export interface CloudSyncResult {
  collections: number
  videos: number
  removed: number
  /** Posicoes enviadas nesta rodada. */
  progressPushed: number
  /** Posicoes recebidas do servidor. */
  progressPulled: number
}

export interface DownloadProgress {
  videoId: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  /** 0..1 */
  fraction: number
  error: string | null
}

export interface UploadProgress {
  /** Caminho do arquivo local sendo enviado. */
  path: string
  name: string
  state: 'uploading' | 'done' | 'error'
  sentBytes: number
  totalBytes: number
  fraction: number
  error: string | null
}

export interface CloudUploadInput {
  /** Colecao local de destino; precisa ter `remoteId`. */
  collectionId: string
  paths: string[]
}

export interface ApplyCollectionDefaultsInput {
  collectionId: string
  introStart: number | null
  introEnd: number | null
  introSkipTo: number | null
  nextEpisodeOffset: number | null
  /** false: so preenche videos sem configuracao propria. true: sobrescreve todos. */
  overwrite: boolean
}

export interface ReorderInput {
  collectionId: string
  /** Ids na nova ordem, indice do array vira o campo `position`. */
  orderedIds: string[]
}

export interface SearchResult {
  collections: Collection[]
  videos: Video[]
}

export interface SubtitleCue {
  id: number
  start: number
  end: number
  text: string
}

export interface SubtitleTrack {
  path: string
  label: string
  cues: SubtitleCue[]
}

/** Faixa embutida no proprio arquivo (MKV/MP4), detectada via ffprobe. */
export interface EmbeddedTrackInfo {
  index: number
  codec: string
  language: string | null
  title: string | null
  isDefault: boolean
}

export interface ProbeResult {
  audio: EmbeddedTrackInfo[]
  subtitle: EmbeddedTrackInfo[]
}

export interface MediaFileInfo {
  path: string
  name: string
  size: number
}

/** Formatos aceitos na importacao / drag and drop. */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  'mp4',
  'mkv',
  'webm',
  'avi',
  'mov',
  'm4v',
  'mpg',
  'mpeg',
  'wmv',
  'flv',
  'ogv',
  '3gp'
] as const

export const SUPPORTED_SUBTITLE_EXTENSIONS = ['srt', 'vtt'] as const
