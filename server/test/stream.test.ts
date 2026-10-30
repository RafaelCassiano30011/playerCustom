import { beforeEach, describe, expect, it } from 'vitest';
import { call, criarConta, enviarArquivo, mp4Bytes, resetDb } from './helpers';

beforeEach(resetDb);

interface LinkDTO {
  url: string;
  expiresAt: number;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

/** Tira o caminho + query da URL absoluta devolvida pela API. */
function caminhoDe(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

describe('link assinado de streaming', () => {
  it('emite link que serve o video sem header de autorizacao', async () => {
    const conta = await criarConta();
    const bytes = mp4Bytes(5000);
    const fileId = await enviarArquivo(conta, { bytes });

    const resposta = await call('GET', `/api/v1/files/${fileId}/stream`, {
      token: conta.token,
    });
    expect(resposta.status).toBe(200);
    const link = (await resposta.json()) as LinkDTO;
    expect(link.mimeType).toBe('video/mp4');
    expect(link.sizeBytes).toBe(5000);
    expect(link.expiresAt * 1000).toBeGreaterThan(Date.now());

    // sem token de acesso: a autorizacao esta na URL
    const bruto = await call('GET', caminhoDe(link.url));
    expect(bruto.status).toBe(200);
    expect((await bruto.arrayBuffer()).byteLength).toBe(5000);
  });

  it('respeita Range no link assinado', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta, { bytes: mp4Bytes(5000) });
    const link = (await (
      await call('GET', `/api/v1/files/${fileId}/stream`, { token: conta.token })
    ).json()) as LinkDTO;

    const parcial = await call('GET', caminhoDe(link.url), {
      headers: { Range: 'bytes=0-99' },
    });
    expect(parcial.status).toBe(206);
    expect(parcial.headers.get('Content-Range')).toBe('bytes 0-99/5000');
    expect((await parcial.arrayBuffer()).byteLength).toBe(100);
  });

  it('recusa link sem token, com assinatura quebrada ou de outro video', async () => {
    const conta = await criarConta();
    const a = await enviarArquivo(conta, { fileName: 'a.mp4' });
    const b = await enviarArquivo(conta, { fileName: 'b.mp4' });
    const link = (await (
      await call('GET', `/api/v1/files/${a}/stream`, { token: conta.token })
    ).json()) as LinkDTO;
    const token = new URL(link.url).searchParams.get('token')!;

    expect((await call('GET', `/stream/${a}`)).status).toBe(401);
    expect(
      (await call('GET', `/stream/${a}?token=${token}xyz`)).status,
    ).toBe(401);
    // token de A na URL de B: o id assinado nao bate
    expect((await call('GET', `/stream/${b}?token=${token}`)).status).toBe(403);
  });

  it('recusa token com prazo adulterado', async () => {
    const conta = await criarConta();
    const fileId = await enviarArquivo(conta);
    const link = (await (
      await call('GET', `/api/v1/files/${fileId}/stream`, { token: conta.token })
    ).json()) as LinkDTO;
    const token = new URL(link.url).searchParams.get('token')!;
    // esticar o prazo sem a chave invalida a assinatura
    const [id, , assinatura] = token.split('.');
    const adulterado = `${id}.${Math.floor(Date.now() / 1000) + 999_999}.${assinatura}`;

    const r = await call('GET', `/stream/${fileId}?token=${adulterado}`);
    expect(r.status).toBe(401);
  });
});
