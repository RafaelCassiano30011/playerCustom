/**
 * Formato das respostas da API na nuvem (ver `server/README.md`).
 *
 * Fica num arquivo so para o resto do main nao conhecer nomes de campo do
 * servidor: a traducao para os tipos do app acontece nos services daqui.
 */

export interface Paginated<T> {
  items: T[]
  nextCursor?: string
}

export interface RemoteCollection {
  id: string
  name: string
  description: string | null
  fileCount: number
  hasCover: boolean
  createdAt: number
  updatedAt: number
}

export interface RemoteFile {
  id: string
  originalName: string
  format: string
  mimeType: string
  sizeBytes: number
  status: string
  sha256: string | null
  metadata: unknown
  hasCover: boolean
  durationSeconds: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
  audioCodec: string | null
  collectionIds: string[]
  createdAt: number
  updatedAt: number
}

export interface RemoteProgress {
  fileId: string
  positionSeconds: number
  durationSeconds: number
  fraction: number
  audioTrack: string | null
  subtitleTrack: string | null
  playbackRate: number | null
  completed: number
  openedAt: number
  updatedAt: number
  /** Presente so na resposta do PUT: false quando a posicao gravada e mais nova. */
  applied?: boolean
}

export interface RemoteChanges {
  serverTime: number
  cursor: number
  hasMore: boolean
  collections: Array<{ id: string; name: string; description: string | null; updatedAt: number }>
  files: Array<{
    id: string
    originalName: string
    format: string
    sizeBytes: number
    status: string
    updatedAt: number
    deleted: boolean
  }>
  progress: RemoteProgress[]
}

export interface RemoteStreamLink {
  url: string
  /** Epoch em SEGUNDOS (igual ao `exp` do token). */
  expiresAt: number
  mimeType: string
  sizeBytes: number
  durationSeconds: number | null
}

export interface RemoteUploadInit {
  uploadId: string
  fileId: string
  strategy: 'single' | 'multipart'
  partSize?: number
  expiresAt: number
}
