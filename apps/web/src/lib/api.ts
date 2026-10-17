import type { ErrorCode } from '@boundra/shared';

/** API error codes plus the one failure the browser can only see from its side. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

/** A failed API call, carrying the API's stable code, display text and recovery step. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly recovery?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (error: unknown, code?: ClientErrorCode): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** The session's CSRF token; every state-changing request needs it. */
  csrfToken?: string;
  signal?: AbortSignal;
}

/**
 * Calls `/api/v1/<path>` on this origin. The session cookie travels automatically; amounts in
 * bodies stay base-unit strings exactly as the API defines them.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, csrfToken, signal } = options;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`/api/v1/${path.replace(/^\//, '')}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach Boundra',
      'Check your connection and try again.',
    );
  }

  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;

  const error = (payload as { error?: Partial<ApiError> } | null)?.error;
  throw new ApiError(
    response.status,
    (error?.code as ClientErrorCode | undefined) ?? 'INTERNAL_ERROR',
    error?.message ?? 'Something went wrong',
    error?.recovery,
    error?.details,
  );
}
