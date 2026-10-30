import { Hono } from 'hono';
import { desc, lt } from 'drizzle-orm';
import { createDb, pendingDeletions } from './db';
import { cors } from './middleware/cors';
import { handleError, requestId } from './middleware/error-handler';
import { withDb } from './middleware/auth';
import { ApiError } from './lib/responses';
import { authRoutes } from './routes/auth';
import { collectionRoutes } from './routes/collections';
import { fileRoutes } from './routes/files';
import { bulkRoutes } from './routes/bulk';
import { progressRoutes } from './routes/progress';
import { streamRoutes } from './routes/stream';
import { syncRoutes } from './routes/sync';
import { finalizeDeletion } from './services/file-service';
import { expireStaleSessions } from './services/upload-service';
import type { AppContext, Env } from './types';

const app = new Hono<AppContext>();

app.use('*', requestId());
app.use('*', cors());
app.use('*', withDb());
app.onError(handleError);
app.notFound(() => {
  throw ApiError.notFound('Rota não encontrada.');
});

app.get('/health', (c) => c.json({ ok: true, time: Date.now() }));

const v1 = new Hono<AppContext>();
v1.route('/auth', authRoutes);
v1.route('/collections', collectionRoutes);
v1.route('/files', fileRoutes);
v1.route('/progress', progressRoutes);
v1.route('/sync', syncRoutes);
// as rotas em massa já trazem o caminho completo (files/bulk/..., collections/bulk/...)
v1.route('/', bulkRoutes);

app.route('/api/v1', v1);
// Fora do /api/v1 e sem requireAuth: a autorizacao vem do token na URL.
app.route('/stream', streamRoutes);

/**
 * Cron: expira uploads abandonados e tenta de novo as exclusões do R2 que
 * falharam. Mantém D1 e R2 convergindo mesmo depois de falhas parciais.
 */
async function limpeza(env: Env): Promise<void> {
  const db = createDb(env.DB);

  const expiradas = await expireStaleSessions(db, env);
  if (expiradas > 0) console.log(`[cron] ${expiradas} sessões de upload expiradas`);

  const pendentes = await db
    .select()
    .from(pendingDeletions)
    .where(lt(pendingDeletions.attempts, 10))
    .orderBy(desc(pendingDeletions.createdAt))
    .limit(100);

  let removidos = 0;
  for (const item of pendentes) {
    if (await finalizeDeletion(db, env.FILES_BUCKET, item.r2Key)) removidos++;
  }
  if (removidos > 0) console.log(`[cron] ${removidos} objetos removidos do R2`);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(limpeza(env));
  },
};
