import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { emailSchema, parseJson, passwordSchema } from '../lib/validation';
import * as authService from '../services/auth-service';
import type { AppContext } from '../types';

const credenciais = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const refreshBody = z.object({ refreshToken: z.string().min(10).max(500) });

const pedidoDeCodigo = z.object({ email: emailSchema });
const codigo = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'O codigo tem 6 digitos.'),
});

export const authRoutes = new Hono<AppContext>();

authRoutes.post(
  '/register',
  rateLimit({ limit: 10, windowSeconds: 600, name: 'register' }),
  async (c) => {
    const body = await parseJson(c.req.raw, credenciais);
    const tokens = await authService.register(
      c.get('db'),
      c.env,
      body.email,
      body.password,
    );
    return c.json(tokens, 201);
  },
);

authRoutes.post(
  '/login',
  rateLimit({ limit: 15, windowSeconds: 300, name: 'login' }),
  async (c) => {
    const body = await parseJson(c.req.raw, credenciais);
    const tokens = await authService.login(
      c.get('db'),
      c.env,
      body.email,
      body.password,
    );
    return c.json(tokens);
  },
);

authRoutes.post(
  '/code',
  // dispara e-mail: limite apertado, senao a caixa do dono vira alvo
  rateLimit({ limit: 5, windowSeconds: 600, name: 'login-code' }),
  async (c) => {
    const body = await parseJson(c.req.raw, pedidoDeCodigo);
    const pedido = await authService.requestLoginCode(c.get('db'), c.env, body.email);
    return c.json(pedido, 202);
  },
);

authRoutes.post(
  '/code/verify',
  rateLimit({ limit: 20, windowSeconds: 600, name: 'login-code-verify' }),
  async (c) => {
    const body = await parseJson(c.req.raw, codigo);
    const tokens = await authService.loginWithCode(
      c.get('db'),
      c.env,
      body.email,
      body.code,
    );
    return c.json(tokens);
  },
);

authRoutes.post('/refresh', async (c) => {
  const body = await parseJson(c.req.raw, refreshBody);
  const tokens = await authService.refresh(c.get('db'), c.env, body.refreshToken);
  return c.json(tokens);
});

authRoutes.post('/logout', async (c) => {
  const body = await parseJson(c.req.raw, refreshBody);
  await authService.logout(c.get('db'), body.refreshToken);
  return c.body(null, 204);
});

authRoutes.post('/logout-all', requireAuth(), async (c) => {
  await authService.logoutAll(c.get('db'), c.get('user').id);
  return c.body(null, 204);
});

authRoutes.get('/me', requireAuth(), (c) => c.json({ user: c.get('user') }));
