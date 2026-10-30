import { beforeEach, describe, expect, it } from 'vitest';
import { call, criarConta, enviarArquivo, env, resetDb } from './helpers';

/** Checagem pela propria API: acessar o R2 direto do teste trava no Windows. */
async function temCapa(token: string, fileId: string): Promise<boolean> {
  const r = await call('GET', `/api/v1/files/${fileId}/cover`, { token });
  return r.status === 200;
}

beforeEach(resetDb);

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

interface FileDTO {
  id: string;
  metadata: Record<string, unknown> | null;
  hasCover: boolean;
}

describe('capa do arquivo', () => {
  it('guarda a capa no R2 e nao no metadata', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    const put = await call('PUT', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
      raw: new Uint8Array([1, 2, 3, 4]),
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(put.status).toBe(200);

    const get = await call('GET', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
    });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    const meta = (await (
      await call('GET', `/api/v1/files/${fileId}`, { token: conta.token })
    ).json()) as FileDTO;
    expect(meta.hasCover).toBe(true);
  });

  it('sem capa responde 404', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    const get = await call('GET', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
    });
    expect(get.status).toBe(404);
  });

  it('apagar a capa tira o objeto e o flag', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    await call('PUT', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
      raw: new Uint8Array([9]),
      headers: { 'content-type': 'image/png' },
    });

    const del = await call('DELETE', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
    });
    expect(del.status).toBe(204);

    const meta = (await (
      await call('GET', `/api/v1/files/${fileId}`, { token: conta.token })
    ).json()) as FileDTO;
    expect(meta.hasCover).toBe(false);
    expect(await temCapa(conta.token, fileId)).toBe(false);
  });

  it('PATCH com coverDataUrl manda a capa para o R2 e limpa o metadata', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);

    const patch = await call('PATCH', `/api/v1/files/${fileId}`, {
      token: conta.token,
      body: { metadata: { author: 'Alguem', coverDataUrl: PNG_DATA_URL } },
    });
    expect(patch.status).toBe(200);
    const dados = (await patch.json()) as FileDTO;
    expect(dados.hasCover).toBe(true);
    expect(dados.metadata).toEqual({ author: 'Alguem' });

    const [linha] = (
      await env.DB.prepare('select metadata, cover_key from files where id = ?')
        .bind(fileId)
        .all()
    ).results as unknown as { metadata: string | null; cover_key: string | null }[];
    expect(linha.metadata).not.toContain('coverDataUrl');
    expect(linha.cover_key).toBe(`files/${fileId}/cover`);

    const capa = await call('GET', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
    });
    expect(capa.status).toBe(200);
    expect(capa.headers.get('content-type')).toBe('image/png');
  });

  it('listagem nao devolve capa em base64, so hasCover', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    // linha no formato antigo: capa gigante dentro do metadata
    const gigante = `data:image/png;base64,${'A'.repeat(20_000)}`;
    await env.DB.prepare('update files set metadata = ? where id = ?')
      .bind(JSON.stringify({ author: 'Antigo', coverDataUrl: gigante }), fileId)
      .run();

    const lista = await call('GET', '/api/v1/files?limit=10', {
      token: conta.token,
    });
    expect(lista.status).toBe(200);
    const corpo = await lista.text();
    expect(corpo).not.toContain('coverDataUrl');
    const { items } = JSON.parse(corpo) as { items: FileDTO[] };
    expect(items[0].hasCover).toBe(true);
  });

  it('migra as capas antigas do metadata para o R2', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    await env.DB.prepare('update files set metadata = ? where id = ?')
      .bind(
        JSON.stringify({ author: 'Antigo', coverDataUrl: PNG_DATA_URL }),
        fileId,
      )
      .run();

    const resposta = await call('POST', '/api/v1/files/cover-migration', {
      token: conta.token,
    });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      migradas: 1,
      falhas: 0,
      restantes: 0,
    });

    expect(await temCapa(conta.token, fileId)).toBe(true);
    const meta = (await (
      await call('GET', `/api/v1/files/${fileId}`, { token: conta.token })
    ).json()) as FileDTO;
    expect(meta.metadata).toEqual({ author: 'Antigo' });
    expect(meta.hasCover).toBe(true);
  });

  it('excluir o arquivo remove a capa do R2', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    await call('PUT', `/api/v1/files/${fileId}/cover`, {
      token: conta.token,
      raw: new Uint8Array([7]),
      headers: { 'content-type': 'image/png' },
    });

    const del = await call('DELETE', `/api/v1/files/${fileId}`, {
      token: conta.token,
    });
    expect(del.status).toBe(204);
    // arquivo apagado: nem o registro nem a capa continuam acessiveis
    expect(await temCapa(conta.token, fileId)).toBe(false);
  });
});
