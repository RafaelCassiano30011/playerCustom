import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db';
import {
  bulkOperations,
  collectionFiles,
  collections,
  files,
  pendingDeletions,
} from '../db';
import { ApiError } from '../lib/responses';
import { randomId } from '../lib/crypto';
import { chunk } from '../lib/chunk';
import { finalizeDeletion, splitCover } from './file-service';
import type { BulkItemResult, BulkReport } from '../types';

// D1 aceita no máximo ~100 variáveis bindadas por statement. Um IN(...) com
// mais de ~90 ids (+ outras condições na mesma query) ou um INSERT multi-
// linha com mais de ~20 linhas (a 4 colunas cada) passa desse limite e o D1
// derruba a requisição com "too many SQL variables" — por isso tudo que
// recebe uma lista de tamanho arbitrário do cliente precisa ser quebrado.
const IDS_PER_QUERY = 90;
const ROWS_PER_INSERT = 20;

/** Separa os ids que existem dos que não existem. Biblioteca compartilhada — não filtra por dono. */
async function partitionOwnedFiles(
  db: Database,
  _userId: string,
  fileIds: string[],
): Promise<{ owned: Set<string>; results: BulkItemResult[] }> {
  const owned = new Set<string>();
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const linhas = await db
      .select({ id: files.id })
      .from(files)
      .where(inArray(files.id, parte));
    for (const l of linhas) owned.add(l.id);
  }

  const results: BulkItemResult[] = [];
  for (const id of fileIds) {
    if (!owned.has(id)) {
      results.push({
        id,
        ok: false,
        error: 'Arquivo não encontrado ou sem permissão.',
      });
    }
  }
  return { owned, results };
}

/** Insere vínculos arquivo↔coleção em lotes, pra não estourar o limite de variáveis do D1. */
async function insertCollectionFilesChunked(
  db: Database,
  rows: { collectionId: string; fileId: string; position: number; addedAt: number }[],
): Promise<void> {
  for (const lote of chunk(rows, ROWS_PER_INSERT)) {
    await db.insert(collectionFiles).values(lote);
  }
}

/** `inArray(collectionFiles.fileId, ids)` em lotes (ids pode ter tamanho arbitrário). */
async function selectExistingLinksChunked(
  db: Database,
  collectionId: string,
  fileIds: string[],
): Promise<Set<string>> {
  const existentes = new Set<string>();
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const jaLa = await db
      .select({ fileId: collectionFiles.fileId })
      .from(collectionFiles)
      .where(
        and(
          eq(collectionFiles.collectionId, collectionId),
          inArray(collectionFiles.fileId, parte),
        ),
      );
    for (const v of jaLa) existentes.add(v.fileId);
  }
  return existentes;
}

async function deleteCollectionFilesChunked(
  db: Database,
  fileIds: string[],
  collectionId?: string,
): Promise<void> {
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    await db
      .delete(collectionFiles)
      .where(
        collectionId
          ? and(
              eq(collectionFiles.collectionId, collectionId),
              inArray(collectionFiles.fileId, parte),
            )
          : inArray(collectionFiles.fileId, parte),
      );
  }
}

/** Biblioteca compartilhada — não filtra por dono, só confirma que a coleção existe. */
async function requireOwnedCollection(
  db: Database,
  _userId: string,
  collectionId: string,
) {
  const [col] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1);
  if (!col) throw ApiError.notFound('Coleção não encontrada.');
  return col;
}

async function registrar(
  db: Database,
  userId: string,
  type: string,
  results: BulkItemResult[],
): Promise<BulkReport> {
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const id = randomId();
  const agora = Date.now();

  await db.insert(bulkOperations).values({
    id,
    userId,
    type,
    status: 'completed',
    total: results.length,
    succeeded,
    failed,
    report: JSON.stringify(results),
    createdAt: agora,
    updatedAt: agora,
  });

  return { operationId: id, total: results.length, succeeded, failed, results };
}

/**
 * Move arquivos: tira de todas as coleções atuais e põe na coleção destino.
 * Com `fromCollectionId`, sai apenas daquela coleção.
 */
export async function moveFiles(
  db: Database,
  userId: string,
  fileIds: string[],
  toCollectionId: string,
  fromCollectionId?: string,
): Promise<BulkReport> {
  await requireOwnedCollection(db, userId, toCollectionId);
  if (fromCollectionId) {
    await requireOwnedCollection(db, userId, fromCollectionId);
  }

  const { owned, results } = await partitionOwnedFiles(db, userId, fileIds);
  const validos = fileIds.filter((id) => owned.has(id));
  const agora = Date.now();

  if (validos.length > 0) {
    await deleteCollectionFilesChunked(db, validos, fromCollectionId);

    // regrava os vínculos no destino sem duplicar
    const existentes = await selectExistingLinksChunked(db, toCollectionId, validos);
    const inserir = validos.filter((id) => !existentes.has(id));

    if (inserir.length > 0) {
      await insertCollectionFilesChunked(
        db,
        inserir.map((fileId, i) => ({
          collectionId: toCollectionId,
          fileId,
          position: agora + i,
          addedAt: agora,
        })),
      );
    }
    await db
      .update(collections)
      .set({ updatedAt: agora })
      .where(eq(collections.id, toCollectionId));

    for (const id of validos) results.push({ id, ok: true });
  }

  return registrar(db, userId, 'files.move', results);
}

export async function addFilesToCollection(
  db: Database,
  userId: string,
  fileIds: string[],
  collectionId: string,
): Promise<BulkReport> {
  await requireOwnedCollection(db, userId, collectionId);
  const { owned, results } = await partitionOwnedFiles(db, userId, fileIds);
  const validos = fileIds.filter((id) => owned.has(id));
  const agora = Date.now();

  if (validos.length > 0) {
    const existentes = await selectExistingLinksChunked(db, collectionId, validos);
    const inserir = validos.filter((id) => !existentes.has(id));

    if (inserir.length > 0) {
      await insertCollectionFilesChunked(
        db,
        inserir.map((fileId, i) => ({
          collectionId,
          fileId,
          position: agora + i,
          addedAt: agora,
        })),
      );
      await db
        .update(collections)
        .set({ updatedAt: agora })
        .where(eq(collections.id, collectionId));
    }
    // já estar na coleção conta como sucesso (operação idempotente)
    for (const id of validos) results.push({ id, ok: true });
  }

  return registrar(db, userId, 'files.add_to_collection', results);
}

export async function removeFilesFromCollection(
  db: Database,
  userId: string,
  fileIds: string[],
  collectionId: string,
): Promise<BulkReport> {
  await requireOwnedCollection(db, userId, collectionId);
  const { owned, results } = await partitionOwnedFiles(db, userId, fileIds);
  const validos = fileIds.filter((id) => owned.has(id));

  if (validos.length > 0) {
    await deleteCollectionFilesChunked(db, validos, collectionId);
    await db
      .update(collections)
      .set({ updatedAt: Date.now() })
      .where(eq(collections.id, collectionId));
    for (const id of validos) results.push({ id, ok: true });
  }

  return registrar(db, userId, 'files.remove_from_collection', results);
}

/**
 * Exclui arquivos de verdade (registro + objeto no R2), em etapas seguras:
 * marca como `deleting`, enfileira a chave e tenta apagar. O que falhar no R2
 * fica na fila para o cron tentar de novo.
 */
export async function deleteFiles(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileIds: string[],
): Promise<BulkReport> {
  const porId = new Map<string, string>();
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const linhas = await db
      .select({ id: files.id, r2Key: files.r2Key })
      .from(files)
      .where(inArray(files.id, parte));
    for (const l of linhas) porId.set(l.id, l.r2Key);
  }

  const results: BulkItemResult[] = [];
  const agora = Date.now();

  for (const id of fileIds) {
    const r2Key = porId.get(id);
    if (!r2Key) {
      results.push({
        id,
        ok: false,
        error: 'Arquivo não encontrado ou sem permissão.',
      });
      continue;
    }
    await db
      .update(files)
      .set({ status: 'deleting', updatedAt: agora })
      .where(eq(files.id, id));
    await db
      .insert(pendingDeletions)
      .values({ r2Key, attempts: 0, createdAt: agora })
      .onConflictDoNothing();
  }

  for (const [id, r2Key] of porId) {
    const ok = await finalizeDeletion(db, bucket, r2Key, id);
    results.push(
      ok
        ? { id, ok: true }
        : {
            id,
            ok: false,
            error: 'Registro removido da listagem; limpeza do objeto pendente.',
          },
    );
  }

  return registrar(db, userId, 'files.delete', results);
}

/**
 * Exclui coleções. Por padrão os arquivos ficam na biblioteca.
 * Com `deleteFiles`, os arquivos também são excluídos — o cliente precisa
 * pedir isso explicitamente.
 */
export async function deleteCollections(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  collectionIds: string[],
  alsoDeleteFiles = false,
): Promise<BulkReport> {
  const existentes = new Set<string>();
  for (const parte of chunk(collectionIds, IDS_PER_QUERY)) {
    const linhas = await db
      .select({ id: collections.id })
      .from(collections)
      .where(inArray(collections.id, parte));
    for (const l of linhas) existentes.add(l.id);
  }

  const results: BulkItemResult[] = [];
  const paraExcluir: string[] = [];

  for (const id of collectionIds) {
    if (!existentes.has(id)) {
      results.push({
        id,
        ok: false,
        error: 'Coleção não encontrada ou sem permissão.',
      });
      continue;
    }
    paraExcluir.push(id);
  }

  if (paraExcluir.length > 0) {
    let arquivosAfetados: string[] = [];
    if (alsoDeleteFiles) {
      const vistos = new Set<string>();
      for (const parte of chunk(paraExcluir, IDS_PER_QUERY)) {
        const vinculos = await db
          .select({ fileId: collectionFiles.fileId })
          .from(collectionFiles)
          .where(inArray(collectionFiles.collectionId, parte));
        for (const v of vinculos) vistos.add(v.fileId);
      }
      arquivosAfetados = [...vistos];
    }

    for (const parte of chunk(paraExcluir, IDS_PER_QUERY)) {
      await db.delete(collections).where(inArray(collections.id, parte));
    }
    for (const id of paraExcluir) results.push({ id, ok: true });

    if (alsoDeleteFiles && arquivosAfetados.length > 0) {
      // só apaga arquivos que não sobraram em nenhuma outra coleção
      const mantidos = new Set<string>();
      for (const parte of chunk(arquivosAfetados, IDS_PER_QUERY)) {
        const aindaVinculados = await db
          .select({ fileId: collectionFiles.fileId })
          .from(collectionFiles)
          .where(inArray(collectionFiles.fileId, parte));
        for (const v of aindaVinculados) mantidos.add(v.fileId);
      }
      const orfaos = arquivosAfetados.filter((id) => !mantidos.has(id));
      if (orfaos.length > 0) {
        await deleteFiles(db, bucket, userId, orfaos);
      }
    }
  }

  return registrar(db, userId, 'collections.delete', results);
}

/** Atualiza metadados (e opcionalmente o nome) de vários arquivos. */
export async function updateFilesMetadata(
  db: Database,
  userId: string,
  items: {
    id: string;
    originalName?: string;
    metadata?: Record<string, unknown> | null;
  }[],
): Promise<BulkReport> {
  const ids = items.map((i) => i.id);
  const { owned, results } = await partitionOwnedFiles(db, userId, ids);
  const agora = Date.now();

  for (const item of items) {
    if (!owned.has(item.id)) continue;
    const patch: Record<string, unknown> = { updatedAt: agora };
    if (item.originalName !== undefined) patch.originalName = item.originalName;
    if (item.metadata !== undefined) {
      if (item.metadata === null) {
        patch.metadata = null;
      } else {
        // capa nunca entra na coluna (ver file-service); em massa ela e so
        // descartada — para gravar capa use PUT /files/:id/cover
        const { rest } = splitCover(item.metadata);
        patch.metadata = rest ? JSON.stringify(rest) : null;
      }
    }
    await db.update(files).set(patch).where(eq(files.id, item.id));
    results.push({ id: item.id, ok: true });
  }

  return registrar(db, userId, 'files.update_metadata', results);
}

export async function getOperation(
  db: Database,
  _userId: string,
  operationId: string,
): Promise<BulkReport> {
  const [op] = await db
    .select()
    .from(bulkOperations)
    .where(eq(bulkOperations.id, operationId))
    .limit(1);
  if (!op) throw ApiError.notFound('Operação não encontrada.');
  return {
    operationId: op.id,
    total: op.total,
    succeeded: op.succeeded,
    failed: op.failed,
    results: op.report ? (JSON.parse(op.report) as BulkItemResult[]) : [],
  };
}
