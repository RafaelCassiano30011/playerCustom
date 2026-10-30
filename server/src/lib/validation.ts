import { z } from 'zod';
import { ApiError } from './responses';
import { SUPPORTED_FORMATS } from '../types';

/** Lê e valida o corpo JSON, devolvendo erro 400 padronizado. */
export async function parseJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw ApiError.badRequest('Corpo da requisição não é JSON válido.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ApiError.badRequest('Dados inválidos.', result.error.flatten());
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(
  url: URL,
  schema: T,
): z.infer<T> {
  const obj = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw ApiError.badRequest('Parâmetros inválidos.', result.error.flatten());
  }
  return result.data;
}

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8).max(200);

export const idSchema = z.string().min(1).max(64);
export const idListSchema = z.array(idSchema).min(1).max(500);

export const formatSchema = z.enum(SUPPORTED_FORMATS);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z
    .enum(['name', 'createdAt', 'updatedAt', 'size'])
    .default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const collectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const collectionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export const fileUpdateSchema = z
  .object({
    originalName: z.string().trim().min(1).max(300).optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    // dados técnicos do ffprobe, enviados depois do upload
    durationSeconds: z.number().min(0).max(1_440_000).optional(),
    width: z.number().int().min(0).max(32_768).optional(),
    height: z.number().int().min(0).max(32_768).optional(),
    videoCodec: z.string().trim().max(50).optional(),
    audioCodec: z.string().trim().max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

/**
 * Nome de armazenamento seguro: sem separadores de caminho, sem caracteres de
 * controle e sem nomes reservados do Windows.
 */
export function safeStorageName(name: string): string {
  const base = name
    .replace(/[\\/]+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const limpo = base.length > 0 ? base.slice(0, 200) : 'arquivo';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(limpo.split('.')[0])
    ? `_${limpo}`
    : limpo;
}

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

const MIME_BY_FORMAT: Record<string, string[]> = {
  mp4: ['video/mp4', 'application/mp4'],
  m4v: ['video/x-m4v', 'video/mp4'],
  mkv: ['video/x-matroska', 'application/x-matroska'],
  webm: ['video/webm'],
  mov: ['video/quicktime'],
  avi: ['video/x-msvideo', 'video/avi', 'video/msvideo'],
  ts: ['video/mp2t', 'video/MP2T'],
};

export const MIME_CANONICAL: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
};

/** Confere se o MIME declarado combina com o formato (quando declarado). */
export function mimeMatchesFormat(format: string, mime?: string): boolean {
  if (!mime) return true;
  const aceitos = MIME_BY_FORMAT[format];
  if (!aceitos) return false;
  const limpo = mime.split(';')[0].trim().toLowerCase();
  return aceitos.some((a) => a.toLowerCase() === limpo);
}

/** Quantidade de bytes iniciais que `contentMatchesFormat` precisa ver. */
export const SNIFF_BYTES = 16;

export type ContainerKind = 'isobmff' | 'ebml' | 'riff-avi' | 'mpeg-ts' | 'unknown';

function ascii(head: Uint8Array, offset: number, text: string): boolean {
  if (head.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (head[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Identifica o container pelos bytes iniciais.
 *
 * ISOBMFF (MP4/M4V/MOV) tem "ftyp" no offset 4; MKV e WebM são EBML
 * (1A 45 DF A3) e não se distinguem sem ler o DocType, então valem um pelo
 * outro; AVI é RIFF com "AVI " no offset 8; MPEG-TS começa com o sync 0x47.
 */
export function sniffContainer(head: Uint8Array): ContainerKind {
  if (ascii(head, 4, 'ftyp')) return 'isobmff';
  if (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return 'ebml';
  }
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'AVI ')) return 'riff-avi';
  if (head.length >= 1 && head[0] === 0x47) return 'mpeg-ts';
  return 'unknown';
}

const CONTAINER_BY_FORMAT: Record<string, ContainerKind> = {
  mp4: 'isobmff',
  m4v: 'isobmff',
  mov: 'isobmff',
  mkv: 'ebml',
  webm: 'ebml',
  avi: 'riff-avi',
  ts: 'mpeg-ts',
};

export function contentMatchesFormat(
  format: string,
  head: Uint8Array,
): boolean {
  const esperado = CONTAINER_BY_FORMAT[format];
  if (!esperado) return false;
  return sniffContainer(head) === esperado;
}
