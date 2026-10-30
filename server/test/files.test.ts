import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  criarColecao,
  criarConta,
  enviarArquivo,
  mkvBytes,
  mp4Bytes,
  resetDb,
} from './helpers';

beforeEach(resetDb);

describe('upload e arquivos', () => {
  it('faz o ciclo completo: init, envio, conclusão', async () => {
    const conta = await criarConta();
    const bytes = mp4Bytes(4096);

    const init = await call('POST', '/api/v1/files/uploads', {
      token: conta.token,
      body: { fileName: 'episodio.mp4', sizeBytes: bytes.byteLength },
    });
    expect(init.status).toBe(201);
    const { uploadId, fileId, strategy } = (await init.json()) as {
      uploadId: string;
      fileId: string;
      strategy: string;
    };
    expect(strategy).toBe('single');

    const put = await call('PUT', `/api/v1/files/uploads/${uploadId}/content`, {
      token: conta.token,
      raw: bytes,
    });
    expect(put.status).toBe(200);

    const done = await call(
      'POST',
      `/api/v1/files/uploads/${uploadId}/complete`,
      { token: conta.token },
    );
    expect(done.status).toBe(200);
    expect(((await done.json()) as { sizeBytes: number }).sizeBytes).toBe(
      bytes.byteLength,
    );

    const meta = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(meta.status).toBe(200);
    const dados = (await meta.json()) as { status: string; format: string };
    expect(dados.status).toBe('ready');
    expect(dados.format).toBe('mp4');
  });

  it('concluir duas vezes é seguro (idempotente)', async () => {
    const conta = await criarConta();
    const bytes = mp4Bytes();
    const init = await call('POST', '/api/v1/files/uploads', {
      token: conta.token,
      body: { fileName: 'a.mp4', sizeBytes: bytes.byteLength },
    });
    const { uploadId } = (await init.json()) as { uploadId: string };
    await call('PUT', `/api/v1/files/uploads/${uploadId}/content`, {
      token: conta.token,
      raw: bytes,
    });
    const p1 = await call('POST', `/api/v1/files/uploads/${uploadId}/complete`, {
      token: conta.token,
    });
    const p2 = await call('POST', `/api/v1/files/uploads/${uploadId}/complete`, {
      token: conta.token,
    });
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(await p1.json()).toEqual(await p2.json());
  });

  it('recusa extensão não suportada', async () => {
    const conta = await criarConta();
    const resposta = await call('POST', '/api/v1/files/uploads', {
      token: conta.token,
      body: { fileName: 'virus.exe', sizeBytes: 100 },
    });
    expect(resposta.status).toBe(415);
  });

  it('recusa MIME que não combina com a extensão', async () => {
    const conta = await criarConta();
    const resposta = await call('POST', '/api/v1/files/uploads', {
      token: conta.token,
      body: { fileName: 'a.mp4', sizeBytes: 100, mimeType: 'image/png' },
    });
    expect(resposta.status).toBe(415);
  });

  it('recusa conteúdo que não bate com o formato', async () => {
    const conta = await criarConta();
    // diz que é MP4 mas manda bytes de Matroska
    const init = await call('POST', '/api/v1/files/uploads', {
      token: conta.token,
      body: { fileName: 'falso.mp4', sizeBytes: 2048 },
    });
    const { uploadId } = (await init.json()) as { uploadId: string };
    const put = await call('PUT', `/api/v1/files/uploads/${uploadId}/content`, {
      token: conta.token,
      raw: mkvBytes(2048),
    });
    expect(put.status).toBe(415);
  });

  it('recusa tamanho divergente na conclusão', async () => {
    const conta = await criarConta();
    const init = await call('POST', '/api/v1/files/uploads', {
      token: conta.token,
      body: { fileName: 'b.mp4', sizeBytes: 9999 },
    });
    const { uploadId } = (await init.json()) as { uploadId: string };
    await call('PUT', `/api/v1/files/uploads/${uploadId}/content`, {
      token: conta.token,
      raw: mp4Bytes(2048),
    });
    const done = await call(
      'POST',
      `/api/v1/files/uploads/${uploadId}/complete`,
      { token: conta.token },
    );
    expect(done.status).toBe(409);
  });

  it('aceita MKV e WebM (conteúdo EBML)', async () => {
    const conta = await criarConta();
    for (const nome of ['episodio.mkv', 'clipe.webm']) {
      const id = await enviarArquivo(conta, {
        fileName: nome,
        bytes: mkvBytes(1024),
      });
      const meta = await call('GET', `/api/v1/files/${id}`, {
        token: conta.token,
      });
      expect(meta.status).toBe(200);
    }
  });

  it('baixa o conteúdo e respeita Range', async () => {
    const conta = await criarConta();
    const bytes = mp4Bytes(5000);
    const fileId = await enviarArquivo(conta, { bytes });

    const inteiro = await call('GET', `/api/v1/files/${fileId}/content`, {
      token: conta.token,
    });
    expect(inteiro.status).toBe(200);
    expect(inteiro.headers.get('Accept-Ranges')).toBe('bytes');
    expect((await inteiro.arrayBuffer()).byteLength).toBe(5000);

    const parcial = await call('GET', `/api/v1/files/${fileId}/content`, {
      token: conta.token,
      headers: { Range: 'bytes=0-99' },
    });
    expect(parcial.status).toBe(206);
    expect(parcial.headers.get('Content-Range')).toBe('bytes 0-99/5000');
    expect((await parcial.arrayBuffer()).byteLength).toBe(100);
  });

  it('verifica integridade do objeto', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    const resposta = await call('GET', `/api/v1/files/${fileId}/verify`, {
      token: conta.token,
    });
    expect(await resposta.json()).toMatchObject({
      exists: true,
      sizeMatches: true,
    });
  });

  it('renomeia e grava metadados', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    const resposta = await call('PATCH', `/api/v1/files/${fileId}`, {
      token: conta.token,
      body: { originalName: 'Novo nome.mp4', metadata: { serie: 'Alguma' } },
    });
    expect(resposta.status).toBe(200);
    const dados = (await resposta.json()) as {
      originalName: string;
      metadata: { serie: string };
    };
    expect(dados.originalName).toBe('Novo nome.mp4');
    expect(dados.metadata.serie).toBe('Alguma');
  });

  it('grava os dados tecnicos do ffprobe', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    const resposta = await call('PATCH', `/api/v1/files/${fileId}`, {
      token: conta.token,
      body: {
        durationSeconds: 1432.5,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
      },
    });
    expect(resposta.status).toBe(200);
    const dados = (await resposta.json()) as {
      durationSeconds: number;
      width: number;
      height: number;
      videoCodec: string;
      audioCodec: string;
    };
    expect(dados.durationSeconds).toBe(1432.5);
    expect(dados.width).toBe(1920);
    expect(dados.height).toBe(1080);
    expect(dados.videoCodec).toBe('h264');
    expect(dados.audioCodec).toBe('aac');
  });

  it('exclui o arquivo e some da listagem', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    const del = await call('DELETE', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(del.status).toBe(204);

    const depois = await call('GET', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(depois.status).toBe(404);
  });

  it('já entra na coleção quando o upload informa collectionId', async () => {
    const conta = await criarConta();
    const colecaoId = await criarColecao(conta, 'Mangás');
    const fileId = await enviarArquivo(conta, { collectionId: colecaoId });

    const lista = await call(
      'GET',
      `/api/v1/collections/${colecaoId}/files`,
      { token: conta.token },
    );
    const dados = (await lista.json()) as { items: { id: string }[] };
    expect(dados.items.map((i) => i.id)).toContain(fileId);
  });

  it('arquivo inexistente devolve 404', async () => {
    const conta = await criarConta();
    const resposta = await call('GET', '/api/v1/files/nao-existe', {
      token: conta.token,
    });
    expect(resposta.status).toBe(404);
  });
});

/**
 * A biblioteca é compartilhada entre as contas de propósito (ver
 * `requireOwned` em file-service/collection-service, que só confere se o
 * registro existe). Estes testes fixam esse contrato: qualquer conta
 * autenticada lê e administra o acervo. Se voltar a ser por dono, o filtro
 * tem de voltar nos services e estes testes mudam junto.
 */
describe('biblioteca compartilhada entre contas', () => {
  it('outra conta acessa o arquivo', async () => {
    const dono = await criarConta();
    const outra = await criarConta();
    const fileId = await enviarArquivo(dono);

    for (const caminho of [
      `/api/v1/files/${fileId}`,
      `/api/v1/files/${fileId}/content`,
      `/api/v1/files/${fileId}/verify`,
    ]) {
      const resposta = await call('GET', caminho, { token: outra.token });
      expect(resposta.status).toBe(200);
    }
  });

  it('outra conta apaga o arquivo do acervo', async () => {
    const dono = await criarConta();
    const outra = await criarConta();
    const fileId = await enviarArquivo(dono);

    const del = await call('DELETE', `/api/v1/files/${fileId}`, {
      token: outra.token,
    });
    expect(del.status).toBe(204);

    // saiu do acervo para todo mundo, inclusive para quem enviou
    const depois = await call('GET', `/api/v1/files/${fileId}`, {
      token: dono.token,
    });
    expect(depois.status).toBe(404);
  });

  it('outra conta vê a coleção', async () => {
    const dono = await criarConta();
    const outra = await criarConta();
    const colecaoId = await criarColecao(dono, 'Compartilhada');

    const resposta = await call('GET', `/api/v1/collections/${colecaoId}`, {
      token: outra.token,
    });
    expect(resposta.status).toBe(200);
  });
  it('pagina com mais de 100 arquivos nao estoura o limite de variaveis do D1', async () => {
    const conta = await criarConta();
    const colecaoId = await criarColecao(conta, 'Grande');
    const agora = Date.now();

    for (let i = 0; i < 120; i++) {
      const id = `arq-${i}`;
      await env.DB.prepare(
        `insert into files (id, user_id, original_name, storage_name, format, mime_type, size_bytes, r2_key, status, created_at, updated_at)
         values (?, ?, ?, ?, 'mp4', 'video/mp4', 10, ?, 'ready', ?, ?)`,
      )
        .bind(id, conta.userId, `episodio-${i}.mp4`, `episodio-${i}.mp4`, `files/${id}`, agora, agora + i)
        .run();
      await env.DB.prepare(
        'insert into collection_files (collection_id, file_id, position, added_at) values (?, ?, 0, ?)',
      )
        .bind(colecaoId, id, agora)
        .run();
    }

    const resposta = await call('GET', '/api/v1/files?limit=200', {
      token: conta.token,
    });
    expect(resposta.status).toBe(200);
    const dados = (await resposta.json()) as {
      items: { collectionIds: string[] }[];
    };
    expect(dados.items).toHaveLength(120);
    expect(
      dados.items.every((f) => f.collectionIds.includes(colecaoId)),
    ).toBe(true);
  });
});
