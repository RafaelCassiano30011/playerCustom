# playerCustom

Player de vídeo inspirado no VLC e no Netflix, com biblioteca na nuvem.

| Pasta | O que é | Como rodar |
|---|---|---|
| [`desktop/`](desktop/) | app Electron + React + Vite (o player) | `cd desktop && npm install && npm run dev` |
| [`server/`](server/) | API em Cloudflare Workers (Hono + D1 + R2) | `cd server && npm install && npm run dev` |

Cada pasta é um pacote independente, com seu próprio `package.json` e suas
próprias dependências — **não existe workspace na raiz**. É de propósito: o
Electron e o `wrangler` querem versões e resoluções diferentes, e o hoisting de
um workspace quebraria o empacotamento do app (`asarUnpack` do `ffmpeg-static`
conta com o `node_modules` dentro de `desktop/`).

O `server/` exige **Node 18+** (o `wrangler` não roda em Node 14).

## Estado

- O player toca vídeo do disco local e **da nuvem**, por streaming ou por cópia
  baixada, e sincroniza o progresso com o servidor.
- O `server/` está **publicado** em
  `https://playercustom-api.player-d22.workers.dev` (conta Cloudflare Player),
  com D1 e R2 criados.
- Falta o app de Android TV.

## Biblioteca na nuvem

O `server/` guarda o catálogo no D1 e os arquivos no R2, e entrega os bytes por
link assinado (`/stream/:id?token=...`) para o player da TV poder dar seek sem
mandar header de autorização. Detalhes, endpoints e decisões estão em
[`server/README.md`](server/README.md).

### Como o player usa

Clique em **Entrar na nuvem**, no pé da barra lateral: você digita o e-mail e
recebe um código de 6 dígitos. Não existe senha no player. A sessão fica em
`cloud-session.json`, cifrada pelo `safeStorage` do sistema (DPAPI no Windows).

- **Enviar**: com a sessão ativa, o botão *Enviar para a nuvem* na barra de
  importação sobe os arquivos em partes de 64 MiB; a duração vai junto, lida
  pelo `ffprobe`.
- **Sincronizar**: a cada poucos minutos (ou no botão *Sincronizar*) o app
  espelha coleções, episódios, progresso e exclusões no `library.json` local.
  O arquivo local é a fonte de verdade da interface, então **nenhuma tela
  precisa de "modo offline"** — sem rede, só não entra nada novo.
- **Assistir por streaming**: o `<video>` carrega `media://cloud/<id>`. O
  processo principal pede o link assinado, busca os bytes e repassa o `Range`,
  então o token nunca chega ao renderer e o seek continua funcionando.
- **Assistir offline**: o botão de download grava o arquivo em
  `offline/` dentro do `userData`, retomando de onde parou se a rede cair. Com
  a cópia no disco, ela ganha do streaming mesmo com internet. *Remover cópia
  offline* apaga o arquivo e mantém o vídeo na nuvem.
- **Progresso**: cada posição é salva no `library.json` na hora e entra numa
  fila persistida. A fila sobe quando dá, e sobrevive a fechar o app. O
  servidor resolve conflito por `updatedAt` (last-write-wins); quando a posição
  remota é mais nova, o app adota a do servidor.

Streaming não lê faixas de áudio nem legendas embutidas: isso depende do
`ffprobe` abrindo o arquivo. Quem quiser trocar faixa ou extrair legenda baixa
o episódio.
