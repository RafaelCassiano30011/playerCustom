import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, users } from '../db';
import { ApiError } from '../lib/responses';
import { verifyAccessToken } from '../lib/crypto';
import type { AppContext } from '../types';

/** Injeta o Drizzle no contexto. */
export const withDb = (): MiddlewareHandler<AppContext> => async (c, next) => {
  c.set('db', createDb(c.env.DB));
  await next();
};

/**
 * Exige um access token válido. A identidade vem SEMPRE do token —
 * nunca de um id enviado no corpo ou na query.
 */
export const requireAuth = (): MiddlewareHandler<AppContext> => async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const [tipo, token] = header.split(' ');
  if (tipo?.toLowerCase() !== 'bearer' || !token) {
    throw ApiError.unauthorized('Envie o header Authorization: Bearer <token>.');
  }

  const claims = await verifyAccessToken(token, c.env.JWT_SECRET);
  if (!claims) throw ApiError.unauthorized('Token inválido ou expirado.');

  // confirma que o usuário ainda existe (conta apagada invalida o token)
  const db = c.get('db');
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!user) throw ApiError.unauthorized('Usuário não encontrado.');

  c.set('user', user);
  await next();
};
