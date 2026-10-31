import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db';
import { loginCodes, refreshTokens, users } from '../db';
import { ApiError } from '../lib/responses';
import {
  hashPassword,
  randomId,
  randomNumericCode,
  randomToken,
  sha256Hex,
  signAccessToken,
  timingSafeEqual,
  verifyPassword,
} from '../lib/crypto';
import { loginCodeMessage, sendEmail } from '../lib/email';
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

  // conta criada por codigo no e-mail nao tem senha para conferir
  if (!registro.passwordHash || !registro.passwordSalt) throw generico;

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

/* ------------------------------------------------------------------ *
 * Login por codigo no e-mail
 * ------------------------------------------------------------------ */

/** Tentativas de chute por codigo antes de queimar. */
const MAX_TENTATIVAS = 5;
/** Intervalo minimo entre dois pedidos para o mesmo e-mail. */
const REENVIO_SEGUNDOS = 60;

function codigoTtl(env: Env): number {
  const valor = Number(env.LOGIN_CODE_TTL_SECONDS);
  return Number.isFinite(valor) && valor > 0 ? valor : 600;
}

function emailPermitido(env: Env, email: string): boolean {
  const lista = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return lista.length === 0 || lista.includes(email);
}

export interface CodigoPedido {
  /** Quando outro pedido para o mesmo e-mail sera aceito. */
  retryAfter: number;
  expiresIn: number;
  /** So com LOGIN_CODE_DEBUG ligado (testes). */
  code?: string;
}

/**
 * Cria e envia um codigo de uso unico.
 *
 * A resposta e sempre a mesma, mesmo para e-mail fora da lista permitida ou
 * para pedido repetido: quem esta do outro lado nao descobre quais enderecos
 * existem nem quais recebem e-mail.
 */
export async function requestLoginCode(
  db: Database,
  env: Env,
  email: string,
): Promise<CodigoPedido> {
  const ttl = codigoTtl(env);
  const agora = Date.now();
  const resposta: CodigoPedido = { retryAfter: REENVIO_SEGUNDOS, expiresIn: ttl };

  if (!emailPermitido(env, email)) return resposta;

  // pedido recente ainda valendo: nao manda outro e-mail, so repete a resposta
  const [recente] = await db
    .select({ createdAt: loginCodes.createdAt })
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (recente && agora - recente.createdAt < REENVIO_SEGUNDOS * 1000) return resposta;

  // um codigo valido por vez: o anterior morre junto com o novo pedido
  await db.delete(loginCodes).where(eq(loginCodes.email, email));
  // limpeza oportunista do que ja venceu de outros enderecos
  await db.delete(loginCodes).where(lt(loginCodes.expiresAt, agora));

  const codigo = randomNumericCode(6);
  await db.insert(loginCodes).values({
    id: randomId(),
    email,
    codeHash: await sha256Hex(codigo),
    attempts: 0,
    expiresAt: agora + ttl * 1000,
    createdAt: agora,
  });

  await sendEmail(env, loginCodeMessage(email, codigo, Math.round(ttl / 60)));
  if (env.LOGIN_CODE_DEBUG === 'true') return { ...resposta, code: codigo };
  return resposta;
}

/**
 * Confere o codigo e devolve os tokens. O primeiro acesso de um e-mail cria a
 * conta: quem recebeu o codigo provou que e dono da caixa, e exigir cadastro
 * antes disso seria uma tela a mais para nada.
 */
export async function loginWithCode(
  db: Database,
  env: Env,
  email: string,
  code: string,
): Promise<AuthTokens> {
  const agora = Date.now();
  const generico = ApiError.unauthorized('Codigo invalido ou expirado.');

  const [registro] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);

  if (!registro) throw generico;
  if (registro.expiresAt <= agora) {
    await db.delete(loginCodes).where(eq(loginCodes.id, registro.id));
    throw generico;
  }
  if (registro.attempts >= MAX_TENTATIVAS) {
    await db.delete(loginCodes).where(eq(loginCodes.id, registro.id));
    throw ApiError.tooManyRequests('Codigo bloqueado por tentativas. Peca outro.');
  }

  const confere = timingSafeEqual(await sha256Hex(code), registro.codeHash);
  if (!confere) {
    await db
      .update(loginCodes)
      .set({ attempts: registro.attempts + 1 })
      .where(eq(loginCodes.id, registro.id));
    throw generico;
  }

  await db.delete(loginCodes).where(eq(loginCodes.id, registro.id));

  const [existente] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existente) return emitirTokens(db, env, existente);

  const user = { id: randomId(), email };
  await db.insert(users).values({
    id: user.id,
    email,
    // sem senha: entra sempre por codigo no e-mail
    passwordHash: '',
    passwordSalt: '',
    createdAt: agora,
    updatedAt: agora,
  });
  return emitirTokens(db, env, user);
}
