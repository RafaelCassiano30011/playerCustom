import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { parseJson, parseQuery } from '../lib/validation';
import * as progressService from '../services/progress-service';
import type { AppContext } from '../types';

/**
 * Progresso de reprodução. É compartilhado entre as contas, igual ao acervo:
 * a chave é só o arquivo. O cliente guarda uma cópia local como cache
 * offline e manda a posição com `updatedAt` para o last-write-wins resolver
 * conflito entre aparelhos.
 */
export const progressRoutes = new Hono<AppContext>();

progressRoutes.use('*', requireAuth());

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
  sort: z.enum(['updatedAt', 'openedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const saveSchema = z
  .object({
    // 400 h de teto: barra absurdo sem atrapalhar arquivo longo de verdade
    positionSeconds: z.number().min(0).max(1_440_000).optional(),
    durationSeconds: z.number().min(0).max(1_440_000).optional(),
    fraction: z.number().min(0).max(1).optional(),
    audioTrack: z.string().max(100).nullable().optional(),
    subtitleTrack: z.string().max(100).nullable().optional(),
    playbackRate: z.number().min(0.25).max(4).optional(),
    completed: z.boolean().optional(),
    updatedAt: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Informe ao menos um campo.',
  });

progressRoutes.get('/', async (c) => {
  const params = parseQuery(new URL(c.req.url), listQuery);
  return c.json(await progressService.list(c.get('db'), params));
});

/** Último vídeo aberto — o "Continuar assistindo". */
progressRoutes.get('/last', async (c) => {
  const registro = await progressService.last(c.get('db'));
  return c.json({ progress: registro });
});

progressRoutes.get('/:fileId', async (c) =>
  c.json(await progressService.getById(c.get('db'), c.req.param('fileId'))),
);

progressRoutes.put('/:fileId', async (c) => {
  const body = await parseJson(c.req.raw, saveSchema);
  const { progress, applied } = await progressService.save(
    c.get('db'),
    c.req.param('fileId'),
    body,
  );
  // `applied: false` = a posição gravada é mais nova; o cliente deve adotá-la
  return c.json({ ...progress, applied });
});

progressRoutes.post('/:fileId/opened', async (c) =>
  c.json(await progressService.markOpened(c.get('db'), c.req.param('fileId'))),
);

progressRoutes.delete('/:fileId', async (c) => {
  await progressService.remove(c.get('db'), c.req.param('fileId'));
  return c.body(null, 204);
});
