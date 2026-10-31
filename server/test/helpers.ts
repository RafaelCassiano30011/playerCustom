import { env } from 'cloudflare:test';
import worker from '../src/server';
import { resetRateLimits } from '../src/middleware/rate-limit';

/**
 * As migrations são aplicadas pelo setup (test/apply-migrations.ts), que roda
 * antes dos testes. Mantido como no-op para os testes chamarem sem saber disso.
 */
export async function migrate(): Promise<void> {}

/** Limpa as tabelas entre testes, preservando o schema. */
export async function resetDb(): Promise<void> {
  const tabelas = [
    'upload_parts',
    'upload_sessions',
    'collection_files',
    'playback_progress',
    'pending_deletions',
    'bulk_operations',
    'audit_logs',
    'files',
    'collections',
    'refresh_tokens',
    'login_codes',
    'users',
  ];
  for (const t of tabelas) {
    await env.DB.prepare(`delete from ${t}`).run();
  }
  resetRateLimits();
}

const BASE = 'http://localhost';

export async function call(
  method: string,
  caminho: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: BodyInit } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const request = new Request(`${BASE}${caminho}`, { method, headers, body });
  const ctx = createExecutionContext();
  const resposta = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return resposta;
}

// reexportados para os testes montarem contextos quando precisarem
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
export { createExecutionContext, waitOnExecutionContext, env, worker };

export interface Conta {
  token: string;
  refreshToken: string;
  userId: string;
  email: string;
}

let contador = 0;

export async function criarConta(senha = 'senha-muito-boa-123'): Promise<Conta> {
  const email = `usuario${++contador}-${Date.now()}@exemplo.com`;
  const resposta = await call('POST', '/api/v1/auth/register', {
    body: { email, password: senha },
  });
  if (resposta.status !== 201) {
    throw new Error(`falha ao criar conta: ${resposta.status} ${await resposta.text()}`);
  }
  const dados = (await resposta.json()) as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  };
  return {
    token: dados.accessToken,
    refreshToken: dados.refreshToken,
    userId: dados.user.id,
    email: dados.user.email,
  };
}

/** MP4 mínimo válido: "ftyp" no offset 4 (ISOBMFF). */
export function mp4Bytes(tamanho = 2048): Uint8Array {
  const buf = new Uint8Array(tamanho);
  buf.set([0x00, 0x00, 0x00, 0x18], 0);
  buf.set(new TextEncoder().encode('ftypisom'), 4);
  for (let i = 12; i < tamanho; i++) buf[i] = 65;
  return buf;
}

/** MKV/WebM mínimo: cabeçalho EBML. */
export function mkvBytes(tamanho = 2048): Uint8Array {
  const buf = new Uint8Array(tamanho);
  buf.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  for (let i = 4; i < tamanho; i++) buf[i] = 66;
  return buf;
}

/** AVI mínimo: RIFF, com "AVI " no offset 8. */
export function aviBytes(tamanho = 2048): Uint8Array {
  const buf = new Uint8Array(tamanho);
  buf.set(new TextEncoder().encode('RIFF'), 0);
  buf.set(new TextEncoder().encode('AVI '), 8);
  for (let i = 12; i < tamanho; i++) buf[i] = 67;
  return buf;
}


/** Faz o fluxo completo de upload e devolve o id do arquivo. */
export async function enviarArquivo(
  conta: Conta,
  opts: {
    fileName?: string;
    bytes?: Uint8Array;
    collectionId?: string;
  } = {},
): Promise<string> {
  const bytes = opts.bytes ?? mp4Bytes();
  const fileName = opts.fileName ?? 'episodio.mp4';

  const init = await call('POST', '/api/v1/files/uploads', {
    token: conta.token,
    body: {
      fileName,
      sizeBytes: bytes.byteLength,
      collectionId: opts.collectionId,
    },
  });
  if (init.status !== 201) {
    throw new Error(`init falhou: ${init.status} ${await init.text()}`);
  }
  const { uploadId, fileId } = (await init.json()) as {
    uploadId: string;
    fileId: string;
  };

  const put = await call('PUT', `/api/v1/files/uploads/${uploadId}/content`, {
    token: conta.token,
    raw: bytes,
    headers: { 'Content-Length': String(bytes.byteLength) },
  });
  if (!put.ok) {
    throw new Error(`upload falhou: ${put.status} ${await put.text()}`);
  }

  const complete = await call(
    'POST',
    `/api/v1/files/uploads/${uploadId}/complete`,
    { token: conta.token },
  );
  if (!complete.ok) {
    throw new Error(`complete falhou: ${complete.status} ${await complete.text()}`);
  }
  return fileId;
}

export async function criarColecao(
  conta: Conta,
  nome: string,
): Promise<string> {
  const resposta = await call('POST', '/api/v1/collections', {
    token: conta.token,
    body: { name: nome },
  });
  if (resposta.status !== 201) {
    throw new Error(`criar coleção falhou: ${resposta.status} ${await resposta.text()}`);
  }
  return ((await resposta.json()) as { id: string }).id;
}
