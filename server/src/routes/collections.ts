import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import {
  collectionCreateSchema,
  collectionUpdateSchema,
  idListSchema,
  paginationSchema,
  parseJson,
  parseQuery,
} from '../lib/validation';
import * as collectionService from '../services/collection-service';
import * as fileService from '../services/file-service';
import * as bulkService from '../services/bulk-service';
import { ApiError } from '../lib/responses';
import type { AppContext } from '../types';

export const collectionRoutes = new Hono<AppContext>();

collectionRoutes.use('*', requireAuth());

collectionRoutes.get('/', async (c) => {
  const params = parseQuery(new URL(c.req.url), paginationSchema);
  return c.json(
    await collectionService.list(c.get('db'), c.get('user').id, params),
  );
});

collectionRoutes.post('/', async (c) => {
  const body = await parseJson(c.req.raw, collectionCreateSchema);
  const criada = await collectionService.create(
    c.get('db'),
    c.get('user').id,
    body,
  );
  return c.json(criada, 201);
});

collectionRoutes.get('/:id', async (c) =>
  c.json(
    await collectionService.getById(
      c.get('db'),
      c.get('user').id,
      c.req.param('id'),
    ),
  ),
);

collectionRoutes.patch('/:id', async (c) => {
  const body = await parseJson(c.req.raw, collectionUpdateSchema);
  return c.json(
    await collectionService.update(
      c.get('db'),
      c.get('user').id,
      c.req.param('id'),
      body,
    ),
  );
});

/**
 * Excluir coleção. Os arquivos continuam na biblioteca, a menos que
 * `?deleteFiles=true` seja informado explicitamente.
 */
collectionRoutes.delete('/:id', async (c) => {
  const url = new URL(c.req.url);
  const apagarArquivos = url.searchParams.get('deleteFiles') === 'true';
  const relatorio = await bulkService.deleteCollections(
    c.get('db'),
    c.env.FILES_BUCKET,
    c.get('user').id,
    [c.req.param('id')],
    apagarArquivos,
  );
  if (relatorio.failed > 0) {
    return c.json(relatorio, 404);
  }
  return c.json({ deleted: true, filesDeleted: apagarArquivos });
});

/** Arquivos da coleção, com paginação, busca e ordenação. */
collectionRoutes.get('/:id/files', async (c) => {
  const params = parseQuery(new URL(c.req.url), paginationSchema);
  const id = c.req.param('id');
  await collectionService.requireOwned(c.get('db'), c.get('user').id, id);
  return c.json(
    await fileService.list(c.get('db'), c.get('user').id, {
      ...params,
      collectionId: id,
    }),
  );
});

collectionRoutes.post('/:id/files', async (c) => {
  const body = await parseJson(c.req.raw, z.object({ fileIds: idListSchema }));
  return c.json(
    await collectionService.addFiles(
      c.get('db'),
      c.get('user').id,
      c.req.param('id'),
      body.fileIds,
    ),
  );
});

/** Define a capa da coleção a partir dos bytes enviados no corpo. */
collectionRoutes.put('/:id/cover', async (c) => {
  if (!c.req.raw.body) throw ApiError.badRequest('Corpo vazio.');
  const id = c.req.param('id');
  await collectionService.requireOwned(c.get('db'), c.get('user').id, id);
  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  const key = collectionService.coverKeyFor(id);
  await c.env.FILES_BUCKET.put(key, c.req.raw.body, {
    httpMetadata: { contentType },
  });
  await collectionService.setCover(c.get('db'), id, key);
  return c.json({ ok: true });
});

/** Remove a capa da coleção. */
collectionRoutes.delete('/:id/cover', async (c) => {
  const id = c.req.param('id');
  const registro = await collectionService.requireOwned(c.get('db'), c.get('user').id, id);
  if (registro.coverKey) await c.env.FILES_BUCKET.delete(registro.coverKey);
  await collectionService.setCover(c.get('db'), id, null);
  return c.body(null, 204);
});

/** Bytes da capa, direto do R2. */
collectionRoutes.get('/:id/cover', async (c) => {
  const id = c.req.param('id');
  const registro = await collectionService.requireOwned(c.get('db'), c.get('user').id, id);
  if (!registro.coverKey) throw ApiError.notFound('Esta coleção não tem capa.');
  const objeto = await c.env.FILES_BUCKET.get(registro.coverKey);
  if (!objeto) throw ApiError.notFound('Capa não encontrada no armazenamento.');
  return new Response(objeto.body, {
    headers: {
      'content-type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    },
  });
});

/** Remove o vínculo; o arquivo continua existindo. */
collectionRoutes.delete('/:id/files/:fileId', async (c) => {
  const removidos = await collectionService.removeFiles(
    c.get('db'),
    c.get('user').id,
    c.req.param('id'),
    [c.req.param('fileId')],
  );
  return c.json({ removed: removidos });
});
