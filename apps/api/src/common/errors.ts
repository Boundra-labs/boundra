import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ErrorCode } from '@boundra/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';

export interface ErrorBody {
  error: {
    code: ErrorCode | 'INTERNAL_ERROR';
    message: string;
    recovery?: string;
    details?: unknown;
  };
}

/** Typed API failure: stable machine code plus display text and an optional recovery step. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    recovery?: string,
    details?: unknown,
  ) {
    super({ error: { code, message, recovery, details } } satisfies ErrorBody, status);
  }
}

export const notFound = (what: string) =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const invalidState = (message: string, recovery?: string) =>
  new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE', message, recovery);

const statusCodes: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE',
  413: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'DEPENDENCY_UNAVAILABLE',
};

/** Every error leaves the API as `{ error: { code, message } }`; internals are never echoed. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: exception.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      } satisfies ErrorBody);
      return;
    }
    if (exception instanceof ThrottlerException) {
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          recovery: 'Retry in a minute.',
        },
      } satisfies ErrorBody);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'object'
      ) {
        response.status(status).json(body);
        return;
      }
      const message =
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        typeof body.message === 'string'
          ? body.message
          : exception.message;
      response.status(status).json({
        error: { code: statusCodes[status] ?? 'INTERNAL_ERROR', message },
      } satisfies ErrorBody);
      return;
    }
    // Express body-parser failures (malformed JSON, oversized body) carry an exposable 4xx status.
    const http = exception as { status?: unknown; expose?: unknown };
    if (
      typeof http.status === 'number' &&
      http.status >= 400 &&
      http.status < 500 &&
      http.expose === true
    ) {
      response.status(http.status).json({
        error: {
          code: statusCodes[http.status] ?? 'VALIDATION_FAILED',
          message: http.status === 413 ? 'Request body too large' : 'Malformed request body',
        },
      } satisfies ErrorBody);
      return;
    }
    this.logger.error(exception instanceof Error ? exception.name : 'Unknown error');
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
    } satisfies ErrorBody);
  }
}
