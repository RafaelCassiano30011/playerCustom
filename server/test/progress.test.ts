import { beforeEach, describe, expect, it } from 'vitest';
import { call, criarConta, enviarArquivo, resetDb } from './helpers';

beforeEach(resetDb);

interface ProgressDTO {
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
  applied?: boolean;
}

async function salvar(
  token: string,
  fileId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; dados: ProgressDTO }> {
  const r = await call('PUT', `/api/v1/progress/${fileId}`, { token, body });
  return { status: r.status, dados: (await r.json()) as ProgressDTO };
}

describe('progresso de reproducao', () => {
  it('grava e le a posicao', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    const { status, dados } = await salvar(conta.token, fileId, {
      positionSeconds: 90,
      durationSeconds: 1800,
      audioTrack: 'jpn',
      subtitleTrack: 'por',
      playbackRate: 1.25,
      updatedAt: 1000,
    });
    expect(status).toBe(200);
    expect(dados.applied).toBe(true);
    expect(dados.positionSeconds).toBe(90);

    const lido = (await (
      await call('GET', `/api/v1/progress/${fileId}`, { token: conta.token })
    ).json()) as ProgressDTO;
    expect(lido.positionSeconds).toBe(90);
    expect(lido.durationSeconds).toBe(1800);
    // fracao deriva de posicao/duracao quando nao vem no corpo
    expect(lido.fraction).toBeCloseTo(0.05, 4);
    expect(lido.audioTrack).toBe('jpn');
    expect(lido.subtitleTrack).toBe('por');
    expect(lido.playbackRate).toBe(1.25);
    expect(lido.completed).toBe(0);
    expect(lido.updatedAt).toBe(1000);
  });

  it('mescla campos: salvar so a posicao nao apaga o resto', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    await salvar(conta.token, fileId, {
      subtitleTrack: 'por',
      playbackRate: 2,
      updatedAt: 1000,
    });
    const { dados } = await salvar(conta.token, fileId, {
      positionSeconds: 42,
      updatedAt: 2000,
    });
    expect(dados.subtitleTrack).toBe('por');
    expect(dados.playbackRate).toBe(2);
    expect(dados.positionSeconds).toBe(42);
  });

  it('marca completed quando passa de 95% da duracao', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    const { dados } = await salvar(conta.token, fileId, {
      positionSeconds: 1750,
      durationSeconds: 1800,
      updatedAt: 1000,
    });
    expect(dados.completed).toBe(1);
  });

  it('last-write-wins: escrita antiga e ignorada', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    await salvar(conta.token, fileId, { positionSeconds: 40, updatedAt: 5000 });
    // aparelho com relogio atrasado nao pode rebobinar o que o outro assistiu
    const velha = await salvar(conta.token, fileId, { positionSeconds: 3, updatedAt: 4000 });
    expect(velha.status).toBe(200);
    expect(velha.dados.applied).toBe(false);
    expect(velha.dados.positionSeconds).toBe(40);

    const lido = (await (
      await call('GET', `/api/v1/progress/${fileId}`, { token: conta.token })
    ).json()) as ProgressDTO;
    expect(lido.positionSeconds).toBe(40);
  });

  it('o progresso e compartilhado entre contas', async () => {
    const dono = await criarConta();
    const outra = await criarConta();
    const fileId = await enviarArquivo(dono);

    await salvar(dono.token, fileId, { positionSeconds: 40, updatedAt: 1000 });

    const vista = (await (
      await call('GET', `/api/v1/progress/${fileId}`, { token: outra.token })
    ).json()) as ProgressDTO;
    expect(vista.positionSeconds).toBe(40);

    // e a outra conta tambem pode avancar a posicao
    const avanco = await salvar(outra.token, fileId, { positionSeconds: 41, updatedAt: 2000 });
    expect(avanco.dados.positionSeconds).toBe(41);
  });

  it('lista ordenada pela posicao mais recente', async () => {
    const conta = await criarConta();
    const a = await enviarArquivo(conta, { fileName: 'a.mp4' });
    const b = await enviarArquivo(conta, { fileName: 'b.mp4' });

    await salvar(conta.token, a, { positionSeconds: 1, updatedAt: 1000 });
    await salvar(conta.token, b, { positionSeconds: 2, updatedAt: 2000 });

    const lista = (await (
      await call('GET', '/api/v1/progress', { token: conta.token })
    ).json()) as { items: ProgressDTO[] };
    expect(lista.items.map((x) => x.fileId)).toEqual([b, a]);
  });

  it('/last segue o ultimo aberto, nao a posicao mais recente', async () => {
    const conta = await criarConta();
    const a = await enviarArquivo(conta, { fileName: 'a.mp4' });
    const b = await enviarArquivo(conta, { fileName: 'b.mp4' });

    // abre A depois de B: A e o "continuar assistindo"
    await call('POST', `/api/v1/progress/${b}/opened`, { token: conta.token });
    await call('POST', `/api/v1/progress/${a}/opened`, { token: conta.token });
    // ...mesmo que a posicao de B seja gravada depois
    await salvar(conta.token, b, { positionSeconds: 99, updatedAt: Date.now() + 10_000 });

    const resposta = (await (
      await call('GET', '/api/v1/progress/last', { token: conta.token })
    ).json()) as { progress: ProgressDTO | null };
    expect(resposta.progress?.fileId).toBe(a);
  });

  it('salvar posicao nao mexe no ultimo aberto', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    const aberto = (await (
      await call('POST', `/api/v1/progress/${fileId}/opened`, { token: conta.token })
    ).json()) as ProgressDTO;
    const { dados } = await salvar(conta.token, fileId, {
      positionSeconds: 7,
      updatedAt: aberto.openedAt + 60_000,
    });
    expect(dados.openedAt).toBe(aberto.openedAt);
  });

  it('excluir o arquivo apaga o progresso', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    await salvar(conta.token, fileId, { positionSeconds: 10, updatedAt: 1000 });

    const del = await call('DELETE', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(del.ok).toBe(true);

    const depois = await call('GET', `/api/v1/progress/${fileId}`, {
      token: conta.token,
    });
    expect(depois.status).toBe(404);

    const lista = (await (
      await call('GET', '/api/v1/progress', { token: conta.token })
    ).json()) as { items: ProgressDTO[] };
    expect(lista.items).toHaveLength(0);
  });

  it('recusa progresso de arquivo inexistente', async () => {
    const conta = await criarConta();
    const r = await call('PUT', '/api/v1/progress/nao-existe', {
      token: conta.token,
      body: { positionSeconds: 1 },
    });
    expect(r.status).toBe(404);
  });

  it('exige autenticacao', async () => {
    const r = await call('GET', '/api/v1/progress');
    expect(r.status).toBe(401);
  });

  it('/sync/changes traz o progresso alterado', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    await salvar(conta.token, fileId, { positionSeconds: 3, updatedAt: Date.now() });

    const sync = (await (
      await call('GET', '/api/v1/sync/changes?since=0', { token: conta.token })
    ).json()) as { progress: ProgressDTO[] };
    expect(sync.progress.map((x) => x.fileId)).toContain(fileId);
  });
});
