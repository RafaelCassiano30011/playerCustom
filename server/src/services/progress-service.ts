import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm';
import type { Database } from '../db';
import { files, playbackProgress } from '../db';
import { ApiError, type Paginated } from '../lib/responses';
import { decodeCursor, encodeCursor } from '../lib/cursor';

/**
 * Progresso de reprodução compartilhado: a chave é só o arquivo, sem usuário
 * (mesma regra do acervo, ver `collection-service.requireOwned`). A proteção
 * contra dois aparelhos brigando pela posição é o last-write-wins por
 * `updatedAt` em `save()`.
 *
 * `fraction` é derivada de `positionSeconds / durationSeconds` quando o
 * cliente manda os dois — a lista desenha a barrinha sem precisar da duração.
 */

export interface ProgressDTO {
  fileId: string;
  positionSeconds: number;
  durationSeconds: number;
  fraction: number;
  audioTrack: string | null;
  subtitleTrack: string | null;
  playbackRate: number | null;
  completed: number;
  openedAt: number;
  updatedAt: number;
}

export interface SavePayload {
  positionSeconds?: number;
  durationSeconds?: number;
  fraction?: number;
  audioTrack?: string | null;
  subtitleTrack?: string | null;
  playbackRate?: number;
  completed?: boolean;
  /** quando o cliente registrou a posição; decide quem ganha */
  updatedAt?: number;
}

/** Acima disso o episódio conta como assistido e o "continuar" pula para o próximo. */
export const COMPLETION_FRACTION = 0.95;

export interface ListaParams {
  limit: number;
  cursor?: string;
  sort: 'updatedAt' | 'openedAt';
  order: 'asc' | 'desc';
}

/** Vídeo tem de existir e estar disponível para o cliente. */
async function requireFile(db: Database, fileId: string) {
  const [registro] = await db
    .select({ id: files.id, status: files.status })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);
  if (!registro || registro.status === 'deleting') {
    throw ApiError.notFound('Vídeo não encontrado.');
  }
  return registro;
}

export async function list(
  db: Database,
  params: ListaParams,
): Promise<Paginated<ProgressDTO>> {
  const cursor = decodeCursor(params.cursor);
  const campo =
    params.sort === 'openedAt'
      ? playbackProgress.openedAt
      : playbackProgress.updatedAt;
  const crescente = params.order === 'asc';

  const filtros = [];
  if (cursor) {
    // desempate pelo id mantém a paginação estável
    filtros.push(
      crescente
        ? or(
            gt(campo, cursor.v as never),
            and(eq(campo, cursor.v as never), gt(playbackProgress.fileId, cursor.id)),
          )!
        : or(
            lt(campo, cursor.v as never),
            and(eq(campo, cursor.v as never), gt(playbackProgress.fileId, cursor.id)),
          )!,
    );
  }

  const linhas = await db
    .select()
    .from(playbackProgress)
    .where(filtros.length > 0 ? and(...filtros) : undefined)
    .orderBy(crescente ? asc(campo) : desc(campo), asc(playbackProgress.fileId))
    .limit(params.limit + 1);

  const temMais = linhas.length > params.limit;
  const itens = temMais ? linhas.slice(0, params.limit) : linhas;
  const ultimo = itens[itens.length - 1];

  return {
    items: itens,
    nextCursor:
      temMais && ultimo
        ? encodeCursor({
            v: params.sort === 'openedAt' ? ultimo.openedAt : ultimo.updatedAt,
            id: ultimo.fileId,
          })
        : undefined,
  };
}

export async function getById(db: Database, fileId: string): Promise<ProgressDTO> {
  const [registro] = await db
    .select()
    .from(playbackProgress)
    .where(eq(playbackProgress.fileId, fileId))
    .limit(1);
  if (!registro) throw ApiError.notFound('Sem progresso para este vídeo.');
  return registro;
}

/** O último vídeo ABERTO (não o de posição mais recente). */
export async function last(db: Database): Promise<ProgressDTO | null> {
  const [registro] = await db
    .select()
    .from(playbackProgress)
    .innerJoin(files, eq(files.id, playbackProgress.fileId))
    .where(eq(files.status, 'ready'))
    .orderBy(desc(playbackProgress.openedAt), asc(playbackProgress.fileId))
    .limit(1);
  return registro ? registro.playback_progress : null;
}

/**
 * Grava posição e preferências. Last-write-wins: escrita com `updatedAt`
 * anterior ao gravado é ignorada e devolve a linha atual — é o que impede um
 * aparelho com relógio atrasado rebobinar o que o outro assistiu.
 */
export async function save(
  db: Database,
  fileId: string,
  payload: SavePayload,
): Promise<{ progress: ProgressDTO; applied: boolean }> {
  await requireFile(db, fileId);
  const agora = Date.now();
  const quando = payload.updatedAt ?? agora;

  const [atual] = await db
    .select()
    .from(playbackProgress)
    .where(eq(playbackProgress.fileId, fileId))
    .limit(1);

  if (atual && quando < atual.updatedAt) {
    return { progress: atual, applied: false };
  }

  const positionSeconds =
    payload.positionSeconds ?? atual?.positionSeconds ?? 0;
  const durationSeconds =
    payload.durationSeconds ?? atual?.durationSeconds ?? 0;
  // fração explícita ganha; sem ela, deriva da posição quando há duração
  const fraction =
    payload.fraction ??
    (durationSeconds > 0
      ? Math.min(1, positionSeconds / durationSeconds)
      : (atual?.fraction ?? 0));

  const linha = {
    fileId,
    positionSeconds,
    durationSeconds,
    fraction,
    audioTrack:
      payload.audioTrack !== undefined
        ? payload.audioTrack
        : (atual?.audioTrack ?? null),
    subtitleTrack:
      payload.subtitleTrack !== undefined
        ? payload.subtitleTrack
        : (atual?.subtitleTrack ?? null),
    playbackRate: payload.playbackRate ?? atual?.playbackRate ?? null,
    completed:
      payload.completed !== undefined
        ? payload.completed
          ? 1
          : 0
        : fraction >= COMPLETION_FRACTION
          ? 1
          : (atual?.completed ?? 0),
    // abrir é outro endpoint; salvar posição não mexe no "último aberto"
    openedAt: atual?.openedAt ?? quando,
    updatedAt: quando,
  };

  if (atual) {
    await db
      .update(playbackProgress)
      .set(linha)
      .where(eq(playbackProgress.fileId, fileId));
  } else {
    await db.insert(playbackProgress).values(linha);
  }
  return { progress: linha, applied: true };
}

/** Marca que o vídeo foi aberto agora — base do "Continuar assistindo". */
export async function markOpened(
  db: Database,
  fileId: string,
): Promise<ProgressDTO> {
  await requireFile(db, fileId);
  const agora = Date.now();
  const [atual] = await db
    .select()
    .from(playbackProgress)
    .where(eq(playbackProgress.fileId, fileId))
    .limit(1);

  if (!atual) {
    const linha = {
      fileId,
      positionSeconds: 0,
      durationSeconds: 0,
      fraction: 0,
      audioTrack: null,
      subtitleTrack: null,
      playbackRate: null,
      completed: 0,
      openedAt: agora,
      updatedAt: agora,
    };
    await db.insert(playbackProgress).values(linha);
    return linha;
  }

  await db
    .update(playbackProgress)
    .set({ openedAt: agora })
    .where(eq(playbackProgress.fileId, fileId));
  return { ...atual, openedAt: agora };
}

export async function remove(db: Database, fileId: string): Promise<boolean> {
  const apagados = await db
    .delete(playbackProgress)
    .where(eq(playbackProgress.fileId, fileId))
    .returning({ fileId: playbackProgress.fileId });
  return apagados.length > 0;
}

/**
 * Mudanças desde um timestamp, para `/sync/changes`.
 *
 * São duas consultas de propósito: `updated_at > ? or opened_at > ?` numa só
 * não usa índice nenhum e varre a tabela toda — o que pesa, porque o cliente
 * pergunta isso a cada 30 s. Separadas, cada uma cai no seu índice.
 */
export async function changedSince(
  db: Database,
  since: number,
  limit: number,
): Promise<ProgressDTO[]> {
  const [porPosicao, porAbertura] = await Promise.all([
    db
      .select()
      .from(playbackProgress)
      .where(gt(playbackProgress.updatedAt, since))
      .orderBy(asc(playbackProgress.updatedAt), asc(playbackProgress.fileId))
      .limit(limit),
    db
      .select()
      .from(playbackProgress)
      .where(gt(playbackProgress.openedAt, since))
      .orderBy(asc(playbackProgress.openedAt), asc(playbackProgress.fileId))
      .limit(limit),
  ]);

  const porId = new Map<string, ProgressDTO>();
  for (const linha of [...porPosicao, ...porAbertura]) {
    porId.set(linha.fileId, linha);
  }
  return [...porId.values()]
    .sort((a, b) => a.updatedAt - b.updatedAt || a.fileId.localeCompare(b.fileId))
    .slice(0, limit);
}
