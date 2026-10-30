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

- O player lê os vídeos do disco local (`desktop/src/main/services/file.service.ts`).
- O `server/` está **publicado** em
  `https://playercustom-api.player-d22.workers.dev` (conta Cloudflare Player),
  com D1 e R2 criados e o fluxo de upload/streaming testado de ponta a ponta.
- **O player ainda não fala com ele**: falta o cliente de API no `main` (upload
  com `ffprobe`, catálogo, progresso) e o app de Android TV.

## Biblioteca na nuvem

O `server/` guarda o catálogo no D1 e os arquivos no R2, e entrega os bytes por
link assinado (`/stream/:id?token=...`) para o player da TV poder dar seek sem
mandar header de autorização. Detalhes, endpoints e decisões estão em
[`server/README.md`](server/README.md).
