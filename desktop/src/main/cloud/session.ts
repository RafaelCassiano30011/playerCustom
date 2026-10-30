import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { JsonStore } from '../storage/json-store'

/**
 * Sessao da nuvem, fora do `library.json`.
 *
 * Separada de proposito: a biblioteca e dado de aplicacao e vai inteira para
 * o renderer em varias chamadas; os tokens nao podem seguir nesse caminho.
 * Os dois tokens sao gravados com `safeStorage` (DPAPI no Windows, Keychain no
 * macOS) quando o sistema oferece criptografia, e em texto quando nao — nesse
 * caso o arquivo fica dentro do `userData` do app, que e o melhor disponivel.
 */

export interface PendingProgress {
  remoteId: string
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  /** Quando o cliente registrou a posicao; decide o last-write-wins. */
  updatedAt: number
}

interface SessionShape {
  version: number
  email: string | null
  /** Tokens, possivelmente criptografados (ver `encrypted`). */
  accessToken: string | null
  refreshToken: string | null
  encrypted: boolean
  /** Epoch em ms em que o access token expira. */
  accessExpiresAt: number
  /** `cursor` do ultimo /sync/changes aplicado. */
  syncCursor: number
  lastSyncAt: number | null
  queue: PendingProgress[]
}

const EMPTY: SessionShape = {
  version: 1,
  email: null,
  accessToken: null,
  refreshToken: null,
  encrypted: false,
  accessExpiresAt: 0,
  syncCursor: 0,
  lastSyncAt: null,
  queue: []
}

let store: JsonStore<SessionShape> | null = null

function migrate(raw: unknown): SessionShape {
  const source = (raw ?? {}) as Partial<SessionShape>
  return {
    ...EMPTY,
    ...source,
    queue: Array.isArray(source.queue) ? source.queue : []
  }
}

function state(): SessionShape {
  if (!store) {
    store = new JsonStore<SessionShape>({
      file: join(app.getPath('userData'), 'cloud-session.json'),
      defaults: EMPTY,
      debounceMs: 200,
      migrate
    })
  }
  return store.state
}

function update<R>(mutator: (s: SessionShape) => R): R {
  state()
  return store!.update(mutator)
}

function protect(value: string): { value: string; encrypted: boolean } {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { value: safeStorage.encryptString(value).toString('base64'), encrypted: true }
    }
  } catch {
    // sistema sem chaveiro disponivel: cai para texto
  }
  return { value, encrypted: false }
}

function reveal(value: string | null, encrypted: boolean): string | null {
  if (!value) return null
  if (!encrypted) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    // chaveiro trocou (outro usuario/maquina): forca novo login
    return null
  }
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  /** Segundos de validade do access token. */
  expiresIn: number
}

export const session = {
  get email(): string | null {
    return state().email
  },

  get syncCursor(): number {
    return state().syncCursor
  },

  get lastSyncAt(): number | null {
    return state().lastSyncAt
  },

  /** Ha credencial gravada (ainda que o access token tenha expirado). */
  get signedIn(): boolean {
    return reveal(state().refreshToken, state().encrypted) !== null
  },

  get accessToken(): string | null {
    const s = state()
    if (s.accessExpiresAt <= Date.now()) return null
    return reveal(s.accessToken, s.encrypted)
  },

  get refreshToken(): string | null {
    return reveal(state().refreshToken, state().encrypted)
  },

  save(email: string, tokens: TokenPair): void {
    const access = protect(tokens.accessToken)
    const refresh = protect(tokens.refreshToken)
    update((s) => {
      s.email = email
      s.accessToken = access.value
      s.refreshToken = refresh.value
      s.encrypted = access.encrypted && refresh.encrypted
      // 30 s de folga: evita usar um token que expira no meio da requisicao
      s.accessExpiresAt = Date.now() + Math.max(0, tokens.expiresIn - 30) * 1000
    })
  },

  clear(): void {
    update((s) => {
      s.email = null
      s.accessToken = null
      s.refreshToken = null
      s.accessExpiresAt = 0
      s.syncCursor = 0
      s.lastSyncAt = null
      s.queue = []
    })
  },

  setSyncCursor(cursor: number): void {
    update((s) => {
      s.syncCursor = Math.max(s.syncCursor, cursor)
      s.lastSyncAt = Date.now()
    })
  },

  /* ---------- fila de progresso ---------- */

  get queue(): PendingProgress[] {
    return state().queue.map((item) => ({ ...item }))
  },

  get queueSize(): number {
    return state().queue.length
  },

  /**
   * Enfileira uma posicao. Uma linha por video: a posicao mais nova substitui
   * a anterior, porque o servidor so guarda a ultima mesmo — acumular todas
   * encheria a fila numa sessao longa sem offline nenhum.
   */
  enqueue(item: PendingProgress): void {
    update((s) => {
      const atual = s.queue.find((q) => q.remoteId === item.remoteId)
      if (atual) {
        if (item.updatedAt < atual.updatedAt) return
        Object.assign(atual, item)
        return
      }
      s.queue.push(item)
    })
  },

  /** Remove da fila o que foi aceito pelo servidor. */
  dequeue(remoteIds: string[]): void {
    const alvo = new Set(remoteIds)
    update((s) => {
      s.queue = s.queue.filter((q) => !alvo.has(q.remoteId))
    })
  },

  flushToDisk(): void {
    store?.flush()
  },

  dispose(): void {
    store?.dispose()
    store = null
  }
}
