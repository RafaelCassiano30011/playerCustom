import type { Context, MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { ApiError, type ApiErrorBody } from '../lib/responses';
import { randomId } from '../lib/crypto';
import type { AppContext } from '../types';

/** Marca cada requisição com um id — aparece nos logs e na resposta de erro. */
export const requestId = (): MiddlewareHandler<AppContext> => async (c, next) => {
  const id = c.req.header('X-Request-Id') ?? randomId(8);
  c.set('requestId', id);
  await next();
  c.res.headers.set('X-Request-Id', id);
};

/**
 * Converte qualquer exceção numa resposta JSON padronizada.
 * Detalhes internos nunca vazam para o cliente; vão só para o log.
 */
export function handleError(err: unknown, c: Context<AppContext>): Response {
  const id = c.get('requestId');

  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
      requestId: id,
    };
    return Response.json(body, { status: err.status });
  }

  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'bad_request',
        message: 'Dados inválidos.',
        details: err.flatten(),
      },
      requestId: id,
    };
    return Response.json(body, { status: 400 });
  }

  // só o servidor vê a causa real
  console.error('[erro-nao-tratado]', id, err instanceof Error ? err.stack : err);
  const body: ApiErrorBody = {
    error: { code: 'internal_error', message: 'Erro interno.' },
    requestId: id,
  };
  return Response.json(body, { status: 500 });
}
