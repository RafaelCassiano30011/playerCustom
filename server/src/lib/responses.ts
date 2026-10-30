/** Formato único de resposta para todos os endpoints. */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'bad_request', message, details);
  }
  static unauthorized(message = 'Credenciais ausentes ou inválidas.') {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = 'Acesso negado a este recurso.') {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = 'Recurso não encontrado.') {
    return new ApiError(404, 'not_found', message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, 'conflict', message, details);
  }
  static payloadTooLarge(message: string) {
    return new ApiError(413, 'payload_too_large', message);
  }
  static unsupportedMedia(message: string) {
    return new ApiError(415, 'unsupported_media_type', message);
  }
  static tooManyRequests(message = 'Muitas requisições. Tente de novo em instantes.') {
    return new ApiError(429, 'too_many_requests', message);
  }
  static internal(message = 'Erro interno.') {
    return new ApiError(500, 'internal_error', message);
  }
}

export interface Paginated<T> {
  items: T[];
  /** cursor opaco para a próxima página; ausente quando acabou */
  nextCursor?: string;
}

export const json = <T>(data: T, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers });
