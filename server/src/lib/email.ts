import type { Env } from '../types';

/**
 * Envio de e-mail pelo Resend (HTTP, que é o que o runtime do Workers tem —
 * SMTP exigiria socket TCP).
 *
 * Sem `RESEND_API_KEY` configurada nada é enviado e o código vai para o log.
 * Isso é de propósito: em `wrangler dev` e nos testes não há provedor, e ficar
 * sem login nesse cenário atrapalharia mais que ajudaria. Em produção a chave
 * existe, então o caminho de verdade é o único usado.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendEmail(env: Env, mensagem: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email nao enviado: sem RESEND_API_KEY] ${mensagem.to}: ${mensagem.text}`);
    return false;
  }

  const resposta = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [mensagem.to],
      subject: mensagem.subject,
      text: mensagem.text,
      ...(mensagem.html ? { html: mensagem.html } : {}),
    }),
  });

  if (!resposta.ok) {
    // Falha de provedor não vira erro para quem pediu o código: a resposta da
    // API é sempre a mesma, para não contar quais e-mails existem.
    const corpo = await resposta.text();
    console.error(`[email] falha ${resposta.status}: ${corpo.slice(0, 300)}`);
    return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Template do e-mail de código
 *
 * Regras de e-mail, não de web: layout em <table>, estilo inline, largura
 * fixa de 600px e nenhuma imagem. Gmail e Outlook descartam flex, grid e boa
 * parte do <style>, então o que não está inline não existe. As cores são as
 * mesmas do app (`global.css`).
 * ------------------------------------------------------------------ */

const COR = {
  fundo: '#07090d',
  cartao: '#12151c',
  borda: '#262c38',
  texto: '#f5f7fa',
  textoFraco: '#b8c0cc',
  textoApagado: '#7c8698',
  destaque: '#e50914',
} as const;

const FONTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function corpoHtml(codigo: string, minutos: number): string {
  const espacado = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Seu código de acesso</title>
</head>
<body style="margin:0;padding:0;background:${COR.fundo};">
<!-- prévia na caixa de entrada: mostra o código antes de abrir -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${espacado} é o seu código de acesso ao playerCustom. Vale por ${minutos} minutos.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background:${COR.fundo};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
        style="width:100%;max-width:600px;">

        <tr>
          <td style="padding:0 8px 20px;font-family:${FONTE};font-size:18px;font-weight:700;color:${COR.texto};letter-spacing:-0.2px;">
            <span style="color:${COR.destaque};">▶</span>&nbsp; playerCustom
          </td>
        </tr>

        <tr>
          <td style="background:${COR.cartao};border:1px solid ${COR.borda};border-radius:16px;padding:40px 32px;">

            <p style="margin:0 0 8px;font-family:${FONTE};font-size:20px;font-weight:600;color:${COR.texto};">
              Seu código de acesso
            </p>
            <p style="margin:0 0 28px;font-family:${FONTE};font-size:14px;line-height:22px;color:${COR.textoFraco};">
              Digite no player para entrar. Não existe senha: este código é a sua chave.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center"
                  style="background:${COR.fundo};border:1px solid ${COR.borda};border-radius:12px;padding:24px 16px;">
                  <span style="font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:38px;font-weight:700;letter-spacing:10px;color:${COR.texto};">
                    ${codigo}
                  </span>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-family:${FONTE};font-size:13px;line-height:20px;color:${COR.textoApagado};">
              Vale por <strong style="color:${COR.textoFraco};">${minutos} minutos</strong> e só pode ser usado uma vez.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 8px 0;font-family:${FONTE};font-size:12px;line-height:19px;color:${COR.textoApagado};">
            Se não foi você que pediu, ignore este e-mail: sem o código ninguém entra na sua
            biblioteca. Nunca pedimos seu código por mensagem ou telefone.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Corpo do e-mail de código. O texto também traz o código, para quem lê sem HTML. */
export function loginCodeMessage(to: string, codigo: string, minutos: number): EmailMessage {
  return {
    to,
    subject: `${codigo} é o seu código de acesso`,
    text: [
      `Seu código de acesso ao playerCustom é ${codigo}.`,
      `Ele vale por ${minutos} minutos e só pode ser usado uma vez.`,
      '',
      'Se não foi você que pediu, ignore este e-mail: ninguém entra sem o código.',
    ].join('\n'),
    html: corpoHtml(codigo, minutos),
  };
}
