import { and, eq, lt, inArray } from 'drizzle-orm';
import type { Database } from '../db';
import {
  collectionFiles,
  collections,
  files,
  pendingDeletions,
  uploadParts,
  uploadSessions,
} from '../db';
import { ApiError } from '../lib/responses';
import { randomId } from '../lib/crypto';
import {
  MIME_CANONICAL,
  SNIFF_BYTES,
  contentMatchesFormat,
  extensionOf,
  mimeMatchesFormat,
  safeStorageName,
} from '../lib/validation';
import { SUPPORTED_FORMATS, type Env, type SupportedFormat } from '../types';

/** Uploads abandonados são limpos depois disso. */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
/** O R2 exige partes de no mínimo 5 MiB (exceto a última). */
export const MIN_PART_BYTES = 5 * 1024 * 1024;
/**
 * Parte padrão do multipart de vídeo. O R2 aceita no máximo 10.000 partes,
 * então 64 MiB cobre arquivos de até ~640 GiB sem recalcular nada.
 */
export const VIDEO_PART_BYTES = 64 * 1024 * 1024;

export interface InitResult {
  uploadId: string;
  fileId: string;
  /** 'single' envia tudo de uma vez; 'multipart' envia em partes */
  strategy: 'single' | 'multipart';
  partSize?: number;
  expiresAt: number;
}

function maxBytes(env: Env): number {
  const v = Number(env.MAX_FILE_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 21_474_836_480;
}

/**
 * Passo 1: autoriza o upload. Valida nome, formato, MIME e tamanho ANTES de
 * qualquer byte ser aceito, e cria o registro do arquivo como `pending`.
 */
export async function init(
  db: Database,
  env: Env,
  userId: string,
  input: {
    fileName: string;
    sizeBytes: number;
    mimeType?: string;
    collectionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<InitResult> {
  const limite = maxBytes(env);
  if (input.sizeBytes <= 0) {
    throw ApiError.badRequest('Tamanho do arquivo deve ser maior que zero.');
  }
  if (input.sizeBytes > limite) {
    throw ApiError.payloadTooLarge(
      `Arquivo maior que o limite de ${limite} bytes.`,
    );
  }

  const storageName = safeStorageName(input.fileName);
  const ext = extensionOf(storageName);
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(ext)) {
    throw ApiError.unsupportedMedia(
      `Formato não suportado. Envie ${SUPPORTED_FORMATS.join(', ')}.`,
    );
  }
  const format = ext as SupportedFormat;

  if (!mimeMatchesFormat(format, input.mimeType)) {
    throw ApiError.unsupportedMedia(
      `O tipo declarado (${input.mimeType}) não combina com .${format}.`,
    );
  }

  if (input.collectionId) {
    const [col] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          eq(collections.id, input.collectionId),
          eq(collections.userId, userId),
        ),
      )
      .limit(1);
    if (!col) throw ApiError.notFound('Coleção não encontrada.');
  }

  const agora = Date.now();
  const fileId = randomId();
  // a chave inclui o usuário: um objeto nunca é compartilhado entre contas
  const r2Key = `users/${userId}/files/${fileId}/${storageName}`;

  await db.insert(files).values({
    id: fileId,
    userId,
    originalName: input.fileName.slice(0, 300),
    storageName,
    format,
    mimeType: MIME_CANONICAL[format],
    sizeBytes: 0,
    r2Key,
    status: 'pending',
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: agora,
    updatedAt: agora,
  });

  const usarMultipart = input.sizeBytes > VIDEO_PART_BYTES;
  const uploadId = randomId();
  let multipartId: string | null = null;

  if (usarMultipart) {
    const multipart = await env.FILES_BUCKET.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: MIME_CANONICAL[format] },
    });
    multipartId = multipart.uploadId;
  }

  await db.insert(uploadSessions).values({
    id: uploadId,
    userId,
    fileId,
    r2Key,
    multipartId,
    declaredSize: input.sizeBytes,
    status: 'awaiting',
    createdAt: agora,
    expiresAt: agora + SESSION_TTL_MS,
  });

  if (input.collectionId) {
    await db.insert(collectionFiles).values({
      collectionId: input.collectionId,
      fileId,
      position: agora,
      addedAt: agora,
    });
  }

  return {
    uploadId,
    fileId,
    strategy: usarMultipart ? 'multipart' : 'single',
    partSize: usarMultipart ? VIDEO_PART_BYTES : undefined,
    expiresAt: agora + SESSION_TTL_MS,
  };
}

async function requireSession(
  db: Database,
  userId: string,
  uploadId: string,
) {
  const [sessao] = await db
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, uploadId), eq(uploadSessions.userId, userId)),
    )
    .limit(1);
  if (!sessao) throw ApiError.notFound('Sessão de upload não encontrada.');
  if (sessao.status === 'aborted' || sessao.status === 'expired') {
    throw ApiError.conflict('Esta sessão de upload não está mais ativa.');
  }
  if (sessao.expiresAt < Date.now()) {
    throw ApiError.conflict('Sessão de upload expirada.');
  }
  return sessao;
}

/**
 * Passo 2 (arquivo pequeno): recebe o corpo e envia direto ao R2 em streaming,
 * sem carregar tudo na memória do Worker.
 */
export async function uploadSingle(
  db: Database,
  env: Env,
  userId: string,
  uploadId: string,
  body: ReadableStream<Uint8Array>,
  declaredContentLength?: number,
): Promise<{ sizeBytes: number }> {
  const sessao = await requireSession(db, userId, uploadId);
  if (sessao.multipartId) {
    throw ApiError.badRequest('Esta sessão exige upload em partes.');
  }
  const limite = maxBytes(env);
  if (declaredContentLength && declaredContentLength > limite) {
    throw ApiError.payloadTooLarge('Arquivo maior que o limite permitido.');
  }

  await db
    .update(uploadSessions)
    .set({ status: 'uploading' })
    .where(eq(uploadSessions.id, uploadId));

  const [row] = await db
    .select({ format: files.format, mimeType: files.mimeType })
    .from(files)
    .where(eq(files.id, sessao.fileId))
    .limit(1);

  // confere os primeiros bytes (magic number) sem bufferizar o arquivo todo
  const { stream, head } = await peekHead(body, SNIFF_BYTES);
  if (!contentMatchesFormat(row.format, head)) {
    await abort(db, env, userId, uploadId);
    throw ApiError.unsupportedMedia(
      `O conteúdo enviado não é um arquivo .${row.format} válido.`,
    );
  }

  // O R2 exige um corpo de tamanho conhecido. Como reembrulhamos o stream
  // para inspecionar o cabeçalho, repassamos por um FixedLengthStream com o
  // tamanho declarado na sessão — isso também valida o tamanho na hora.
  const fixo = new FixedLengthStream(sessao.declaredSize);
  const bombeando = stream.pipeTo(fixo.writable);

  let objeto: R2Object | null = null;
  try {
    objeto = await env.FILES_BUCKET.put(sessao.r2Key, fixo.readable, {
      httpMetadata: { contentType: row.mimeType },
    });
    await bombeando;
  } catch (err) {
    // tamanho diferente do declarado faz o FixedLengthStream falhar
    throw ApiError.conflict(
      `Não foi possível gravar o arquivo: ${String(err).slice(0, 200)}`,
    );
  }
  if (!objeto) throw ApiError.internal('Falha ao gravar o arquivo.');

  return { sizeBytes: objeto.size };
}

/** Lê os primeiros bytes e devolve um stream equivalente ao original. */
export async function peekHead(
  body: ReadableStream<Uint8Array>,
  bytes: number,
): Promise<{ stream: ReadableStream<Uint8Array>; head: Uint8Array }> {
  const reader = body.getReader();
  const pedacos: Uint8Array[] = [];
  let lidos = 0;
  let done = false;

  while (lidos < bytes) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    pedacos.push(r.value);
    lidos += r.value.byteLength;
  }

  const head = new Uint8Array(Math.min(lidos, bytes));
  let pos = 0;
  for (const p of pedacos) {
    if (pos >= head.length) break;
    head.set(p.subarray(0, Math.min(p.length, head.length - pos)), pos);
    pos += p.length;
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pedacos.length > 0) {
        controller.enqueue(pedacos.shift()!);
        return;
      }
      if (done) {
        controller.close();
        return;
      }
      const r = await reader.read();
      if (r.done) {
        controller.close();
        return;
      }
      controller.enqueue(r.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { stream, head };
}

/** Passo 2 (arquivo grande): envia uma parte do multipart. */
export async function uploadPart(
  db: Database,
  env: Env,
  userId: string,
  uploadId: string,
  partNumber: number,
  body: ReadableStream<Uint8Array> | ArrayBuffer,
): Promise<{ partNumber: number; etag: string }> {
  const sessao = await requireSession(db, userId, uploadId);
  if (!sessao.multipartId) {
    throw ApiError.badRequest('Esta sessão não usa upload em partes.');
  }
  if (partNumber < 1 || partNumber > 10_000) {
    throw ApiError.badRequest('Número da parte fora do intervalo (1–10000).');
  }

  const multipart = env.FILES_BUCKET.resumeMultipartUpload(
    sessao.r2Key,
    sessao.multipartId,
  );
  const parte = await multipart.uploadPart(partNumber, body as ReadableStream);

  await db
    .insert(uploadParts)
    .values({
      sessionId: uploadId,
      partNumber,
      etag: parte.etag,
      sizeBytes: 0,
    })
    .onConflictDoUpdate({
      target: [uploadParts.sessionId, uploadParts.partNumber],
      set: { etag: parte.etag },
    });

  await db
    .update(uploadSessions)
    .set({ status: 'uploading' })
    .where(eq(uploadSessions.id, uploadId));

  return { partNumber, etag: parte.etag };
}

/**
 * Passo 3: confirma o upload. Fecha o multipart (se houver), confere se o
 * objeto existe e se o tamanho bate, e só então marca o arquivo como pronto.
 * Repetir a chamada é seguro (idempotente).
 */
export async function complete(
  db: Database,
  env: Env,
  userId: string,
  uploadId: string,
): Promise<{ fileId: string; sizeBytes: number }> {
  const [sessao] = await db
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, uploadId), eq(uploadSessions.userId, userId)),
    )
    .limit(1);
  if (!sessao) throw ApiError.notFound('Sessão de upload não encontrada.');

  // já concluída: devolve o mesmo resultado
  if (sessao.status === 'completed') {
    const [row] = await db
      .select({ id: files.id, sizeBytes: files.sizeBytes })
      .from(files)
      .where(eq(files.id, sessao.fileId))
      .limit(1);
    if (row) return { fileId: row.id, sizeBytes: row.sizeBytes };
  }

  if (sessao.multipartId) {
    const partes = await db
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.sessionId, uploadId))
      .orderBy(uploadParts.partNumber);
    if (partes.length === 0) {
      throw ApiError.conflict('Nenhuma parte foi enviada.');
    }
    const multipart = env.FILES_BUCKET.resumeMultipartUpload(
      sessao.r2Key,
      sessao.multipartId,
    );
    try {
      await multipart.complete(
        partes.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      );
    } catch (err) {
      throw ApiError.conflict(
        `Não foi possível concluir o upload em partes: ${String(err).slice(0, 200)}`,
      );
    }
  }

  // o objeto precisa existir de verdade antes de liberarmos o arquivo
  const head = await env.FILES_BUCKET.head(sessao.r2Key);
  if (!head) {
    throw ApiError.conflict('O conteúdo não chegou ao armazenamento.');
  }
  if (head.size !== sessao.declaredSize) {
    throw ApiError.conflict(
      `Tamanho divergente: enviado ${head.size} bytes, declarado ${sessao.declaredSize}.`,
    );
  }

  const agora = Date.now();
  await db
    .update(files)
    .set({ status: 'ready', sizeBytes: head.size, updatedAt: agora })
    .where(eq(files.id, sessao.fileId));
  await db
    .update(uploadSessions)
    .set({ status: 'completed' })
    .where(eq(uploadSessions.id, uploadId));

  return { fileId: sessao.fileId, sizeBytes: head.size };
}

/** Cancela o upload e limpa o que já foi gravado. */
export async function abort(
  db: Database,
  env: Env,
  userId: string,
  uploadId: string,
): Promise<void> {
  const [sessao] = await db
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, uploadId), eq(uploadSessions.userId, userId)),
    )
    .limit(1);
  if (!sessao) throw ApiError.notFound('Sessão de upload não encontrada.');

  if (sessao.multipartId) {
    try {
      await env.FILES_BUCKET.resumeMultipartUpload(
        sessao.r2Key,
        sessao.multipartId,
      ).abort();
    } catch {
      // o multipart pode já ter sido fechado; a chave entra na fila abaixo
    }
  }

  await db
    .update(uploadSessions)
    .set({ status: 'aborted' })
    .where(eq(uploadSessions.id, uploadId));
  await db
    .insert(pendingDeletions)
    .values({ r2Key: sessao.r2Key, attempts: 0, createdAt: Date.now() })
    .onConflictDoNothing();
  await db.delete(collectionFiles).where(eq(collectionFiles.fileId, sessao.fileId));
  await db.delete(files).where(eq(files.id, sessao.fileId));
}

/** Chamado pelo cron: descarta sessões vencidas e agenda limpeza no R2. */
export async function expireStaleSessions(
  db: Database,
  env: Env,
  agora = Date.now(),
): Promise<number> {
  const vencidas = await db
    .select()
    .from(uploadSessions)
    .where(
      and(
        lt(uploadSessions.expiresAt, agora),
        inArray(uploadSessions.status, ['awaiting', 'uploading']),
      ),
    )
    .limit(100);

  for (const sessao of vencidas) {
    if (sessao.multipartId) {
      try {
        await env.FILES_BUCKET.resumeMultipartUpload(
          sessao.r2Key,
          sessao.multipartId,
        ).abort();
      } catch {
        // segue para a fila de limpeza
      }
    }
    await db
      .insert(pendingDeletions)
      .values({ r2Key: sessao.r2Key, attempts: 0, createdAt: agora })
      .onConflictDoNothing();
    await db
      .update(uploadSessions)
      .set({ status: 'expired' })
      .where(eq(uploadSessions.id, sessao.id));
    await db
      .delete(collectionFiles)
      .where(eq(collectionFiles.fileId, sessao.fileId));
    await db
      .delete(files)
      .where(and(eq(files.id, sessao.fileId), eq(files.status, 'pending')));
  }

  return vencidas.length;
}
