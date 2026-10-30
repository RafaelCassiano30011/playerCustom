import { beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  criarColecao,
  criarConta,
  enviarArquivo,
  resetDb,
} from './helpers';

beforeEach(resetDb);

interface Relatorio {
  operationId: string;
  total: number;
  succeeded: number;
  failed: number;
  results: { id: string; ok: boolean; error?: string }[];
}

describe('operações em massa', () => {
  it('move vários arquivos entre coleções', async () => {
    const conta = await criarConta();
    const origem = await criarColecao(conta, 'Origem');
    const destino = await criarColecao(conta, 'Destino');
    const ids = [
      await enviarArquivo(conta, { fileName: 'a.mp4', collectionId: origem }),
      await enviarArquivo(conta, { fileName: 'b.mp4', collectionId: origem }),
      await enviarArquivo(conta, { fileName: 'c.mp4', collectionId: origem }),
    ];

    const resposta = await call('POST', '/api/v1/files/bulk/move', {
      token: conta.token,
      body: { fileIds: ids, toCollectionId: destino },
    });
    const relatorio = (await resposta.json()) as Relatorio;
    expect(relatorio.succeeded).toBe(3);
    expect(relatorio.failed).toBe(0);

    const naOrigem = await call('GET', `/api/v1/collections/${origem}`, {
      token: conta.token,
    });
    const noDestino = await call('GET', `/api/v1/collections/${destino}`, {
      token: conta.token,
    });
    expect(((await naOrigem.json()) as { fileCount: number }).fileCount).toBe(0);
    expect(((await noDestino.json()) as { fileCount: number }).fileCount).toBe(3);
  });

  it('relata os ids inválidos sem derrubar a operação', async () => {
    const conta = await criarConta();
    const destino = await criarColecao(conta, 'Destino');
    const valido = await enviarArquivo(conta);

    const resposta = await call('POST', '/api/v1/files/bulk/move', {
      token: conta.token,
      body: { fileIds: [valido, 'id-inexistente'], toCollectionId: destino },
    });
    const relatorio = (await resposta.json()) as Relatorio;
    expect(relatorio.total).toBe(2);
    expect(relatorio.succeeded).toBe(1);
    expect(relatorio.failed).toBe(1);
    const falha = relatorio.results.find((r) => !r.ok);
    expect(falha?.id).toBe('id-inexistente');
    expect(falha?.error).toBeTruthy();
  });

  // acervo compartilhado: mover arquivo enviado por outra conta é permitido
  it('move arquivo enviado por outra conta', async () => {
    const dono = await criarConta();
    const outra = await criarConta();
    const doDono = await enviarArquivo(dono);
    const destino = await criarColecao(outra, 'Minha');

    const resposta = await call('POST', '/api/v1/files/bulk/move', {
      token: outra.token,
      body: { fileIds: [doDono], toCollectionId: destino },
    });
    const relatorio = (await resposta.json()) as Relatorio;
    expect(relatorio.succeeded).toBe(1);
    expect(relatorio.failed).toBe(0);
  });

  it('reporta falha para id que não existe', async () => {
    const conta = await criarConta();
    const destino = await criarColecao(conta, 'Alvo');

    const resposta = await call('POST', '/api/v1/files/bulk/move', {
      token: conta.token,
      body: { fileIds: ['naoexiste'], toCollectionId: destino },
    });
    const relatorio = (await resposta.json()) as Relatorio;
    expect(relatorio.succeeded).toBe(0);
    expect(relatorio.failed).toBe(1);
  });

  it('adiciona vários a uma coleção (idempotente)', async () => {
    const conta = await criarConta();
    const colecao = await criarColecao(conta, 'Alvo');
    const ids = [
      await enviarArquivo(conta, { fileName: 'x.mp4' }),
      await enviarArquivo(conta, { fileName: 'y.mp4' }),
    ];

    for (let i = 0; i < 2; i++) {
      const resposta = await call('POST', '/api/v1/files/bulk/add-to-collection', {
        token: conta.token,
        body: { fileIds: ids, collectionId: colecao },
      });
      expect(((await resposta.json()) as Relatorio).succeeded).toBe(2);
    }

    const colecaoInfo = await call('GET', `/api/v1/collections/${colecao}`, {
      token: conta.token,
    });
    expect(((await colecaoInfo.json()) as { fileCount: number }).fileCount).toBe(2);
  });

  it('remove vários de uma coleção sem excluir os arquivos', async () => {
    const conta = await criarConta();
    const colecao = await criarColecao(conta, 'Saindo');
    const ids = [
      await enviarArquivo(conta, { fileName: 'm.mp4', collectionId: colecao }),
      await enviarArquivo(conta, { fileName: 'n.mp4', collectionId: colecao }),
    ];

    const resposta = await call(
      'POST',
      '/api/v1/files/bulk/remove-from-collection',
      { token: conta.token, body: { fileIds: ids, collectionId: colecao } },
    );
    expect(((await resposta.json()) as Relatorio).succeeded).toBe(2);

    for (const id of ids) {
      const arquivo = await call('GET', `/api/v1/files/${id}`, {
        token: conta.token,
      });
      expect(arquivo.status).toBe(200);
    }
  });

  it('exclui vários arquivos de vez', async () => {
    const conta = await criarConta();
    const ids = [
      await enviarArquivo(conta, { fileName: 'd1.mp4' }),
      await enviarArquivo(conta, { fileName: 'd2.mp4' }),
    ];

    const resposta = await call('POST', '/api/v1/files/bulk/delete', {
      token: conta.token,
      body: { fileIds: ids, confirm: true },
    });
    expect(((await resposta.json()) as Relatorio).succeeded).toBe(2);

    for (const id of ids) {
      const arquivo = await call('GET', `/api/v1/files/${id}`, {
        token: conta.token,
      });
      expect(arquivo.status).toBe(404);
    }
  });

  it('exclusão em massa exige confirmação explícita', async () => {
    const conta = await criarConta();
    const id = await enviarArquivo(conta);
    const resposta = await call('POST', '/api/v1/files/bulk/delete', {
      token: conta.token,
      body: { fileIds: [id] },
    });
    expect(resposta.status).toBe(400);
  });

  it('exclui várias coleções mantendo os arquivos', async () => {
    const conta = await criarConta();
    const a = await criarColecao(conta, 'A');
    const b = await criarColecao(conta, 'B');
    const fileId = await enviarArquivo(conta, { collectionId: a });

    const resposta = await call('POST', '/api/v1/collections/bulk/delete', {
      token: conta.token,
      body: { collectionIds: [a, b], confirm: true },
    });
    expect(((await resposta.json()) as Relatorio).succeeded).toBe(2);

    const arquivo = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(arquivo.status).toBe(200);
  });

  it('exclui coleções com deleteFiles e remove os arquivos órfãos', async () => {
    const conta = await criarConta();
    const a = await criarColecao(conta, 'Única');
    const fileId = await enviarArquivo(conta, { collectionId: a });

    await call('POST', '/api/v1/collections/bulk/delete', {
      token: conta.token,
      body: { collectionIds: [a], confirm: true, deleteFiles: true },
    });

    const arquivo = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(arquivo.status).toBe(404);
  });

  it('não apaga arquivo que ainda está em outra coleção', async () => {
    const conta = await criarConta();
    const a = await criarColecao(conta, 'A');
    const b = await criarColecao(conta, 'B');
    const fileId = await enviarArquivo(conta, { collectionId: a });
    await call('POST', `/api/v1/collections/${b}/files`, {
      token: conta.token,
      body: { fileIds: [fileId] },
    });

    await call('POST', '/api/v1/collections/bulk/delete', {
      token: conta.token,
      body: { collectionIds: [a], confirm: true, deleteFiles: true },
    });

    const arquivo = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(arquivo.status).toBe(200);
  });

  it('atualiza metadados de vários arquivos', async () => {
    const conta = await criarConta();
    const ids = [
      await enviarArquivo(conta, { fileName: 'u1.mp4' }),
      await enviarArquivo(conta, { fileName: 'u2.mp4' }),
    ];

    const resposta = await call('POST', '/api/v1/files/bulk/update', {
      token: conta.token,
      body: {
        items: ids.map((id, i) => ({
          id,
          originalName: `Episódio ${i + 1}.mp4`,
          metadata: { serie: 'Greed' },
        })),
      },
    });
    expect(((await resposta.json()) as Relatorio).succeeded).toBe(2);

    const arquivo = await call('GET', `/api/v1/files/${ids[0]}`, {
      token: conta.token,
    });
    const dados = (await arquivo.json()) as {
      originalName: string;
      metadata: { serie: string };
    };
    expect(dados.originalName).toBe('Episódio 1.mp4');
    expect(dados.metadata.serie).toBe('Greed');
  });

  it('guarda o relatório para consulta posterior', async () => {
    const conta = await criarConta();
    const destino = await criarColecao(conta, 'Destino');
    const id = await enviarArquivo(conta);

    const resposta = await call('POST', '/api/v1/files/bulk/move', {
      token: conta.token,
      body: { fileIds: [id], toCollectionId: destino },
    });
    const { operationId } = (await resposta.json()) as Relatorio;

    const consulta = await call('GET', `/api/v1/operations/${operationId}`, {
      token: conta.token,
    });
    expect(consulta.status).toBe(200);
    expect(((await consulta.json()) as Relatorio).succeeded).toBe(1);
  });

  it('recusa lista vazia', async () => {
    const conta = await criarConta();
    const destino = await criarColecao(conta, 'D');
    const resposta = await call('POST', '/api/v1/files/bulk/move', {
      token: conta.token,
      body: { fileIds: [], toCollectionId: destino },
    });
    expect(resposta.status).toBe(400);
  });
});
