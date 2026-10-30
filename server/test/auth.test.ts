import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, criarConta, migrate, resetDb } from './helpers';

beforeAll(migrate);
beforeEach(resetDb);

describe('autenticação', () => {
  it('cadastra e devolve tokens', async () => {
    const resposta = await call('POST', '/api/v1/auth/register', {
      body: { email: 'novo@exemplo.com', password: 'senha-forte-123' },
    });
    expect(resposta.status).toBe(201);
    const dados = (await resposta.json()) as Record<string, unknown>;
    expect(dados.accessToken).toBeTypeOf('string');
    expect(dados.refreshToken).toBeTypeOf('string');
    expect((dados.user as { email: string }).email).toBe('novo@exemplo.com');
  });

  it('recusa e-mail repetido', async () => {
    const corpo = { email: 'dup@exemplo.com', password: 'senha-forte-123' };
    await call('POST', '/api/v1/auth/register', { body: corpo });
    const segunda = await call('POST', '/api/v1/auth/register', { body: corpo });
    expect(segunda.status).toBe(409);
  });

  it('recusa senha curta', async () => {
    const resposta = await call('POST', '/api/v1/auth/register', {
      body: { email: 'curta@exemplo.com', password: '123' },
    });
    expect(resposta.status).toBe(400);
  });

  it('faz login com a senha certa e recusa a errada', async () => {
    await call('POST', '/api/v1/auth/register', {
      body: { email: 'login@exemplo.com', password: 'senha-forte-123' },
    });

    const ok = await call('POST', '/api/v1/auth/login', {
      body: { email: 'login@exemplo.com', password: 'senha-forte-123' },
    });
    expect(ok.status).toBe(200);

    const errada = await call('POST', '/api/v1/auth/login', {
      body: { email: 'login@exemplo.com', password: 'senha-errada-123' },
    });
    expect(errada.status).toBe(401);
  });

  it('não revela se o e-mail existe', async () => {
    await call('POST', '/api/v1/auth/register', {
      body: { email: 'existe@exemplo.com', password: 'senha-forte-123' },
    });
    const inexistente = await call('POST', '/api/v1/auth/login', {
      body: { email: 'naoexiste@exemplo.com', password: 'senha-forte-123' },
    });
    const senhaErrada = await call('POST', '/api/v1/auth/login', {
      body: { email: 'existe@exemplo.com', password: 'outra-senha-123' },
    });
    const m1 = ((await inexistente.json()) as never as { error: { message: string } }).error.message;
    const m2 = ((await senhaErrada.json()) as never as { error: { message: string } }).error.message;
    expect(m1).toBe(m2);
  });

  it('bloqueia rotas protegidas sem token', async () => {
    const resposta = await call('GET', '/api/v1/collections');
    expect(resposta.status).toBe(401);
  });

  it('bloqueia token inválido', async () => {
    const resposta = await call('GET', '/api/v1/collections', {
      token: 'token.invalido.aqui',
    });
    expect(resposta.status).toBe(401);
  });

  it('troca o refresh token e revoga o antigo', async () => {
    const conta = await criarConta();
    const nova = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: conta.refreshToken },
    });
    expect(nova.status).toBe(200);

    // o token antigo não serve mais (rotação)
    const reuso = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: conta.refreshToken },
    });
    expect(reuso.status).toBe(401);
  });

  it('logout revoga o refresh token', async () => {
    const conta = await criarConta();
    await call('POST', '/api/v1/auth/logout', {
      body: { refreshToken: conta.refreshToken },
    });
    const depois = await call('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: conta.refreshToken },
    });
    expect(depois.status).toBe(401);
  });

  it('/me devolve o usuário do token', async () => {
    const conta = await criarConta();
    const resposta = await call('GET', '/api/v1/auth/me', { token: conta.token });
    expect(resposta.status).toBe(200);
    const dados = (await resposta.json()) as { user: { id: string } };
    expect(dados.user.id).toBe(conta.userId);
  });
});
