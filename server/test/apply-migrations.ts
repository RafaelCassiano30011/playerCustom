import { applyD1Migrations, env } from 'cloudflare:test';

// roda uma vez por worker de teste, antes dos arquivos de teste
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
