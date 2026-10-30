import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import { refreshTokens, users } from '../db';
import { ApiError } from '../lib/responses';
import {
  hashPassword,
  randomId,
  randomToken,
  sha256Hex,
  signAccessToken,
  verifyPassword,
} from '../lib/crypto';
import type { Env } from '../types';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string };
}

function ttl(env: Env, chave: 'ACCESS_TOKEN_TTL_SECONDS' | 'REFRESH_TOKEN_TTL_SECONDS', padrao: number) {
  const valor = Number(env[chave]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

async function emitirTokens(
  db: Database,
  env: Env,
  user: { id: string; email: string },
): Promise<AuthTokens> {
  const acessoTtl = ttl(env, 'ACCESS_TOKEN_TTL_SECONDS', 900);
  const refreshTtl = ttl(env, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000);
  const agora = Date.now();

  const accessToken = await signAccessToken(
    { sub: user.id, email: user.email },
    env.JWT_SECRET,
    acessoTtl,
  );

  // o refresh token é opaco; guardamos só o hash para permitir revogação
  const refreshToken = randomToken(32);
  await db.insert(refreshTokens).values({
    id: randomId(),
    userId: user.id,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: agora + refreshTtl * 1000,
    createdAt: agora,
  });

  return { accessToken, refreshToken, expiresIn: acessoTtl, user };
}

export async function register(
  db: Database,
  env: Env,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const [existente] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existente) throw ApiError.conflict('Já existe uma conta com esse e-mail.');

  const { hash, salt } = await hashPassword(password);
  const agora = Date.now();
  const user = { id: randomId(), email };

  await db.insert(users).values({
    id: user.id,
    email,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: agora,
    updatedAt: agora,
  });

  return emitirTokens(db, env, user);
}

export async function login(
  db: Database,
  env: Env,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const [registro] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // mesma mensagem para e-mail inexistente e senha errada
  const generico = ApiError.unauthorized('E-mail ou senha incorretos.');
  if (!registro) {
    // gasta tempo parecido mesmo sem usuário, para não vazar existência
    await hashPassword(password, 'salt-inexistente');
    throw generico;
  }

  const ok = await verifyPassword(
    password,
    registro.passwordHash,
    registro.passwordSalt,
  );
  if (!ok) throw generico;

  return emitirTokens(db, env, { id: registro.id, email: registro.email });
}

export async function refresh(
  db: Database,
  env: Env,
  token: string,
): Promise<AuthTokens> {
  const hash = await sha256Hex(token);
  const [registro] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  if (!registro) throw ApiError.unauthorized('Refresh token inválido ou expirado.');

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, registro.userId))
    .limit(1);
  if (!user) throw ApiError.unauthorized('Usuário não encontrado.');

  // rotação: o token usado é revogado e um novo é emitido
  await db
    .update(refreshTokens)
    .set({ revokedAt: Date.now() })
    .where(eq(refreshTokens.id, registro.id));

  return emitirTokens(db, env, user);
}

export async function logout(db: Database, token: string): Promise<void> {
  const hash = await sha256Hex(token);
  await db
    .update(refreshTokens)
    .set({ revokedAt: Date.now() })
    .where(eq(refreshTokens.tokenHash, hash));
}

/** Revoga todos os refresh tokens do usuário (logout de todos os aparelhos). */
export async function logoutAll(db: Database, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: Date.now() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
