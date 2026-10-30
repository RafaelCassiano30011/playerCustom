import { cloudJson } from './api-client'
import { videoRepository } from '../repositories/video.repository'
import { markOpened } from './progress.service'
import type { RemoteStreamLink } from './dto'

/**
 * Streaming do video que vive no R2.
 *
 * O link e assinado e vale por horas, mas quem busca os bytes e o processo
 * principal, nao o renderer: o token fica fora da pagina, o `<video>` ve
 * apenas `media://cloud/<id>` e o seek continua funcionando porque o Range
 * do elemento e repassado inteiro para a Cloudflare.
 */

interface CachedLink {
  url: string
  /** Epoch em ms. */
  expiresAt: number
  mimeType: string
  sizeBytes: number
}

const cache = new Map<string, CachedLink>()

/** Renova um pouco antes do fim: um link que expira no meio do seek trava o player. */
const MARGEM_MS = 60_000

async function fetchLink(remoteId: string): Promise<CachedLink> {
  const link = await cloudJson<RemoteStreamLink>(`/api/v1/files/${remoteId}/stream`)
  const entrada: CachedLink = {
    url: link.url,
    expiresAt: link.expiresAt * 1000,
    mimeType: link.mimeType,
    sizeBytes: link.sizeBytes
  }
  cache.set(remoteId, entrada)

  // o servidor sabe a duracao antes do app: aproveita a ida
  const video = videoRepository.findByRemote(remoteId)
  if (video && link.durationSeconds && link.durationSeconds > video.duration) {
    videoRepository.update(video.id, { duration: link.durationSeconds })
  }

  // Pedir link e o momento em que o video e aberto de fato: e o que alimenta
  // o "Continuar assistindo" compartilhado com a TV.
  void markOpened(remoteId)

  return entrada
}

export async function signedLink(remoteId: string, forcar = false): Promise<CachedLink> {
  const atual = cache.get(remoteId)
  if (!forcar && atual && atual.expiresAt - MARGEM_MS > Date.now()) return atual
  return fetchLink(remoteId)
}

export function forgetLink(remoteId: string): void {
  cache.delete(remoteId)
}

/** Cabecalhos que o `<video>` precisa ver vindos do R2. */
const REPASSADOS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified'
]

function headersDe(origem: Response, fallbackType: string): Headers {
  const headers = new Headers()
  for (const nome of REPASSADOS) {
    const valor = origem.headers.get(nome)
    if (valor) headers.set(nome, valor)
  }
  if (!headers.has('content-type')) headers.set('content-type', fallbackType)
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes')
  return headers
}

/**
 * Busca os bytes na nuvem e devolve a resposta pronta para o protocolo
 * `media://`. Em 401/403 pede um link novo e tenta de novo uma vez — e o que
 * acontece quando o app ficou horas aberto e o token venceu.
 */
export async function proxyStream(
  remoteId: string,
  range: string | null,
  signal?: AbortSignal
): Promise<Response> {
  const buscar = async (link: CachedLink): Promise<Response> =>
    fetch(link.url, {
      headers: range ? { Range: range } : undefined,
      signal
    })

  let link = await signedLink(remoteId)
  let resposta = await buscar(link)

  if (resposta.status === 401 || resposta.status === 403) {
    link = await signedLink(remoteId, true)
    resposta = await buscar(link)
  }

  if (!resposta.ok && resposta.status !== 206) {
    return new Response(`Falha ao buscar o video na nuvem (${resposta.status}).`, {
      status: resposta.status === 404 ? 404 : 502
    })
  }

  return new Response(resposta.body, {
    status: resposta.status,
    headers: headersDe(resposta, link.mimeType)
  })
}
