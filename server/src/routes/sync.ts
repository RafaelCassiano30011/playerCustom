import { Hono } from 'hono';
import { and, asc, eq, gt, or } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { collections, files } from '../db';
import * as progressService from '../services/progress-service';
import { parseQuery } from '../lib/validation';
import type { AppContext } from '../types';

/**
 * Sincronização entre aparelhos: o cliente guarda o `updatedAt` mais recente
 * que já viu e pede só o que mudou desde então. Como `deleting`/removidos
 * também aparecem, o cliente sabe o que apagar do cache local.
 */
export const syncRoutes = new Hono<AppContext>();

syncRoutes.use('*', requireAuth());

const syncQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

syncRoutes.get('/changes', async (c) => {
  const { since, limit } = parseQuery(new URL(c.req.url), syncQuery);
  const db = c.get('db');

  // Biblioteca compartilhada: o sync devolve as mudanças de todas as contas,
  // igual às listagens (ver `collection-service.requireOwned`). Filtrar por
  // dono aqui esconderia do desktop o que foi enviado pelo celular.
  const colecoes = await db
    .select()
    .from(collections)
    .where(gt(collections.updatedAt, since))
    .orderBy(asc(collections.updatedAt), asc(collections.id))
    .limit(limit);

  const arquivos = await db
    .select()
    .from(files)
    .where(
      and(
        gt(files.updatedAt, since),
        // 'pending' ainda não existe para o cliente
        or(eq(files.status, 'ready'), eq(files.status, 'deleting')),
      ),
    )
    .orderBy(asc(files.updatedAt), asc(files.id))
    .limit(limit);

  // o progresso é compartilhado (sem dono), então vai inteiro no mesmo sync
  const progresso = await progressService.changedSince(db, since, limit);

  const maiorData = Math.max(
    since,
    ...colecoes.map((x) => x.updatedAt),
    ...arquivos.map((x) => x.updatedAt),
    ...progresso.map((x) => Math.max(x.updatedAt, x.openedAt)),
  );

  return c.json({
    serverTime: Date.now(),
    cursor: maiorData,
    hasMore:
      colecoes.length === limit ||
      arquivos.length === limit ||
      progresso.length === limit,
    collections: colecoes.map((x) => ({
      id: x.id,
      name: x.name,
      description: x.description,
      updatedAt: x.updatedAt,
    })),
    files: arquivos.map((x) => ({
      id: x.id,
      originalName: x.originalName,
      format: x.format,
      sizeBytes: x.sizeBytes,
      status: x.status,
      updatedAt: x.updatedAt,
      // o cliente remove do cache local o que estiver 'deleting'
      deleted: x.status === 'deleting',
    })),
    progress: progresso,
  });
});
