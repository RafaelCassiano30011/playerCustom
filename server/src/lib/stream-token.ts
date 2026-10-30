/**
 * Link assinado de streaming.
 *
 * A TV não manda header `Authorization` em cada requisição de Range do
 * ExoPlayer, então a autorização vai na URL: o cliente pede o link com o
 * access token e recebe um `?token=` curto, assinado com HMAC-SHA256 sobre
 * `fileId.expiraEm`. O token vale para UM arquivo e expira — vazar o link
 * libera só aquele vídeo, por pouco tempo.
 */
import { timingSafeEqual } from './crypto';

const encoder = new TextEncoder();

export interface StreamClaims {
  fileId: string;
  /** epoch em segundos */
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, mensagem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(mensagem),
  );
  return base64UrlEncode(new Uint8Array(assinatura));
}

export async function signStreamToken(
  secret: string,
  fileId: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const corpo = `${fileId}.${exp}`;
  return { token: `${corpo}.${await hmac(secret, corpo)}`, expiresAt: exp };
}

/**
 * Devolve as claims ou `null`. Confere a assinatura ANTES da validade e
 * compara em tempo constante — um token inválido e um expirado não se
 * distinguem pelo tempo de resposta.
 */
export async function verifyStreamToken(
  secret: string,
  token: string,
): Promise<StreamClaims | null> {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [fileId, expRaw, assinatura] = partes;
  if (!fileId || !expRaw || !assinatura) return null;

  const esperada = await hmac(secret, `${fileId}.${expRaw}`);
  if (!timingSafeEqual(assinatura, esperada)) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;

  return { fileId, exp };
}
