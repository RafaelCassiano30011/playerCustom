/**
 * Senhas: PBKDF2-SHA256 via WebCrypto (disponível no runtime do Workers).
 * Tokens: JWT assinado com HS256 pela biblioteca `jose`.
 * Nada aqui é criptografia caseira — só o uso das primitivas padrão.
 */
import { SignJWT, jwtVerify } from 'jose';

// Workers runtime (produção) rejeita acima de 100k; miniflare local deixa passar mais.
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;

const encoder = new TextEncoder();

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  return randomId(bytes);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPassword(
  password: string,
  salt = randomId(16),
): Promise<{ hash: string; salt: string }> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    KEY_LENGTH_BITS,
  );
  return { hash: toHex(bits), salt };
}

/** Comparação em tempo constante para não vazar informação por timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, expectedHash);
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
