import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import {
  fileUpdateSchema,
  formatSchema,
  idSchema,
  paginationSchema,
  parseJson,
  parseQuery,
} from '../lib/validation';
import { ApiError } from '../lib/responses';
import { signStreamToken } from '../lib/stream-token';
import * as fileService from '../services/file-service';
import * as uploadService from '../services/upload-service';
import type { AppContext } from '../types';

export const fileRoutes = new Hono<AppContext>();

fileRoutes.use('*', requireAuth());

const listQuery = paginationSchema.extend({
  collectionId: idSchema.optional(),
  format: formatSchema.optional(),
});

fileRoutes.get('/', async (c) => {
  const params = parseQuery(new URL(c.req.url), listQuery);
  return c.json(await fileService.list(c.get('db'), c.get('user').id, params));
});

/* ---------------- upload ---------------- */

const initSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().max(200).optional(),
  collectionId: idSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Passo 1: autoriza o upload e devolve a estratégia (single ou multipart). */
fileRoutes.post('/uploads', async (c) => {
  const body = await parseJson(c.req.raw, initSchema);
  const resultado = await uploadService.init(
    c.get('db'),
    c.env,
    c.get('user').id,
    body,
  );
  return c.json(resultado, 201);
});

/** Passo 2 (single): corpo cru enviado direto ao R2 em streaming. */
fileRoutes.put('/uploads/:uploadId/content', async (c) => {
  if (!c.req.raw.body) throw ApiError.badRequest('Corpo vazio.');
  const tamanho = Number(c.req.header('Content-Length') ?? '0');
  const resultado = await uploadService.uploadSingle(
    c.get('db'),
    c.env,
    c.get('user').id,
    c.req.param('uploadId'),
    c.req.raw.body,
    Number.isFinite(tamanho) ? tamanho : undefined,
  );
  return c.json(resultado);
});

/** Passo 2 (multipart): envia uma parte. */
fileRoutes.put('/uploads/:uploadId/parts/:partNumber', async (c) => {
  if (!c.req.raw.body) throw ApiError.badRequest('Corpo vazio.');
  const parte = Number(c.req.param('partNumber'));
  if (!Number.isInteger(parte)) {
    throw ApiError.badRequest('Número da parte inválido.');
  }
  return c.json(
    await uploadService.uploadPart(
      c.get('db'),
      c.env,
      c.get('user').id,
      c.req.param('uploadId'),
      parte,
      c.req.raw.body,
    ),
  );
});

/** Passo 3: confirma (idempotente) e libera o arquivo. */
fileRoutes.post('/uploads/:uploadId/complete', async (c) =>
  c.json(
    await uploadService.complete(
      c.get('db'),
      c.env,
      c.get('user').id,
      c.req.param('uploadId'),
    ),
  ),
);

fileRoutes.post('/uploads/:uploadId/abort', async (c) => {
  await uploadService.abort(
    c.get('db'),
    c.env,
    c.get('user').id,
    c.req.param('uploadId'),
  );
  return c.body(null, 204);
});

/* ---------------- capa ---------------- */

/**
 * Mantem no R2 as capas que antes iam em base64 dentro de `metadata`.
 * Rode ate `restantes` chegar a zero.
 */
fileRoutes.post('/cover-migration', async (c) => {
  const pedido = Number(new URL(c.req.url).searchParams.get('limit') ?? '3');
  const limite = Number.isFinite(pedido) ? Math.min(10, Math.max(1, pedido)) : 3;
  return c.json(
    await fileService.migrateLegacyCovers(
      c.get('db'),
      c.env.FILES_BUCKET,
      limite,
    ),
  );
});

/* ---------------- arquivo ---------------- */

fileRoutes.get('/:id', async (c) =>
  c.json(
    await fileService.getById(c.get('db'), c.get('user').id, c.req.param('id')),
  ),
);

fileRoutes.patch('/:id', async (c) => {
  const body = await parseJson(c.req.raw, fileUpdateSchema);
  return c.json(
    await fileService.update(
      c.get('db'),
      c.env.FILES_BUCKET,
      c.get('user').id,
      c.req.param('id'),
      body,
    ),
  );
});

fileRoutes.delete('/:id', async (c) => {
  await fileService.remove(
    c.get('db'),
    c.env.FILES_BUCKET,
    c.get('user').id,
    c.req.param('id'),
  );
  return c.body(null, 204);
});

/**
 * Link assinado para a TV tocar o vídeo. O player recebe uma URL que já
 * carrega a autorização, então não precisa mandar header em cada Range.
 */
fileRoutes.get('/:id/stream', async (c) => {
  const row = await fileService.getById(
    c.get('db'),
    c.get('user').id,
    c.req.param('id'),
  );
  const ttlBruto = Number(c.env.STREAM_TOKEN_TTL_SECONDS);
  const ttl = Number.isFinite(ttlBruto) && ttlBruto > 0 ? ttlBruto : 21_600;
  const { token, expiresAt } = await signStreamToken(
    c.env.JWT_SECRET,
    row.id,
    ttl,
  );
  const base = new URL(c.req.url).origin;
  return c.json({
    url: `${base}/stream/${row.id}?token=${token}`,
    expiresAt,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds ?? null,
  });
});

/** Download autorizado, com suporte a Range (seek dentro do vídeo). */
fileRoutes.get('/:id/content', async (c) =>
  fileService.streamContent(
    c.get('db'),
    c.env.FILES_BUCKET,
    c.get('user').id,
    c.req.param('id'),
    c.req.header('Range'),
    c.req.header('If-None-Match'),
  ),
);

/** Define a capa do arquivo a partir dos bytes enviados no corpo. */
fileRoutes.put('/:id/cover', async (c) => {
  if (!c.req.raw.body) throw ApiError.badRequest('Corpo vazio.');
  await fileService.setCoverFromStream(
    c.get('db'),
    c.env.FILES_BUCKET,
    c.get('user').id,
    c.req.param('id'),
    c.req.raw.body,
    c.req.header('content-type') ?? 'application/octet-stream',
  );
  return c.json({ ok: true });
});

/** Bytes da capa, direto do R2. */
fileRoutes.get('/:id/cover', async (c) =>
  fileService.streamCover(
    c.get('db'),
    c.env.FILES_BUCKET,
    c.get('user').id,
    c.req.param('id'),
  ),
);

fileRoutes.delete('/:id/cover', async (c) => {
  await fileService.removeCover(
    c.get('db'),
    c.env.FILES_BUCKET,
    c.get('user').id,
    c.req.param('id'),
  );
  return c.body(null, 204);
});

fileRoutes.get('/:id/verify', async (c) =>
  c.json(
    await fileService.verifyIntegrity(
      c.get('db'),
      c.env.FILES_BUCKET,
      c.get('user').id,
      c.req.param('id'),
    ),
  ),
);
