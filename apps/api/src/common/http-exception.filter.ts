import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ErrorResponse } from '@core-studio/contracts';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

type Detail = { path: string; message: string };

function errorCode(exception: unknown, status: number, payload: unknown): string {
  if (exception instanceof ThrottlerException) return 'RATE_LIMITED';
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    typeof payload.code === 'string'
  ) {
    return payload.code;
  }
  return HttpStatus[status] ?? 'ERROR';
}

function errorDetails(payload: unknown): Detail[] | undefined {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'details' in payload &&
    Array.isArray(payload.details)
  ) {
    return payload.details as Detail[];
  }
  return undefined;
}

/** Produces the shared error envelope. Never leaks stack traces or internal messages for 5xx. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req: Request = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId: unknown = (req as { id?: unknown }).id;
    const correlationId = typeof requestId === 'string' ? requestId : 'unknown';

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) this.logger.error({ err: exception, correlationId }, 'Unhandled error');

    const isClientError = exception instanceof HttpException && status < 500;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;
    const details = isClientError ? errorDetails(payload) : undefined;
    const body: ErrorResponse = {
      error: {
        code: isClientError
          ? errorCode(exception, status, payload)
          : (HttpStatus[status] ?? 'ERROR'),
        message: isClientError ? exception.message : 'Internal server error',
        correlationId,
        ...(details ? { details } : {}),
      },
    };
    res.status(status).json(body);
  }
}
