import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

const ALLOWED_HEADERS =
  'Authorization, Content-Type, X-Requested-With, Range, If-None-Match, Idempotency-Key';
const EXPOSED_HEADERS =
  'Content-Range, Content-Length, ETag, Accept-Ranges, X-Request-Id';

export function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * CORS com lista explícita de origens. Nunca devolve `*` — endpoints
 * autenticados precisam de origem exata para `credentials` funcionar.
 */
export const cors = (): MiddlewareHandler<AppContext> => async (c, next) => {
  const origin = c.req.header('Origin');
  const permitidas = new Set([
    ...parseOrigins(c.env.CORS_ORIGINS ?? ''),
    c.env.APP_ORIGIN,
  ]);
  const liberada = origin && permitidas.has(origin) ? origin : null;

  if (c.req.method === 'OPTIONS') {
    if (!liberada) {
      // preflight de origem desconhecida: nega sem vazar a lista
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': liberada,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }

  await next();

  if (liberada) {
    c.res.headers.set('Access-Control-Allow-Origin', liberada);
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    c.res.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  }
  c.res.headers.append('Vary', 'Origin');
};
