import type { Database } from '../db';

/** Bindings e variáveis declarados no wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  FILES_BUCKET: R2Bucket;

  APP_ORIGIN: string;
  CORS_ORIGINS: string;
  MAX_FILE_BYTES: string;
  ACCESS_TOKEN_TTL_SECONDS: string;
  REFRESH_TOKEN_TTL_SECONDS: string;
  STREAM_TOKEN_TTL_SECONDS: string;
  LOGIN_CODE_TTL_SECONDS: string;

  /** Remetente dos e-mails de codigo. */
  EMAIL_FROM: string;
  /**
   * Lista de e-mails, separados por virgula, que podem receber codigo. Vazio
   * libera qualquer um — e um endpoint publico que dispara e-mail para
   * qualquer endereco vira relay de spam, entao em producao isso fica preso
   * na sua conta.
   */
  ALLOWED_EMAILS: string;

  /**
   * So os testes ligam isso: faz a resposta de `/auth/code` devolver o codigo
   * gerado, porque o teste nao tem caixa de e-mail para ler. Nunca entra no
   * wrangler.jsonc.
   */
  LOGIN_CODE_DEBUG?: string;

  /** secret: `wrangler secret put JWT_SECRET` */
  JWT_SECRET: string;
  /** secret: `wrangler secret put RESEND_API_KEY` (sem ela, o codigo so vai para o log) */
  RESEND_API_KEY?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Variáveis que os middlewares injetam no contexto do Hono. */
export interface Variables {
  db: Database;
  user: AuthUser;
  requestId: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: Variables;
};

/** Formatos aceitos pelo player. */
export const SUPPORTED_FORMATS = [
  'mp4',
  'm4v',
  'mkv',
  'webm',
  'mov',
  'avi',
  'ts',
] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export interface BulkItemResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface BulkReport {
  operationId: string;
  total: number;
  succeeded: number;
  failed: number;
  results: BulkItemResult[];
}
