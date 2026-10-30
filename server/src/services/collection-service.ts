import { and, asc, desc, eq, gt, inArray, like, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { collectionFiles, collections, files } from '../db';
import { ApiError, type Paginated } from '../lib/responses';
import { randomId } from '../lib/crypto';
import { chunk } from '../lib/chunk';
import { decodeCursor, encodeCursor } from '../lib/cursor';

// mesmo limite de variáveis do D1 descrito em bulk-service.ts
const IDS_PER_QUERY = 90;
const ROWS_PER_INSERT = 20;
import type { z } from 'zod';
import type { paginationSchema } from '../lib/validation';

export type ListaParams = z.infer<typeof paginationSchema>;

export interface CollectionDTO {
  id: string;
  name: string;
  description: string | null;
  fileCount: number;
  hasCover: boolean;
  createdAt: number;
  updatedAt: number;
}

export function coverKeyFor(collectionId: string): string {
  return `collections/${collectionId}/cover`;
}

export async function setCover(
  db: Database,
  collectionId: string,
  coverKey: string | null,
): Promise<void> {
  await db
    .update(collections)
    .set({ coverKey, updatedAt: Date.now() })
    .where(eq(collections.id, collectionId));
}

/** Garante que a coleção existe. Biblioteca é compartilhada — não filtra por dono. */
export async function requireOwned(
  db: Database,
  _userId: string,
  collectionId: string,
) {
  const [registro] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1);
  if (!registro) throw ApiError.notFound('Coleção não encontrada.');
  return registro;
}

export async function list(
  db: Database,
  userId: string,
  params: ListaParams,
): Promise<Paginated<CollectionDTO>> {
  const cursor = decodeCursor(params.cursor);
  const campo =
    params.sort === 'name'
      ? collections.name
      : params.sort === 'createdAt'
        ? collections.createdAt
        : collections.updatedAt;
  const crescente = params.order === 'asc';

  // Biblioteca compartilhada: lista de todos os usuários, não só do autenticado.
  void userId;
  const filtros = [];
  if (params.q) filtros.push(like(collections.name, `%${params.q}%`));
  if (cursor) {
    // desempate por id mantém a paginação estável
    filtros.push(
      crescente
        ? or(gt(campo, cursor.v as never), and(eq(campo, cursor.v as never), gt(collections.id, cursor.id)))!
        : or(lt(campo, cursor.v as never), and(eq(campo, cursor.v as never), gt(collections.id, cursor.id)))!,
    );
  }

  const linhas = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      coverKey: collections.coverKey,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      fileCount: sql<number>`(
        select count(*) from ${collectionFiles}
        where ${collectionFiles.collectionId} = ${collections.id}
      )`,
    })
    .from(collections)
    .where(and(...filtros))
    .orderBy(crescente ? asc(campo) : desc(campo), asc(collections.id))
    .limit(params.limit + 1);

  const temMais = linhas.length > params.limit;
  const itens = temMais ? linhas.slice(0, params.limit) : linhas;
  const ultimo = itens[itens.length - 1];

  return {
    items: itens.map(({ coverKey, ...resto }) => ({ ...resto, hasCover: !!coverKey })),
    nextCursor:
      temMais && ultimo
        ? encodeCursor({
            v:
              params.sort === 'name'
                ? ultimo.name
                : params.sort === 'createdAt'
                  ? ultimo.createdAt
                  : ultimo.updatedAt,
            id: ultimo.id,
          })
        : undefined,
  };
}

export async function create(
  db: Database,
  userId: string,
  data: { name: string; description?: string },
): Promise<CollectionDTO> {
  const agora = Date.now();
  const registro = {
    id: randomId(),
    userId,
    name: data.name,
    description: data.description ?? null,
    coverKey: null,
    createdAt: agora,
    updatedAt: agora,
  };
  try {
    await db.insert(collections).values(registro);
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw ApiError.conflict('Já existe uma coleção com esse nome.');
    }
    throw err;
  }
  const { coverKey, ...resto } = registro;
  return { ...resto, fileCount: 0, hasCover: false };
}

export async function update(
  db: Database,
  userId: string,
  id: string,
  data: { name?: string; description?: string | null },
) {
  await requireOwned(db, userId, id);
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;

  try {
    await db.update(collections).set(patch).where(eq(collections.id, id));
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw ApiError.conflict('Já existe uma coleção com esse nome.');
    }
    throw err;
  }
  return getById(db, userId, id);
}

export async function getById(
  db: Database,
  userId: string,
  id: string,
): Promise<CollectionDTO> {
  const registro = await requireOwned(db, userId, id);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(collectionFiles)
    .where(eq(collectionFiles.collectionId, id));
  return {
    id: registro.id,
    name: registro.name,
    description: registro.description,
    fileCount: Number(total),
    hasCover: !!registro.coverKey,
    createdAt: registro.createdAt,
    updatedAt: registro.updatedAt,
  };
}

/**
 * Apaga a coleção. Por padrão os arquivos continuam na biblioteca —
 * só o vínculo some. Com `deleteFiles`, os arquivos também são marcados
 * para exclusão (o objeto no R2 sai depois, pelo serviço de arquivos).
 */
export async function remove(
  db: Database,
  userId: string,
  id: string,
): Promise<{ fileIds: string[] }> {
  await requireOwned(db, userId, id);
  const vinculos = await db
    .select({ fileId: collectionFiles.fileId })
    .from(collectionFiles)
    .where(eq(collectionFiles.collectionId, id));

  await db.delete(collections).where(eq(collections.id, id));
  return { fileIds: vinculos.map((v) => v.fileId) };
}

/** Vincula arquivos à coleção, ignorando os que já estão (idempotente). */
export async function addFiles(
  db: Database,
  userId: string,
  collectionId: string,
  fileIds: string[],
): Promise<{ added: string[]; skipped: string[] }> {
  await requireOwned(db, userId, collectionId);

  const validos = new Set<string>();
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const proprios = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.userId, userId), inArray(files.id, parte)));
    for (const f of proprios) validos.add(f.id);
  }

  const existentes = new Set<string>();
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const jaVinculados = await db
      .select({ fileId: collectionFiles.fileId })
      .from(collectionFiles)
      .where(
        and(
          eq(collectionFiles.collectionId, collectionId),
          inArray(collectionFiles.fileId, parte),
        ),
      );
    for (const v of jaVinculados) existentes.add(v.fileId);
  }

  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`coalesce(max(${collectionFiles.position}), -1)` })
    .from(collectionFiles)
    .where(eq(collectionFiles.collectionId, collectionId));

  const agora = Date.now();
  const novos = fileIds.filter((id) => validos.has(id) && !existentes.has(id));
  if (novos.length > 0) {
    const linhas = novos.map((fileId, i) => ({
      collectionId,
      fileId,
      position: Number(maxPos) + 1 + i,
      addedAt: agora,
    }));
    for (const lote of chunk(linhas, ROWS_PER_INSERT)) {
      await db.insert(collectionFiles).values(lote);
    }
    await db
      .update(collections)
      .set({ updatedAt: agora })
      .where(eq(collections.id, collectionId));
  }

  return {
    added: novos,
    skipped: fileIds.filter((id) => !novos.includes(id)),
  };
}

/** Remove o vínculo — o arquivo continua existindo na biblioteca. */
export async function removeFiles(
  db: Database,
  userId: string,
  collectionId: string,
  fileIds: string[],
): Promise<number> {
  await requireOwned(db, userId, collectionId);
  let removidos = 0;
  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const resultado = await db
      .delete(collectionFiles)
      .where(
        and(
          eq(collectionFiles.collectionId, collectionId),
          inArray(collectionFiles.fileId, parte),
        ),
      )
      .returning({ fileId: collectionFiles.fileId });
    removidos += resultado.length;
  }

  if (removidos > 0) {
    await db
      .update(collections)
      .set({ updatedAt: Date.now() })
      .where(eq(collections.id, collectionId));
  }
  return removidos;
}
