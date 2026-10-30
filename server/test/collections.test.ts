import { beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  criarColecao,
  criarConta,
  enviarArquivo,
  resetDb,
} from './helpers';

beforeEach(resetDb);

describe('coleções', () => {
  it('cria, lê, renomeia e lista', async () => {
    const conta = await criarConta();

    const criada = await call('POST', '/api/v1/collections', {
      token: conta.token,
      body: { name: 'Mangás', description: 'Minha estante' },
    });
    expect(criada.status).toBe(201);
    const { id } = (await criada.json()) as { id: string };

    const lida = await call('GET', `/api/v1/collections/${id}`, {
      token: conta.token,
    });
    expect((await lida.json()) as unknown).toMatchObject({
      name: 'Mangás',
      description: 'Minha estante',
      fileCount: 0,
    });

    const renomeada = await call('PATCH', `/api/v1/collections/${id}`, {
      token: conta.token,
      body: { name: 'Mangás favoritos' },
    });
    expect(((await renomeada.json()) as { name: string }).name).toBe(
      'Mangás favoritos',
    );

    const lista = await call('GET', '/api/v1/collections', {
      token: conta.token,
    });
    const dados = (await lista.json()) as { items: { id: string }[] };
    expect(dados.items).toHaveLength(1);
  });

  it('recusa nome repetido do mesmo usuário', async () => {
    const conta = await criarConta();
    await criarColecao(conta, 'Repetida');
    const segunda = await call('POST', '/api/v1/collections', {
      token: conta.token,
      body: { name: 'Repetida' },
    });
    expect(segunda.status).toBe(409);
  });

  it('usuários diferentes podem usar o mesmo nome', async () => {
    const a = await criarConta();
    const b = await criarConta();
    await criarColecao(a, 'Mangás');
    const outra = await call('POST', '/api/v1/collections', {
      token: b.token,
      body: { name: 'Mangás' },
    });
    expect(outra.status).toBe(201);
  });

  it('adiciona e remove arquivos sem excluir o arquivo', async () => {
    const conta = await criarConta();
    const colecaoId = await criarColecao(conta, 'Leitura');
    const fileId = await enviarArquivo(conta);

    const add = await call('POST', `/api/v1/collections/${colecaoId}/files`, {
      token: conta.token,
      body: { fileIds: [fileId] },
    });
    expect(((await add.json()) as { added: string[] }).added).toEqual([fileId]);

    const comArquivo = await call('GET', `/api/v1/collections/${colecaoId}`, {
      token: conta.token,
    });
    expect(((await comArquivo.json()) as { fileCount: number }).fileCount).toBe(1);

    const del = await call(
      'DELETE',
      `/api/v1/collections/${colecaoId}/files/${fileId}`,
      { token: conta.token },
    );
    expect(((await del.json()) as { removed: number }).removed).toBe(1);

    // o arquivo continua na biblioteca
    const ainda = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(ainda.status).toBe(200);
  });

  it('adicionar duas vezes não duplica', async () => {
    const conta = await criarConta();
    const colecaoId = await criarColecao(conta, 'Dupla');
    const fileId = await enviarArquivo(conta);

    await call('POST', `/api/v1/collections/${colecaoId}/files`, {
      token: conta.token,
      body: { fileIds: [fileId] },
    });
    const segunda = await call('POST', `/api/v1/collections/${colecaoId}/files`, {
      token: conta.token,
      body: { fileIds: [fileId] },
    });
    expect(((await segunda.json()) as { added: string[] }).added).toEqual([]);

    const colecao = await call('GET', `/api/v1/collections/${colecaoId}`, {
      token: conta.token,
    });
    expect(((await colecao.json()) as { fileCount: number }).fileCount).toBe(1);
  });

  it('um arquivo pode estar em várias coleções', async () => {
    const conta = await criarConta();
    const a = await criarColecao(conta, 'A');
    const b = await criarColecao(conta, 'B');
    const fileId = await enviarArquivo(conta);

    for (const colecaoId of [a, b]) {
      await call('POST', `/api/v1/collections/${colecaoId}/files`, {
        token: conta.token,
        body: { fileIds: [fileId] },
      });
    }

    const arquivo = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    const dados = (await arquivo.json()) as { collectionIds: string[] };
    expect(dados.collectionIds.sort()).toEqual([a, b].sort());
  });

  it('excluir coleção mantém os arquivos por padrão', async () => {
    const conta = await criarConta();
    const colecaoId = await criarColecao(conta, 'Temporária');
    const fileId = await enviarArquivo(conta, { collectionId: colecaoId });

    const del = await call('DELETE', `/api/v1/collections/${colecaoId}`, {
      token: conta.token,
    });
    expect(del.status).toBe(200);

    const arquivo = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(arquivo.status).toBe(200);
  });

  it('excluir coleção com deleteFiles=true apaga os arquivos', async () => {
    const conta = await criarConta();
    const colecaoId = await criarColecao(conta, 'Some tudo');
    const fileId = await enviarArquivo(conta, { collectionId: colecaoId });

    const del = await call(
      'DELETE',
      `/api/v1/collections/${colecaoId}?deleteFiles=true`,
      { token: conta.token },
    );
    expect(del.status).toBe(200);

    const arquivo = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(arquivo.status).toBe(404);
  });

  it('pagina com cursor sem repetir itens', async () => {
    const conta = await criarConta();
    for (let i = 0; i < 5; i++) {
      await criarColecao(conta, `Coleção ${i}`);
    }

    const pagina1 = await call('GET', '/api/v1/collections?limit=2', {
      token: conta.token,
    });
    const d1 = (await pagina1.json()) as {
      items: { id: string }[];
      nextCursor?: string;
    };
    expect(d1.items).toHaveLength(2);
    expect(d1.nextCursor).toBeTruthy();

    const pagina2 = await call(
      `GET`,
      `/api/v1/collections?limit=2&cursor=${encodeURIComponent(d1.nextCursor!)}`,
      { token: conta.token },
    );
    const d2 = (await pagina2.json()) as { items: { id: string }[] };
    expect(d2.items).toHaveLength(2);

    const ids = [...d1.items, ...d2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('busca pelo nome', async () => {
    const conta = await criarConta();
    await criarColecao(conta, 'Berserk');
    await criarColecao(conta, 'Vagabond');

    const resposta = await call('GET', '/api/v1/collections?q=Bers', {
      token: conta.token,
    });
    const dados = (await resposta.json()) as { items: { name: string }[] };
    expect(dados.items).toHaveLength(1);
    expect(dados.items[0].name).toBe('Berserk');
  });

  it('coleção inexistente devolve 404', async () => {
    const conta = await criarConta();
    const resposta = await call('GET', '/api/v1/collections/nao-existe', {
      token: conta.token,
    });
    expect(resposta.status).toBe(404);
  });
});
