# playerCustom API — Cloudflare Workers

Backend da biblioteca de vídeos do playerCustom. Roda inteiro na Cloudflare:
**Workers** (API), **D1** (catálogo) e **R2** (os arquivos de vídeo). Serve o
app Electron e o app de Android TV — o armazenamento local vira só cache.

Nasceu do backend do `leitorManga` (mesmo desenho de coleções, upload e
sincronização), adaptado para vídeo: formatos de container, arquivos de dezenas
de GiB, progresso em segundos e link assinado de streaming.

- Entrada única: `src/server.ts`, exportando `fetch` e `scheduled`.
- Rotas versionadas sob `/api/v1`; a entrega dos bytes fica em `/stream/:id`.

## Infraestrutura em produção

| O quê | Valor |
|---|---|
| Worker | `https://playercustom-api.player-d22.workers.dev` |
| Conta Cloudflare | **Player** — `d2200e72a8e5b8bb5da8c45c3137329d` |
| D1 | `playercustom-db` — `c02baad9-924b-48a1-86ea-91b66b1ac101` |
| R2 | `playercustom-videos` |
| Secret | `JWT_SECRET` (gravado; trocar invalida todos os tokens) |

O `account_id` no `wrangler.jsonc` **vence** a variável de ambiente
`CLOUDFLARE_ACCOUNT_ID` — mudar de conta é editar o arquivo, não exportar a
variável.

## Decisões de modelagem

- **Coleção é a série/temporada**: `collection_files.position` ordena os
  episódios. Um vídeo pode estar em várias coleções.
  - *Remover de uma coleção* apaga só o vínculo; o arquivo continua na biblioteca.
  - *Excluir o arquivo* remove o objeto do R2 e todos os vínculos.
  - Excluir uma coleção **não** apaga os arquivos, a menos que o cliente peça
    `deleteFiles=true` — e aí só somem os que ficariam sem nenhuma coleção.
- **Exclusão em etapas**: D1 e R2 não compartilham transação. O registro vira
  `deleting`, a chave entra em `pending_deletions` e o objeto é apagado em
  seguida. O que falhar fica na fila e o cron tenta de novo — nunca sobra
  registro inconsistente nem objeto órfão silencioso.
- **Progresso de reprodução compartilhado**: `playback_progress` tem uma linha
  por vídeo e **não tem `user_id`** — o acervo já é compartilhado entre as
  contas, e a posição acompanha. Quem para no minuto 12 na TV continua no 12 no
  desktop. Conflito entre aparelhos se resolve por *last-write-wins* no
  `updatedAt` que o cliente manda.
- **Os bytes não passam por rota autenticada na TV**: o ExoPlayer não manda
  `Authorization` em cada requisição de `Range`, então a autorização vai na URL
  (`/stream/:id?token=...`). Ver *Streaming assinado*.
- **Senhas**: PBKDF2-SHA256 (210k iterações) via WebCrypto.
  **Tokens**: JWT HS256 (`jose`) de curta duração + refresh token opaco guardado
  como hash no D1, com rotação a cada uso.

## Instalação

```bash
cd server
npm install
```

## Criar a infraestrutura

```bash
export CLOUDFLARE_ACCOUNT_ID=57964aef3587dfe59a991889a76fb711

# 1) Banco D1 — copie o database_id para o wrangler.jsonc (hoje "REPLACE_ME")
wrangler d1 create playercustom-db
# copie o database_id para "d1_databases" no wrangler.jsonc

# 2) Bucket R2 — exige R2 habilitado no painel antes (aceite dos termos)
#    https://dash.cloudflare.com/?to=/:account/r2
wrangler r2 bucket create playercustom-videos

# 3) Migrations
npm run db:migrate:local     # banco local de desenvolvimento
npm run db:migrate:remote    # produção

# 4) Secret de assinatura dos tokens
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
wrangler secret put JWT_SECRET
```

## Desenvolvimento e publicação

```bash
npm run dev         # http://localhost:8787
npm run typecheck
npm test            # 76 testes com D1 e R2 reais (miniflare)
npm run deploy      # publica o Worker
```

Depois de mudar `src/db/schema.ts`:

```bash
npm run db:generate          # gera a migration
npm run db:migrate:remote    # aplica
```

## Configuração

Em `vars` (wrangler.jsonc) — troque sem mexer no código:

| Variável | Para que serve |
|---|---|
| `APP_ORIGIN` | origem principal da aplicação |
| `CORS_ORIGINS` | origens liberadas, separadas por vírgula |
| `MAX_FILE_BYTES` | tamanho máximo por vídeo (padrão 20 GiB) |
| `ACCESS_TOKEN_TTL_SECONDS` | validade do access token (padrão 900) |
| `REFRESH_TOKEN_TTL_SECONDS` | validade do refresh token (padrão 30 dias) |
| `STREAM_TOKEN_TTL_SECONDS` | validade do link assinado de vídeo (padrão 6 h) |

Bindings: `DB` (D1) e `FILES_BUCKET` (R2). Secret: `JWT_SECRET`.

O CORS valida a origem contra a lista — **nunca** devolve `*`. Origem
desconhecida recebe 403 no preflight.

## Endpoints

Todas as respostas são JSON. Erros seguem
`{ "error": { "code", "message", "details?" }, "requestId" }`.

### Autenticação — `/api/v1/auth`

| Método | Rota | O que faz |
|---|---|---|
| POST | `/register` | cria conta, devolve tokens (201) |
| POST | `/login` | autentica |
| POST | `/refresh` | troca o refresh token (rotaciona) |
| POST | `/logout` | revoga um refresh token |
| POST | `/logout-all` | revoga todos (exige access token) |
| GET | `/me` | usuário do token |

```bash
curl -X POST $API/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"eu@exemplo.com","password":"senha-forte-123"}'
```

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "9f3c...",
  "expiresIn": 900,
  "user": { "id": "a1b2", "email": "eu@exemplo.com" }
}
```

### Coleções — `/api/v1/collections`

| Método | Rota | O que faz |
|---|---|---|
| GET | `/` | lista (`limit`, `cursor`, `q`, `sort`, `order`) |
| POST | `/` | cria |
| GET | `/:id` | detalhe + contagem de arquivos |
| PATCH | `/:id` | renomeia / muda descrição |
| DELETE | `/:id?deleteFiles=true` | exclui (arquivos só somem se pedir) |
| GET | `/:id/files` | arquivos da coleção, paginado |
| POST | `/:id/files` | vincula arquivos (`{ fileIds }`) |
| DELETE | `/:id/files/:fileId` | desvincula (não exclui o arquivo) |

### Vídeos — `/api/v1/files`

| Método | Rota | O que faz |
|---|---|---|
| GET | `/` | lista (filtra por `collectionId`, `format`, `q`) |
| GET | `/:id` | metadados |
| PATCH | `/:id` | renomeia, metadados e dados técnicos do ffprobe |
| DELETE | `/:id` | exclui registro e objeto |
| GET | `/:id/stream` | emite o link assinado para tocar o vídeo |
| GET | `/:id/content` | download autorizado, aceita `Range` |
| GET | `/:id/verify` | confere existência e tamanho no R2 |
| PUT | `/:id/cover` | grava a capa (corpo cru, `content-type` da imagem) |
| GET | `/:id/cover` | bytes da capa |
| DELETE | `/:id/cover` | remove a capa |
| POST | `/cover-migration?limit=3` | move capas antigas de `metadata` para o R2 |

### Streaming assinado

A TV não manda header em cada `Range`, então os bytes saem por um link que já
carrega a autorização:

```bash
# 1) com o access token, pede o link
curl -H "Authorization: Bearer $TOKEN" $API/api/v1/files/$FILE/stream
# -> { "url": "https://.../stream/<id>?token=<id>.<exp>.<hmac>",
#      "expiresAt": 1763061600, "mimeType": "video/mp4",
#      "sizeBytes": 4294967296, "durationSeconds": 1432.5 }

# 2) o player toca essa URL direto, sem header
```

O token é `HMAC-SHA256(JWT_SECRET, "<fileId>.<exp>")`, vale para **um** vídeo e
expira em `STREAM_TOKEN_TTL_SECONDS`. Usar o token de um vídeo na URL de outro
devolve 403; assinatura quebrada ou prazo vencido, 401. `/stream/:id` aceita
`Range` e devolve 206 — é o que faz o seek funcionar.

#### Custo e limites da entrega

Hoje os bytes passam pelo Worker. Funciona e é o caminho mais simples, mas cada
seek do player vira uma requisição de `Range`: no plano gratuito são 100 mil
requisições por dia, e uma sessão de TV come isso rápido.

Quando o uso crescer, a saída é deixar o Worker só com catálogo, autenticação e
a emissão do link, e servir os bytes por **domínio próprio no bucket R2** — o
egress do R2 é gratuito, então a conta não muda com o volume assistido. Vale
conferir também a seção 2.8 dos termos da Cloudflare: servir vídeo em volume
pelo CDN/Workers é restrito; pelo R2, não.

### Dados técnicos do vídeo

`duration_seconds`, `width`, `height`, `video_codec` e `audio_codec` ficam em
colunas próprias, não em `metadata`, porque a lista e a tela de detalhe leem
isso em toda renderização. Quem preenche é o cliente, com o `ffprobe` que o
Electron já embarca, num `PATCH /files/:id` depois do `complete`.

### Thumbnail do vídeo

A thumbnail **nunca** fica no banco. Até a versão anterior ela era gravada como data
URL base64 dentro de `metadata`: uma linha chegava a 780 KB e uma página de 50
arquivos estourava o limite de recursos do Worker — a Cloudflare devolvia
503/`1102` e a biblioteca não carregava.

Agora a imagem vive no R2 (`files/<id>/cover`), `files.cover_key` aponta para
ela e a listagem devolve só `hasCover: boolean`. Para exibir a capa, o cliente
chama `GET /files/:id/cover`.

Compatibilidade: um `PATCH /files/:id` que mande `metadata.coverDataUrl` tem a
capa desviada para o R2 e gravada fora da coluna. As linhas antigas continuam
sendo servidas pelo `GET /:id/cover` (lê o base64 que sobrou) até rodar

```bash
# repita enquanto "restantes" for maior que zero
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "$API/files/cover-migration?limit=3"
```

### Upload (3 passos)

| Método | Rota | O que faz |
|---|---|---|
| POST | `/files/uploads` | autoriza e devolve `strategy` |
| PUT | `/files/uploads/:id/content` | envia tudo (arquivos menores) |
| PUT | `/files/uploads/:id/parts/:n` | envia uma parte (multipart) |
| POST | `/files/uploads/:id/complete` | confirma (idempotente) |
| POST | `/files/uploads/:id/abort` | cancela e limpa |

```bash
# 1) autoriza
curl -X POST $API/api/v1/files/uploads -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"S01E01.mkv","sizeBytes":2147483648,"collectionId":"col_1"}'
# -> { "uploadId":"...", "fileId":"...", "strategy":"multipart", "partSize":67108864 }

# 2) envia (single, só para arquivo pequeno)
curl -X PUT $API/api/v1/files/uploads/$UPLOAD/content \
  -H "Authorization: Bearer $TOKEN" --data-binary @"S01E01.mkv"

# 3) confirma
curl -X POST $API/api/v1/files/uploads/$UPLOAD/complete \
  -H "Authorization: Bearer $TOKEN"
```

`strategy` é `multipart` quando o arquivo passa de 64 MiB — o caso normal em
vídeo. As partes vão em `/parts/:n` com 64 MiB cada (menos a última) antes do
`complete`. O R2 aceita no máximo 10.000 partes, então essa parte cobre
arquivos de até ~640 GiB sem recalcular nada.

Formatos aceitos: `mp4`, `m4v`, `mkv`, `webm`, `mov`, `avi`, `ts`.

O upload só é liberado depois de validar extensão, MIME, **bytes iniciais do
conteúdo** e tamanho. O sniff reconhece o container: `ftyp` no offset 4
(ISOBMFF), `1A 45 DF A3` (EBML, MKV/WebM), `RIFF` + `AVI ` e o sync `0x47` do
MPEG-TS. MKV e WebM são o mesmo container, então valem um pelo outro. O
`complete` confere se o objeto existe no R2 e se o tamanho bate com o
declarado.

### Operações em massa

| Método | Rota |
|---|---|
| POST | `/api/v1/files/bulk/move` |
| POST | `/api/v1/files/bulk/add-to-collection` |
| POST | `/api/v1/files/bulk/remove-from-collection` |
| POST | `/api/v1/files/bulk/delete` (exige `confirm: true`) |
| POST | `/api/v1/files/bulk/update` |
| POST | `/api/v1/collections/bulk/delete` (exige `confirm: true`) |
| GET | `/api/v1/operations/:id` |

Toda resposta traz o relatório item a item:

```json
{
  "operationId": "7a1f...",
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    { "id": "f1", "ok": true },
    { "id": "f2", "ok": true },
    { "id": "f3", "ok": false, "error": "Arquivo não encontrado ou sem permissão." }
  ]
}
```

### Progresso de reprodução — `/api/v1/progress`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/progress` | tudo, paginado (`sort=updatedAt\|openedAt`, `order`, `cursor`, `limit`) |
| GET | `/progress/last` | último vídeo **aberto** — o "Continuar assistindo" |
| GET | `/progress/:fileId` | posição de um vídeo (404 se nunca foi tocado) |
| PUT | `/progress/:fileId` | grava posição e preferências de reprodução |
| POST | `/progress/:fileId/opened` | marca que o vídeo foi aberto agora |
| DELETE | `/progress/:fileId` | zera o progresso |

O progresso é **compartilhado**: a chave é só o arquivo, sem usuário. Qualquer
conta autenticada lê e grava a mesma posição.

```jsonc
// PUT /api/v1/progress/<fileId>
{
  "positionSeconds": 743.2,
  "durationSeconds": 1432.5,
  "fraction": 0.5188,          // opcional: derivada quando omitida
  "audioTrack": "jpn",
  "subtitleTrack": "por",
  "playbackRate": 1.25,
  "completed": false,          // opcional: automático acima de 95%
  "updatedAt": 1763040000000   // quando o CLIENTE registrou a posição
}
```

`fraction` é derivada de `positionSeconds / durationSeconds` quando o corpo não
a manda — a lista desenha a barrinha sem conhecer a duração. Passar de **95%**
marca `completed: 1`, que é o que faz o "Continuar assistindo" pular para o
próximo episódio em vez de reabrir o que acabou.

**Regra de conflito.** Se o `updatedAt` do corpo for menor que o gravado, a
escrita é ignorada e a resposta volta com `applied: false` e a linha atual — o
cliente deve adotar essa posição. É o que impede um aparelho com relógio
atrasado rebobinar o que o outro assistiu. Omitir `updatedAt` equivale a
"agora", então sempre ganha.

`PUT` **não** mexe no `opened_at`: "Continuar assistindo" é o último vídeo
*aberto*, não o de posição gravada mais recentemente. Por isso existe o
`POST /:fileId/opened`, chamado ao abrir o episódio.

Campos omitidos no `PUT` são preservados (mescla), então o player pode mandar só
a posição sem apagar a faixa de legenda escolhida.

### Sincronização — `/api/v1/sync/changes?since=<ms>`

Devolve o que mudou desde `since`, com `cursor` para a próxima chamada.
Arquivos com `deleted: true` devem sair do cache local do cliente. A resposta
também traz `progress[]` com as linhas de progresso alteradas desde `since`
(por `updatedAt` ou `openedAt`), para o cliente sincronizar tudo numa chamada.

## Testes

```bash
npm test
```

76 testes rodando no runtime real do Workers (`@cloudflare/vitest-pool-workers`),
com D1 e R2 de verdade:

- `auth.test.ts` — cadastro, login, rotação de refresh, revogação, rotas protegidas.
- `files.test.ts` — upload completo, idempotência, formatos recusados, conteúdo
  que não bate com a extensão, tamanho divergente, `Range`, integridade,
  exclusão e **isolamento entre usuários**.
- `collections.test.ts` — CRUD, vínculos, nome duplicado, paginação por cursor,
  busca, exclusão com e sem arquivos.
- `bulk.test.ts` — mover, adicionar, remover, excluir, atualizar metadados,
  relatório de falhas parciais e permissões.
- `stream.test.ts` — link assinado, `Range` no link, token de outro vídeo,
  assinatura quebrada e prazo adulterado.
- `progress.test.ts` — posição em segundos, mescla de campos, `completed`
  automático, last-write-wins e "Continuar assistindo".

## Cron

`scheduled` roda de hora em hora: expira sessões de upload abandonadas (aborta o
multipart) e retenta as exclusões do R2 que falharam.
