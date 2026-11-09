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

    const body: ErrorResponse = {
      error: {
        code:
          exception instanceof ThrottlerException
            ? 'RATE_LIMITED'
            : (HttpStatus[status] ?? 'ERROR'),
        message:
          status >= 500 || !(exception instanceof HttpException)
            ? 'Internal server error'
            : exception.message,
        correlationId,
      },
    };
    res.status(status).json(body);
  }
}
