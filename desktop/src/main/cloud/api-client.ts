import { settingsRepository } from '../repositories/settings.repository'
import { session } from './session'
import type { TokenPair } from './session'

/**
 * Cliente da API na nuvem.
 *
 * Tres responsabilidades, e nenhuma vaza para o resto do app:
 * 1. anexar o access token e renova-lo quando expira (uma tentativa so, com
 *    as chamadas concorrentes compartilhando a mesma renovacao);
 * 2. distinguir "o servidor recusou" (`CloudError`) de "nao deu para falar
 *    com o servidor" (`OfflineError`) — o segundo manda o app para o modo
 *    offline em vez de mostrar erro;
 * 3. guardar o estado de conectividade que o renderer exibe.
 */

export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

export class OfflineError extends Error {
  constructor(readonly cause: unknown) {
    super('Sem conexao com o servidor.')
    this.name = 'OfflineError'
  }
}

let online = true
let lastError: string | null = null

export function connectivity(): { online: boolean; lastError: string | null } {
  return { online, lastError }
}

function markOnline(): void {
  online = true
  lastError = null
}

function markOffline(error: unknown): void {
  online = false
  lastError = error instanceof Error ? error.message : String(error)
}

export function apiBaseUrl(): string {
  return settingsRepository.get().cloudApiBaseUrl.replace(/\/+$/, '')
}

function urlFor(path: string): string {
  if (path.startsWith('http')) return path
  const base = apiBaseUrl()
  if (!base) throw new CloudError(0, 'no_base_url', 'Configure o endereco da API na nuvem.')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** Timeout proprio: `fetch` sem isso fica pendurado em rede ruim. */
const TIMEOUT_MS = 30_000

async function rawFetch(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(urlFor(path), { ...init, signal: init.signal ?? controller.signal })
    markOnline()
    return response
  } catch (error) {
    markOffline(error)
    throw new OfflineError(error)
  } finally {
    clearTimeout(timer)
  }
}

async function failure(response: Response): Promise<CloudError> {
  let code = `http_${response.status}`
  let message = `O servidor respondeu ${response.status}.`
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
  } catch {
    // resposta sem JSON: fica a mensagem generica
  }
  return new CloudError(response.status, code, message)
}

/** Renovacao em voo, compartilhada entre chamadas concorrentes. */
let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = session.refreshToken
  if (!refreshToken) return null

  const response = await rawFetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  })

  if (!response.ok) {
    // refresh invalido/revogado: a sessao morreu, exige novo login
    if (response.status === 401 || response.status === 404) session.clear()
    throw await failure(response)
  }

  const tokens = (await response.json()) as TokenPair & { user?: { email?: string } }
  session.save(tokens.user?.email ?? session.email ?? '', tokens)
  return tokens.accessToken
}

async function accessTokenOrRefresh(): Promise<string> {
  const current = session.accessToken
  if (current) return current

  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null
  })
  const renewed = await refreshing
  if (!renewed) throw new CloudError(401, 'signed_out', 'Entre na sua conta da nuvem.')
  return renewed
}

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Corpo cru (upload): passa direto, sem JSON.stringify. */
  raw?: Uint8Array | string
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Chamada autenticada. Em 401 renova o token e repete UMA vez — util quando o
 * access token expirou entre duas requisicoes (o caso comum de um app aberto
 * por horas).
 */
export async function cloudFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const enviar = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
    let body = options.raw
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    return rawFetch(
      path,
      { method: options.method ?? 'GET', headers, body, signal: options.signal },
      options.timeoutMs
    )
  }

  let response = await enviar(await accessTokenOrRefresh())
  if (response.status === 401) {
    const renewed = await refreshAccessToken()
    if (!renewed) throw new CloudError(401, 'signed_out', 'Entre na sua conta da nuvem.')
    response = await enviar(renewed)
  }
  return response
}

/** Igual a `cloudFetch`, ja com o JSON desembrulhado e erro tipado. */
export async function cloudJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await cloudFetch(path, options)
  if (!response.ok) throw await failure(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/* ---------- autenticacao ---------- */

interface AuthResponse extends TokenPair {
  user: { id: string; email: string }
}

async function authenticate(path: string, email: string, password: string): Promise<void> {
  const response = await rawFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!response.ok) throw await failure(response)
  const data = (await response.json()) as AuthResponse
  session.save(data.user.email, data)
}

export interface CodeRequest {
  /** Segundos antes de o servidor aceitar outro pedido para o mesmo e-mail. */
  retryAfter: number
  /** Validade do codigo, em segundos. */
  expiresIn: number
}

/**
 * Pede o codigo de acesso. A resposta e a mesma para e-mail conhecido ou
 * desconhecido, de proposito: quem usa o app nao descobre nada que ja nao
 * saiba, e quem tenta adivinhar enderecos tambem nao.
 */
export async function requestCode(email: string): Promise<CodeRequest> {
  const response = await rawFetch('/api/v1/auth/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  if (!response.ok) throw await failure(response)
  return (await response.json()) as CodeRequest
}

export async function loginWithCode(email: string, code: string): Promise<void> {
  const response = await rawFetch('/api/v1/auth/code/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code })
  })
  if (!response.ok) throw await failure(response)
  const data = (await response.json()) as AuthResponse
  session.save(data.user.email, data)
}

export function login(email: string, password: string): Promise<void> {
  return authenticate('/api/v1/auth/login', email, password)
}

export function register(email: string, password: string): Promise<void> {
  return authenticate('/api/v1/auth/register', email, password)
}

export async function logout(): Promise<void> {
  const refreshToken = session.refreshToken
  if (refreshToken) {
    try {
      await rawFetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      })
    } catch {
      // offline: a sessao local sai de qualquer forma
    }
  }
  session.clear()
}
