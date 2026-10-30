import { Hono } from 'hono';
import { ApiError } from '../lib/responses';
import { verifyStreamToken } from '../lib/stream-token';
import * as fileService from '../services/file-service';
import type { AppContext } from '../types';

/**
 * Entrega dos bytes do vídeo por link assinado, SEM header de autorização —
 * é o que o ExoPlayer da TV consome. A autorização é o `?token=` emitido por
 * `GET /api/v1/files/:id/stream`; aqui não existe sessão nem usuário.
 */
export const streamRoutes = new Hono<AppContext>();

streamRoutes.get('/:fileId', async (c) => {
  const token = new URL(c.req.url).searchParams.get('token');
  if (!token) throw ApiError.unauthorized('Link sem token.');

  const claims = await verifyStreamToken(c.env.JWT_SECRET, token);
  if (!claims) throw ApiError.unauthorized('Link inválido ou expirado.');
  // o token vale para um arquivo só: trocar o id na URL não serve de nada
  if (claims.fileId !== c.req.param('fileId')) {
    throw ApiError.forbidden('Token não pertence a este vídeo.');
  }

  return fileService.streamContent(
    c.get('db'),
    c.env.FILES_BUCKET,
    claims.fileId,
    claims.fileId,
    c.req.header('Range'),
    c.req.header('If-None-Match'),
  );
});
