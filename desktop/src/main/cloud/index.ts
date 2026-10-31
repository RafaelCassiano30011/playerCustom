import { connectivity, login, loginWithCode, logout, register } from './api-client'
import { session } from './session'
import { flushQueue } from './progress.service'
import { pullCatalog, pullChanges } from './sync.service'
import { verifyOfflineCopies } from './download.service'
import { db } from '../storage/database'
import type { CloudStatus, CloudSyncResult } from '@shared/types'

export { CloudError, OfflineError, connectivity, requestCode } from './api-client'
export { saveProgress, markOpened, flushQueue } from './progress.service'
export { proxyStream, signedLink, forgetLink } from './stream.service'
export { download, cancel as cancelDownload, removeOffline, activeDownloads, onDownloadProgress } from './download.service'
export { upload, onUploadProgress } from './upload.service'
export { session } from './session'

/**
 * Coordena a parte da nuvem: estado que a interface mostra, sincronizacao de
 * fundo e o aviso de "a biblioteca mudou".
 *
 * O resto do app nao sabe se esta online. Quem fala com a rede e este modulo
 * e os services ao lado; a interface le a biblioteca local sempre, e so
 * consulta o `status` para mostrar o aviso de offline e a fila pendente.
 */

type StatusListener = (status: CloudStatus) => void
type ChangeListener = () => void

const statusListeners = new Set<StatusListener>()
const changeListeners = new Set<ChangeListener>()

let syncing = false
let lastSyncError: string | null = null
let timer: NodeJS.Timeout | null = null
/** O catalogo inteiro e puxado uma vez por execucao; depois, so o incremental. */
let catalogPulled = false

/** Intervalo do sync de fundo: curto o bastante para a TV e o desktop se verem. */
const SYNC_INTERVAL_MS = 3 * 60_000

export function onStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function onLibraryChanged(listener: ChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function status(): CloudStatus {
  const { online, lastError } = connectivity()
  const settings = db().settings
  return {
    signedIn: session.signedIn,
    email: session.email,
    apiBaseUrl: settings.cloudApiBaseUrl,
    online,
    syncing,
    lastSyncAt: session.lastSyncAt,
    lastError: lastSyncError ?? lastError,
    pendingProgress: session.queueSize
  }
}

function emitStatus(): void {
  const atual = status()
  for (const listener of statusListeners) listener(atual)
}

function emitLibraryChanged(): void {
  for (const listener of changeListeners) listener()
}

/**
 * Uma rodada de sincronizacao: envia a fila, puxa catalogo (na primeira vez) e
 * aplica o incremental. Sem sessao, nao faz nada — e o modo "so local".
 */
export async function sync(forceCatalog = false): Promise<CloudSyncResult> {
  const vazio: CloudSyncResult = {
    collections: 0,
    videos: 0,
    removed: 0,
    progressPushed: 0,
    progressPulled: 0
  }
  if (!session.signedIn || syncing) return vazio

  syncing = true
  lastSyncError = null
  emitStatus()

  try {
    const progressPushed = await flushQueue()

    const catalogo =
      forceCatalog || !catalogPulled
        ? await pullCatalog()
        : { collections: 0, videos: 0, removed: 0 }
    if (forceCatalog || !catalogPulled) catalogPulled = true

    const mudancas = await pullChanges()

    const resultado: CloudSyncResult = {
      collections: catalogo.collections,
      videos: catalogo.videos,
      removed: catalogo.removed + mudancas.removed,
      progressPushed,
      progressPulled: mudancas.progressPulled
    }

    const mexeu =
      resultado.videos > 0 ||
      resultado.removed > 0 ||
      resultado.progressPulled > 0 ||
      resultado.collections > 0
    if (mexeu) emitLibraryChanged()

    return resultado
  } catch (error) {
    lastSyncError = error instanceof Error ? error.message : String(error)
    return vazio
  } finally {
    syncing = false
    emitStatus()
  }
}

async function signIn(
  acao: (email: string, password: string) => Promise<void>,
  email: string,
  password: string
): Promise<CloudStatus> {
  await acao(email, password)
  catalogPulled = false
  // nao espera o sync: o login responde na hora e a biblioteca chega depois
  void sync(true)
  emitStatus()
  return status()
}

export function signInExisting(email: string, password: string): Promise<CloudStatus> {
  return signIn(login, email, password)
}

export function signUp(email: string, password: string): Promise<CloudStatus> {
  return signIn(register, email, password)
}

/** Entra com o codigo que chegou por e-mail; cria a conta no primeiro acesso. */
export function signInWithCode(email: string, code: string): Promise<CloudStatus> {
  return signIn(loginWithCode, email, code)
}

export async function signOut(): Promise<CloudStatus> {
  await logout()
  catalogPulled = false
  emitStatus()
  return status()
}

/**
 * Liga a nuvem no start do app: confere as copias offline, agenda o sync e
 * faz a primeira rodada. Nada disso bloqueia a janela.
 */
export function startCloud(): void {
  void verifyOfflineCopies(db().videos).then((corrigidos) => {
    if (corrigidos > 0) emitLibraryChanged()
  })

  const rodar = (): void => {
    if (!db().settings.cloudAutoSync) return
    void sync()
  }

  timer = setInterval(rodar, SYNC_INTERVAL_MS)
  rodar()
}

export function stopCloud(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // posicoes ainda na fila precisam sobreviver ao fechamento do app
  session.flushToDisk()
}
