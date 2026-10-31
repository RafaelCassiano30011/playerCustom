import path from 'node:path';
import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config';

// lido no Node (fora do Worker) e entregue aos testes como binding
const migrations = await readD1Migrations(
  path.join(__dirname, 'src', 'db', 'migrations'),
);

export default defineWorkersConfig({
  test: {
    globals: true,
    setupFiles: ['./test/apply-migrations.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        // No Windows o pop do storage isolado falha com EBUSY ao desligar o R2
        // entre testes. Cada teste ja comeca com resetDb(), e as chaves do R2
        // sao por id de arquivo, entao o isolamento por teste nao e necessario.
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // o secret não vem do wrangler.jsonc; nos testes é um valor fixo
          bindings: {
            JWT_SECRET: 'segredo-apenas-para-testes',
            // sem caixa de e-mail nos testes: a API devolve o codigo gerado
            LOGIN_CODE_DEBUG: 'true',
            // a lista de producao so tem o e-mail do dono; aqui vale o do teste
            ALLOWED_EMAILS: 'dono@exemplo.com',
            TEST_MIGRATIONS: migrations,
          },
        },
      },
    },
  },
});
