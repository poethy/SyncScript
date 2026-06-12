import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

interface ValidationIssue {
  instancePath?: string;
  message?: string;
}

/** Operational error with an HTTP status; anything else is treated as a bug. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string = 'APP_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error.validation) {
    const issues = error.validation as ValidationIssue[];
    void reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request does not match the expected schema',
        issues: issues.map((issue) => ({
          path: issue.instancePath ?? '',
          message: issue.message ?? 'invalid',
        })),
      },
    });
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
