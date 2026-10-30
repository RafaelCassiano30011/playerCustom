import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/responses';
import type { AppContext } from '../types';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Limitador simples por isolate. Serve para conter força bruta em login e
 * cadastro; não é um limite global exato entre todos os isolates da borda.
 * Para limite forte e distribuído, troque por Durable Objects ou KV.
 */
const buckets = new Map<string, Bucket>();

/** Zera os contadores. Usado pelos testes para isolar cada caso. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimit(
  opts: { limit: number; windowSeconds: number; name: string },
): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const ip =
      c.req.header('CF-Connecting-IP') ??
      c.req.header('X-Forwarded-For') ??
      'desconhecido';
    const chave = `${opts.name}:${ip}`;
    const agora = Date.now();

    const atual = buckets.get(chave);
    if (!atual || atual.resetAt <= agora) {
      buckets.set(chave, {
        count: 1,
        resetAt: agora + opts.windowSeconds * 1000,
      });
    } else {
      atual.count += 1;
      if (atual.count > opts.limit) {
        const faltam = Math.ceil((atual.resetAt - agora) / 1000);
        c.header('Retry-After', String(faltam));
        throw ApiError.tooManyRequests(
          `Limite de ${opts.limit} requisições atingido. Tente em ${faltam}s.`,
        );
      }
    }

    // evita o mapa crescer sem limite
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= agora) buckets.delete(k);
    }

    await next();
  };
}
