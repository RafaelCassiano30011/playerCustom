import { and, asc, desc, eq, gt, inArray, like, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { collectionFiles, files, pendingDeletions, playbackProgress } from '../db';
import { ApiError, type Paginated } from '../lib/responses';
import { chunk } from '../lib/chunk';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import type { ListaParams } from './collection-service';

const IDS_PER_QUERY = 90;

export interface FileDTO {
  id: string;
  originalName: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  sha256: string | null;
  metadata: unknown;
  /** existe thumbnail para este vídeo (buscar em GET /files/:id/cover) */
  hasCover: boolean;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Até aqui a capa era gravada como data URL base64 dentro de `metadata`. Uma
 * linha chegava a 780 KB, e uma pagina de 50 arquivos estourava o limite de
 * recursos do Worker (a Cloudflare devolvia 503/1102 e a biblioteca nao
 * carregava). Agora a capa vive no R2 e a coluna guarda so metadados leves; o
 * base64 que sobrou nas linhas antigas e ignorado na leitura e movido por
 * `migrateLegacyCovers`.
 */
const MAX_METADATA_INLINE = 4096;

export function coverKeyFor(fileId: string): string {
  return `files/${fileId}/cover`;
}

/** Separa a capa (data URL) do resto dos metadados. */
export function splitCover(meta: unknown): {
  cover: string | null;
  rest: Record<string, unknown> | null;
} {
  if (!meta || typeof meta !== 'object') return { cover: null, rest: null };
  const { coverDataUrl, ...rest } = meta as Record<string, unknown>;
  return { cover: typeof coverDataUrl === 'string' ? coverDataUrl : null, rest };
}

/** Linha enxuta usada na listagem: metadado pesado nao vem do banco. */
interface LinhaDTO {
  id: string;
  originalName: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  sha256: string | null;
  metadata: string | null;
  coverKey: string | null;
  legacyCover?: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  createdAt: number;
  updatedAt: number;
}

function toDTO(row: LinhaDTO, collectionIds: string[]): FileDTO {
  const { cover, rest } = splitCover(
    row.metadata ? safeParse(row.metadata) : null,
  );
  return {
    id: row.id,
    originalName: row.originalName,
    format: row.format,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    sha256: row.sha256,
    metadata: rest,
    hasCover: !!row.coverKey || !!cover || row.legacyCover === 1,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    videoCodec: row.videoCodec,
    audioCodec: row.audioCodec,
    collectionIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Converte `data:<tipo>;base64,<...>` nos bytes e no content-type. */
function decodeDataUrl(
  dataUrl: string,
): { bytes: Uint8Array; contentType: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const corpo = m[3] ?? '';
  try {
    if (m[2]) {
      const bin = atob(corpo);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, contentType };
    }
    return {
      bytes: new TextEncoder().encode(decodeURIComponent(corpo)),
      contentType,
    };
  } catch {
    return null;
  }
}

async function putCover(
  db: Database,
  bucket: R2Bucket,
  fileId: string,
  corpo: Uint8Array | ReadableStream,
  contentType: string,
): Promise<void> {
  const key = coverKeyFor(fileId);
  await bucket.put(key, corpo, { httpMetadata: { contentType } });
  await db
    .update(files)
    .set({ coverKey: key, updatedAt: Date.now() })
    .where(eq(files.id, fileId));
}

/** Guarda no R2 uma capa que chegou como data URL (cliente antigo). */
export async function saveCoverFromDataUrl(
  db: Database,
  bucket: R2Bucket,
  fileId: string,
  dataUrl: string,
): Promise<boolean> {
  const decodificado = decodeDataUrl(dataUrl);
  if (!decodificado) return false;
  await putCover(
    db,
    bucket,
    fileId,
    decodificado.bytes,
    decodificado.contentType,
  );
  return true;
}

export async function setCoverFromStream(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
  corpo: ReadableStream,
  contentType: string,
): Promise<void> {
  await requireOwned(db, userId, fileId);
  await putCover(db, bucket, fileId, corpo, contentType);
}

/** Bytes da capa: do R2 ou, nas linhas antigas, do base64 que sobrou. */
export async function streamCover(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
): Promise<Response> {
  const row = await requireOwned(db, userId, fileId);
  if (row.coverKey) {
    const objeto = await bucket.get(row.coverKey);
    if (objeto) {
      return new Response(objeto.body, {
        headers: {
          'content-type':
            objeto.httpMetadata?.contentType ?? 'application/octet-stream',
          'cache-control': 'private, max-age=3600',
        },
      });
    }
  }
  const { cover } = splitCover(row.metadata ? safeParse(row.metadata) : null);
  const legado = cover ? decodeDataUrl(cover) : null;
  if (!legado) throw ApiError.notFound('Este arquivo nao tem capa.');
  return new Response(legado.bytes, {
    headers: {
      'content-type': legado.contentType,
      'cache-control': 'private, max-age=3600',
    },
  });
}

export async function removeCover(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
): Promise<void> {
  const row = await requireOwned(db, userId, fileId);
  if (row.coverKey) await bucket.delete(row.coverKey);
  const { rest } = splitCover(row.metadata ? safeParse(row.metadata) : null);
  await db
    .update(files)
    .set({
      coverKey: null,
      metadata: rest ? JSON.stringify(rest) : null,
      updatedAt: Date.now(),
    })
    .where(eq(files.id, fileId));
}

/**
 * Move para o R2 as capas que ainda estao em base64 na coluna `metadata`.
 * Lote pequeno de proposito: cada linha antiga tem centenas de KB.
 */
export async function migrateLegacyCovers(
  db: Database,
  bucket: R2Bucket,
  limite: number,
): Promise<{ migradas: number; falhas: number; restantes: number }> {
  const pendentes = await db
    .select({ id: files.id, metadata: files.metadata })
    .from(files)
    .where(like(files.metadata, '%coverDataUrl%'))
    .limit(limite);

  let migradas = 0;
  let falhas = 0;
  for (const linha of pendentes) {
    const { cover, rest } = splitCover(
      linha.metadata ? safeParse(linha.metadata) : null,
    );
    if (cover) {
      const ok = await saveCoverFromDataUrl(db, bucket, linha.id, cover);
      if (ok) {
        migradas++;
      } else {
        // data URL ilegível: manter a linha como está em vez de apagar a única
        // cópia da capa que existe
        falhas++;
        continue;
      }
    }
    await db
      .update(files)
      .set({ metadata: rest ? JSON.stringify(rest) : null })
      .where(eq(files.id, linha.id));
  }

  const [contagem] = await db
    .select({ total: sql<number>`count(*)` })
    .from(files)
    .where(like(files.metadata, '%coverDataUrl%'));

  return { migradas, falhas, restantes: Number(contagem?.total ?? 0) };
}

/** Busca o arquivo. Biblioteca é compartilhada — não filtra por dono. */
export async function requireOwned(
  db: Database,
  _userId: string,
  fileId: string,
) {
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row) throw ApiError.notFound('Arquivo não encontrado.');
  return row;
}

async function collectionsOf(
  db: Database,
  fileIds: string[],
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (fileIds.length === 0) return mapa;

  for (const parte of chunk(fileIds, IDS_PER_QUERY)) {
    const vinculos = await db
      .select({
        fileId: collectionFiles.fileId,
        collectionId: collectionFiles.collectionId,
      })
      .from(collectionFiles)
      .where(inArray(collectionFiles.fileId, parte));

    for (const v of vinculos) {
      const atual = mapa.get(v.fileId) ?? [];
      atual.push(v.collectionId);
      mapa.set(v.fileId, atual);
    }
  }
  return mapa;
}

export async function list(
  db: Database,
  userId: string,
  params: ListaParams & { collectionId?: string; format?: string },
): Promise<Paginated<FileDTO>> {
  const cursor = decodeCursor(params.cursor);
  const campo =
    params.sort === 'name'
      ? files.originalName
      : params.sort === 'createdAt'
        ? files.createdAt
        : params.sort === 'size'
          ? files.sizeBytes
          : files.updatedAt;
  const crescente = params.order === 'asc';

  // Biblioteca compartilhada: lista de todos os usuários, não só do autenticado.
  void userId;
  const filtros = [eq(files.status, 'ready')];
  if (params.q) filtros.push(like(files.originalName, `%${params.q}%`));
  if (params.format) filtros.push(eq(files.format, params.format));
  if (cursor) {
    filtros.push(
      crescente
        ? or(gt(campo, cursor.v as never), and(eq(campo, cursor.v as never), gt(files.id, cursor.id)))!
        : or(lt(campo, cursor.v as never), and(eq(campo, cursor.v as never), gt(files.id, cursor.id)))!,
    );
  }
  if (params.collectionId) {
    filtros.push(
      sql`${files.id} in (select ${collectionFiles.fileId} from ${collectionFiles} where ${collectionFiles.collectionId} = ${params.collectionId})`,
    );
  }

  const linhas = await db
    .select({
      id: files.id,
      originalName: files.originalName,
      format: files.format,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      status: files.status,
      sha256: files.sha256,
      coverKey: files.coverKey,
      durationSeconds: files.durationSeconds,
      width: files.width,
      height: files.height,
      videoCodec: files.videoCodec,
      audioCodec: files.audioCodec,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      // linha antiga com capa em base64 nao vem para o Worker (ver
      // MAX_METADATA_INLINE); a capa e servida por /files/:id/cover
      metadata: sql<
        string | null
      >`case when length(coalesce(${files.metadata}, '')) <= ${MAX_METADATA_INLINE} then ${files.metadata} else null end`,
      legacyCover: sql<
        number
      >`case when ${files.metadata} like '%coverDataUrl%' then 1 else 0 end`,
    })
    .from(files)
    .where(and(...filtros))
    .orderBy(crescente ? asc(campo) : desc(campo), asc(files.id))
    .limit(params.limit + 1);

  const temMais = linhas.length > params.limit;
  const itens = temMais ? linhas.slice(0, params.limit) : linhas;
  const mapa = await collectionsOf(db, itens.map((f) => f.id));
  const ultimo = itens[itens.length - 1];

  return {
    items: itens.map((f) => toDTO(f, mapa.get(f.id) ?? [])),
    nextCursor:
      temMais && ultimo
        ? encodeCursor({
            v:
              params.sort === 'name'
                ? ultimo.originalName
                : params.sort === 'createdAt'
                  ? ultimo.createdAt
                  : params.sort === 'size'
                    ? ultimo.sizeBytes
                    : ultimo.updatedAt,
            id: ultimo.id,
          })
        : undefined,
  };
}

export async function getById(
  db: Database,
  userId: string,
  fileId: string,
): Promise<FileDTO> {
  const row = await requireOwned(db, userId, fileId);
  const mapa = await collectionsOf(db, [row.id]);
  return toDTO(row, mapa.get(row.id) ?? []);
}

export async function update(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
  data: {
    originalName?: string;
    metadata?: Record<string, unknown> | null;
    durationSeconds?: number;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioCodec?: string;
  },
): Promise<FileDTO> {
  await requireOwned(db, userId, fileId);
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (data.originalName !== undefined) patch.originalName = data.originalName;
  // dados técnicos vêm do ffprobe no cliente, depois do upload
  if (data.durationSeconds !== undefined) {
    patch.durationSeconds = data.durationSeconds;
  }
  if (data.width !== undefined) patch.width = data.width;
  if (data.height !== undefined) patch.height = data.height;
  if (data.videoCodec !== undefined) patch.videoCodec = data.videoCodec;
  if (data.audioCodec !== undefined) patch.audioCodec = data.audioCodec;
  if (data.metadata !== undefined) {
    if (data.metadata === null) {
      patch.metadata = null;
    } else {
      // cliente antigo manda a capa junto dos metadados: ela vai para o R2 e
      // nao engorda mais a coluna
      const { cover, rest } = splitCover(data.metadata);
      if (cover) await saveCoverFromDataUrl(db, bucket, fileId, cover);
      patch.metadata = rest ? JSON.stringify(rest) : null;
    }
  }
  await db.update(files).set(patch).where(eq(files.id, fileId));
  return getById(db, userId, fileId);
}

/**
 * Exclusão em etapas: primeiro o registro vira `deleting` e a chave entra na
 * fila de remoção; depois tentamos apagar no R2. Se o R2 falhar, a chave fica
 * na fila e o cron tenta de novo — nunca deixamos registro inconsistente.
 */
export async function remove(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
): Promise<void> {
  const row = await requireOwned(db, userId, fileId);

  await db
    .update(files)
    .set({ status: 'deleting', updatedAt: Date.now() })
    .where(eq(files.id, fileId));
  await db
    .insert(pendingDeletions)
    .values({ r2Key: row.r2Key, attempts: 0, createdAt: Date.now() })
    .onConflictDoNothing();
  if (row.coverKey) {
    try {
      await bucket.delete(row.coverKey);
    } catch {
      /* capa orfa no R2 nao bloqueia a exclusao do arquivo */
    }
  }

  await finalizeDeletion(db, bucket, row.r2Key, fileId);
}

/** Tenta remover o objeto do R2 e, só então, apaga o registro. */
export async function finalizeDeletion(
  db: Database,
  bucket: R2Bucket,
  r2Key: string,
  fileId?: string,
): Promise<boolean> {
  try {
    await bucket.delete(r2Key);
  } catch (err) {
    await db
      .update(pendingDeletions)
      .set({
        attempts: sql`${pendingDeletions.attempts} + 1`,
        lastError: String(err).slice(0, 500),
      })
      .where(eq(pendingDeletions.r2Key, r2Key));
    return false;
  }

  await db.delete(pendingDeletions).where(eq(pendingDeletions.r2Key, r2Key));
  if (fileId) {
    await db.delete(collectionFiles).where(eq(collectionFiles.fileId, fileId));
    // o cascade do D1 cobriria isso, mas aqui a limpeza é explícita: este é o
    // único ponto onde a linha do arquivo some (exclusão simples e em massa)
    await db.delete(playbackProgress).where(eq(playbackProgress.fileId, fileId));
    await db.delete(files).where(eq(files.id, fileId));
  }
  return true;
}

/** Confere se o objeto existe no R2 e se o tamanho bate com o registro. */
export async function verifyIntegrity(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
): Promise<{ exists: boolean; sizeMatches: boolean; r2Size?: number }> {
  const row = await requireOwned(db, userId, fileId);
  const head = await bucket.head(row.r2Key);
  if (!head) return { exists: false, sizeMatches: false };
  return {
    exists: true,
    sizeMatches: head.size === row.sizeBytes,
    r2Size: head.size,
  };
}

/**
 * Entrega o conteúdo pelo próprio Worker, com suporte a `Range`.
 * Isso permite dar seek no vídeo sem baixar o arquivo inteiro.
 */
export async function streamContent(
  db: Database,
  bucket: R2Bucket,
  userId: string,
  fileId: string,
  rangeHeader?: string,
  ifNoneMatch?: string,
): Promise<Response> {
  const row = await requireOwned(db, userId, fileId);
  if (row.status !== 'ready') {
    throw ApiError.conflict('O arquivo ainda não está disponível.');
  }

  const faixa = parseRange(rangeHeader, row.sizeBytes);
  const objeto = await bucket.get(row.r2Key, {
    range: faixa ?? undefined,
    onlyIf: ifNoneMatch ? { etagDoesNotMatch: ifNoneMatch } : undefined,
  });

  if (!objeto) {
    // onlyIf falhou => conteúdo não mudou
    if (ifNoneMatch) return new Response(null, { status: 304 });
    throw ApiError.notFound('Objeto não encontrado no armazenamento.');
  }

  const headers = new Headers({
    'Content-Type': row.mimeType,
    'Accept-Ranges': 'bytes',
    ETag: objeto.httpEtag,
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
  });

  if (!('body' in objeto) || objeto.body === null) {
    return new Response(null, { status: 304, headers });
  }

  if (faixa) {
    const inicio = faixa.offset;
    const fim = inicio + faixa.length - 1;
    headers.set('Content-Range', `bytes ${inicio}-${fim}/${row.sizeBytes}`);
    headers.set('Content-Length', String(faixa.length));
    return new Response(objeto.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(row.sizeBytes));
  return new Response(objeto.body, { status: 200, headers });
}

/** Interpreta `Range: bytes=inicio-fim` (apenas uma faixa). */
export function parseRange(
  header: string | undefined,
  size: number,
): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, iniRaw, fimRaw] = match;
  if (iniRaw === '' && fimRaw === '') return null;

  if (iniRaw === '') {
    // sufixo: últimos N bytes
    const n = Math.min(Number(fimRaw), size);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { offset: size - n, length: n };
  }

  const inicio = Number(iniRaw);
  if (!Number.isFinite(inicio) || inicio >= size) return null;
  const fim = fimRaw === '' ? size - 1 : Math.min(Number(fimRaw), size - 1);
  if (fim < inicio) return null;
  return { offset: inicio, length: fim - inicio + 1 };
}
