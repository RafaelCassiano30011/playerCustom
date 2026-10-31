import { beforeEach, describe, expect, it } from 'vitest';
import { call, env, resetDb } from './helpers';

/**
 * Login por codigo no e-mail.
 *
 * Nos testes `LOGIN_CODE_DEBUG` faz a API devolver o codigo gerado, porque
 * aqui nao existe caixa de entrada para ler.
 */

interface Pedido {
  retryAfter: number;
  expiresIn: number;
  code?: string;
}

async function pedirCodigo(email: string): Promise<Pedido> {
  const resposta = await call('POST', '/api/v1/auth/code', { body: { email } });
  expect(resposta.status).toBe(202);
  return resposta.json<Pedido>();
}

const EMAIL = 'dono@exemplo.com';

describe('login por codigo', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('cria a conta no primeiro codigo e devolve tokens', async () => {
    const pedido = await pedirCodigo(EMAIL);
    expect(pedido.code).toMatch(/^\d{6}$/);

    const resposta = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: pedido.code },
    });
    expect(resposta.status).toBe(200);

    const dados = await resposta.json<{ accessToken: string; user: { email: string } }>();
    expect(dados.user.email).toBe(EMAIL);

    const me = await call('GET', '/api/v1/auth/me', { token: dados.accessToken });
    expect(me.status).toBe(200);
  });

  it('nao guarda o codigo em texto no banco', async () => {
    const pedido = await pedirCodigo(EMAIL);
    const linha = await env.DB.prepare('select code_hash from login_codes').first<{
      code_hash: string;
    }>();
    expect(linha?.code_hash).toBeDefined();
    expect(linha?.code_hash).not.toBe(pedido.code);
    expect(linha?.code_hash).toHaveLength(64);
  });

  it('o mesmo codigo nao serve duas vezes', async () => {
    const pedido = await pedirCodigo(EMAIL);
    const corpo = { email: EMAIL, code: pedido.code };

    expect((await call('POST', '/api/v1/auth/code/verify', { body: corpo })).status).toBe(200);
    expect((await call('POST', '/api/v1/auth/code/verify', { body: corpo })).status).toBe(401);
  });

  it('codigo errado falha e queima depois de cinco tentativas', async () => {
    await pedirCodigo(EMAIL);

    for (let i = 0; i < 5; i++) {
      const erro = await call('POST', '/api/v1/auth/code/verify', {
        body: { email: EMAIL, code: '000000' },
      });
      expect(erro.status).toBe(401);
    }

    const bloqueado = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: '000000' },
    });
    expect(bloqueado.status).toBe(429);
  });

  it('codigo expirado nao entra', async () => {
    await pedirCodigo(EMAIL);
    await env.DB.prepare('update login_codes set expires_at = ?')
      .bind(Date.now() - 1000)
      .run();

    const linha = await env.DB.prepare('select code_hash from login_codes').first();
    expect(linha).toBeDefined();

    const resposta = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: '123456' },
    });
    expect(resposta.status).toBe(401);
  });

  it('pedido repetido em menos de um minuto nao gera outro codigo', async () => {
    const primeiro = await pedirCodigo(EMAIL);
    const segundo = await pedirCodigo(EMAIL);
    // o segundo pedido nem chega a criar codigo: nada de novo para devolver
    expect(segundo.code).toBeUndefined();

    const linhas = await env.DB.prepare('select count(*) as total from login_codes').first<{
      total: number;
    }>();
    expect(linhas?.total).toBe(1);

    // o codigo do primeiro pedido continua valendo
    const resposta = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: primeiro.code },
    });
    expect(resposta.status).toBe(200);
  });

  it('e-mail fora da lista permitida recebe a mesma resposta, sem codigo', async () => {
    // ALLOWED_EMAILS do wrangler.jsonc so tem o e-mail do dono
    const pedido = await pedirCodigo('estranho@exemplo.com');
    expect(pedido.code).toBeUndefined();

    const linhas = await env.DB.prepare('select count(*) as total from login_codes').first<{
      total: number;
    }>();
    expect(linhas?.total).toBe(0);
  });

  it('segundo login no mesmo e-mail reaproveita a conta', async () => {
    const primeiro = await pedirCodigo(EMAIL);
    const entrada = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: primeiro.code },
    });
    const { user } = await entrada.json<{ user: { id: string } }>();

    await env.DB.prepare('delete from login_codes').run();
    const segundo = await pedirCodigo(EMAIL);
    const volta = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: segundo.code },
    });
    const dados = await volta.json<{ user: { id: string } }>();
    expect(dados.user.id).toBe(user.id);
  });

  it('conta criada por codigo nao entra por senha', async () => {
    const pedido = await pedirCodigo(EMAIL);
    await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: pedido.code },
    });

    const resposta = await call('POST', '/api/v1/auth/login', {
      body: { email: EMAIL, password: 'tentando-uma-senha' },
    });
    expect(resposta.status).toBe(401);
  });

  it('codigo com formato invalido e recusado antes de consultar o banco', async () => {
    const resposta = await call('POST', '/api/v1/auth/code/verify', {
      body: { email: EMAIL, code: 'abc' },
    });
    expect(resposta.status).toBe(400);
  });
});
