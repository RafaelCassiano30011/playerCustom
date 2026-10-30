import { ApiError } from './responses';

/**
 * Cursor opaco para paginação estável: guarda o valor de ordenação e o id,
 * que desempata registros com o mesmo valor.
 */
export interface Cursor {
  v: string | number;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replace(/=+$/, '');
}

export function decodeCursor(raw?: string): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(atob(raw)) as Cursor;
    if (
      (typeof parsed.v !== 'string' && typeof parsed.v !== 'number') ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('formato');
    }
    return parsed;
  } catch {
    throw ApiError.badRequest('Cursor de paginação inválido.');
  }
}
