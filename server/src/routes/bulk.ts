import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { idListSchema, idSchema, parseJson } from '../lib/validation';
import * as bulkService from '../services/bulk-service';
import type { AppContext } from '../types';

/**
 * Operações em massa — uma requisição para N itens.
 * Toda resposta traz o relatório item a item (quem passou, quem falhou e por quê).
 */
export const bulkRoutes = new Hono<AppContext>();

bulkRoutes.use('*', requireAuth());

bulkRoutes.post('/files/bulk/move', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({
      fileIds: idListSchema,
      toCollectionId: idSchema,
      fromCollectionId: idSchema.optional(),
    }),
  );
  return c.json(
    await bulkService.moveFiles(
      c.get('db'),
      c.get('user').id,
      body.fileIds,
      body.toCollectionId,
      body.fromCollectionId,
    ),
  );
});

bulkRoutes.post('/files/bulk/add-to-collection', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({ fileIds: idListSchema, collectionId: idSchema }),
  );
  return c.json(
    await bulkService.addFilesToCollection(
      c.get('db'),
      c.get('user').id,
      body.fileIds,
      body.collectionId,
    ),
  );
});

bulkRoutes.post('/files/bulk/remove-from-collection', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({ fileIds: idListSchema, collectionId: idSchema }),
  );
  return c.json(
    await bulkService.removeFilesFromCollection(
      c.get('db'),
      c.get('user').id,
      body.fileIds,
      body.collectionId,
    ),
  );
});

/** Exclusão definitiva: exige `confirm: true` vindo do cliente. */
bulkRoutes.post('/files/bulk/delete', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({ fileIds: idListSchema, confirm: z.literal(true) }),
  );
  return c.json(
    await bulkService.deleteFiles(
      c.get('db'),
      c.env.FILES_BUCKET,
      c.get('user').id,
      body.fileIds,
    ),
  );
});

bulkRoutes.post('/files/bulk/update', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({
      items: z
        .array(
          z.object({
            id: idSchema,
            originalName: z.string().trim().min(1).max(300).optional(),
            metadata: z.record(z.unknown()).nullable().optional(),
          }),
        )
        .min(1)
        .max(500),
    }),
  );
  return c.json(
    await bulkService.updateFilesMetadata(
      c.get('db'),
      c.get('user').id,
      body.items,
    ),
  );
});

bulkRoutes.post('/collections/bulk/delete', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({
      collectionIds: idListSchema,
      confirm: z.literal(true),
      /** apaga também os arquivos que ficariam sem nenhuma coleção */
      deleteFiles: z.boolean().default(false),
    }),
  );
  return c.json(
    await bulkService.deleteCollections(
      c.get('db'),
      c.env.FILES_BUCKET,
      c.get('user').id,
      body.collectionIds,
      body.deleteFiles,
    ),
  );
});

/** Consulta o relatório de uma operação já executada. */
bulkRoutes.get('/operations/:id', async (c) =>
  c.json(
    await bulkService.getOperation(
      c.get('db'),
      c.get('user').id,
      c.req.param('id'),
    ),
  ),
);
