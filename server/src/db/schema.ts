import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Regra de modelagem:
 * um vídeo pode pertencer a VÁRIAS coleções (tabela `collection_files`).
 * Remover de uma coleção apaga apenas o vínculo; excluir o arquivo remove o
 * objeto do R2 e todos os vínculos.
 *
 * Uma coleção é a temporada/série e `collection_files.position` é a ordem dos
 * episódios.
 */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    /**
     * Conta que so entra por codigo no e-mail guarda string vazia aqui.
     * Deixar a coluna anulavel exigiria reconstruir a tabela, e no D1 isso
     * significa DROP TABLE users com `collections` e `files` apontando para
     * ela por FK em cascata — nao vale o risco por um campo opcional.
     */
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);

/** Refresh tokens ficam guardados como hash para permitir revogação. */
export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    hashIdx: uniqueIndex('refresh_tokens_hash_idx').on(t.tokenHash),
    userIdx: index('refresh_tokens_user_idx').on(t.userId, t.expiresAt),
  }),
);

/**
 * Codigos de uso unico enviados por e-mail.
 *
 * Guardamos o hash do codigo, nunca o codigo: um vazamento do D1 nao deixa
 * ninguem entrar. `attempts` limita o chute — seis digitos sao 1 em 1 milhao
 * por tentativa, e sem teto um script tentaria tudo dentro da validade.
 */
export const loginCodes = sqliteTable(
  'login_codes',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    emailIdx: index('login_codes_email_idx').on(t.email, t.createdAt),
    expiraIdx: index('login_codes_expires_idx').on(t.expiresAt),
  }),
);

export const collections = sqliteTable(
  'collections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** capa escolhida pelo usuário (chave de objeto no R2) */
    coverKey: text('cover_key'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    userNameIdx: uniqueIndex('collections_user_name_idx').on(t.userId, t.name),
    userUpdatedIdx: index('collections_user_updated_idx').on(
      t.userId,
      t.updatedAt,
    ),
    // A listagem é do acervo inteiro, sem filtro por dono, então os índices
    // acima (que começam em user_id) não servem para ela — sem estes, cada
    // página vira varredura da tabela toda.
    updatedIdx: index('collections_updated_idx').on(t.updatedAt),
    nameIdx: index('collections_name_idx').on(t.name),
    createdIdx: index('collections_created_idx').on(t.createdAt),
  }),
);

/** Ciclo de vida do arquivo: pending -> ready -> deleting (removido depois). */
export const fileStatus = ['pending', 'ready', 'deleting'] as const;
export type FileStatus = (typeof fileStatus)[number];

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    /** nome seguro, sem caracteres de caminho */
    storageName: text('storage_name').notNull(),
    format: text('format').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    r2Key: text('r2_key').notNull(),
    sha256: text('sha256'),
    status: text('status').notNull().default('pending'),
    /** JSON livre com metadados extras (autor, páginas, etc.) */
    metadata: text('metadata'),
    /** capa/thumbnail (chave de objeto no R2); nunca em base64 na coluna */
    coverKey: text('cover_key'),
    /** duração em segundos, lida pelo ffprobe no cliente antes do upload */
    durationSeconds: real('duration_seconds'),
    width: integer('width'),
    height: integer('height'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    r2KeyIdx: uniqueIndex('files_r2_key_idx').on(t.r2Key),
    userUpdatedIdx: index('files_user_updated_idx').on(t.userId, t.updatedAt),
    userStatusIdx: index('files_user_status_idx').on(t.userId, t.status),
    userNameIdx: index('files_user_name_idx').on(t.userId, t.originalName),
    // Mesma razão de `collections_updated_idx`: a listagem filtra só por
    // status e ordena, sem user_id.
    statusUpdatedIdx: index('files_status_updated_idx').on(t.status, t.updatedAt),
    statusNameIdx: index('files_status_name_idx').on(t.status, t.originalName),
    statusCreatedIdx: index('files_status_created_idx').on(t.status, t.createdAt),
  }),
);

/**
 * Progresso de reprodução, uma linha por vídeo.
 *
 * NÃO tem `user_id` de propósito: o acervo é compartilhado entre as contas
 * (os serviços não filtram por dono), então a posição também é — parar no
 * minuto 12 na TV continua no 12 no desktop, em qualquer conta.
 *
 * A posição vai em segundos (`position_seconds`) E em fração (0–1) porque a
 * barra de progresso da lista só precisa da fração, sem conhecer a duração.
 * `opened_at` (última abertura) é separado de `updated_at` (última mudança de
 * posição) — o "Continuar assistindo" usa o último ABERTO.
 */
export const playbackProgress = sqliteTable(
  'playback_progress',
  {
    fileId: text('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    /** posição atual em segundos */
    positionSeconds: real('position_seconds').notNull().default(0),
    /** duração conhecida pelo cliente (0 quando ainda não sabe) */
    durationSeconds: real('duration_seconds').notNull().default(0),
    /** posição relativa, 0–1 */
    fraction: real('fraction').notNull().default(0),
    /** faixa de áudio e legenda escolhidas (índice ou idioma, como o cliente usa) */
    audioTrack: text('audio_track'),
    subtitleTrack: text('subtitle_track'),
    playbackRate: real('playback_rate'),
    /** 1 quando o episódio foi assistido até o fim */
    completed: integer('completed').notNull().default(0),
    openedAt: integer('opened_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    updatedIdx: index('playback_progress_updated_idx').on(t.updatedAt),
    openedIdx: index('playback_progress_opened_idx').on(t.openedAt),
  }),
);

export const collectionFiles = sqliteTable(
  'collection_files',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    /** ordena os episódios dentro da coleção */
    position: integer('position').notNull().default(0),
    addedAt: integer('added_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.fileId] }),
    fileIdx: index('collection_files_file_idx').on(t.fileId),
    collectionPosIdx: index('collection_files_pos_idx').on(
      t.collectionId,
      t.position,
    ),
  }),
);

export const uploadStatus = [
  'awaiting',
  'uploading',
  'completed',
  'aborted',
  'expired',
] as const;
export type UploadStatus = (typeof uploadStatus)[number];

export const uploadSessions = sqliteTable(
  'upload_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    /** preenchido quando o upload usa multipart do R2 */
    multipartId: text('multipart_id'),
    declaredSize: integer('declared_size').notNull(),
    status: text('status').notNull().default('awaiting'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({
    userIdx: index('upload_sessions_user_idx').on(t.userId),
    expiryIdx: index('upload_sessions_expiry_idx').on(t.status, t.expiresAt),
  }),
);

/** Partes confirmadas de um upload multipart (necessárias para concluir). */
export const uploadParts = sqliteTable(
  'upload_parts',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => uploadSessions.id, { onDelete: 'cascade' }),
    partNumber: integer('part_number').notNull(),
    etag: text('etag').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.partNumber] }),
  }),
);

export const bulkOperations = sqliteTable(
  'bulk_operations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status').notNull().default('completed'),
    total: integer('total').notNull().default(0),
    succeeded: integer('succeeded').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** JSON com o relatório item a item */
    report: text('report'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    userIdx: index('bulk_operations_user_idx').on(t.userId, t.createdAt),
  }),
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    detail: text('detail'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    userIdx: index('audit_logs_user_idx').on(t.userId, t.createdAt),
  }),
);

/** Objetos do R2 que ficaram órfãos e devem ser apagados pelo cron. */
export const pendingDeletions = sqliteTable(
  'pending_deletions',
  {
    r2Key: text('r2_key').primaryKey(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    createdIdx: index('pending_deletions_created_idx').on(t.createdAt),
  }),
);

export const schema = {
  users,
  refreshTokens,
  collections,
  files,
  collectionFiles,
  playbackProgress,
  uploadSessions,
  uploadParts,
  bulkOperations,
  auditLogs,
  pendingDeletions,
};

export type User = typeof users.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type UploadSession = typeof uploadSessions.$inferSelect;
export type PlaybackProgressRow = typeof playbackProgress.$inferSelect;

export { sql };
