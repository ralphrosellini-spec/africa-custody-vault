// ============================================================
// src/api/middleware/errorHandler.ts
// Global error handler + asyncHandler wrapper
// ============================================================

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(401, 'Unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super(403, 'Forbidden');
  }
}

export class InsufficientBalanceError extends AppError {
  constructor() {
    super(422, 'Insufficient balance');
  }
}

/**
 * Wraps an async route handler so Express catches rejected promises.
 * Avoids try/catch boilerplate in every route.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 404 handler — mount before errorHandler */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    requestId: uuidv4(),
  });
}

/** Global error handler — must be the last middleware */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = uuidv4();

  if (err instanceof AppError && err.isOperational) {
    // Known, expected errors — log at warn level
    logger.warn('[ErrorHandler] Operational error', {
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
      requestId,
    });

    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      requestId,
    });
    return;
  }

  // Unknown errors — log at error level with full stack
  logger.error('[ErrorHandler] Unexpected error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId,
  });

  // NEVER expose internal error details in production
  const message =
    process.env['NODE_ENV'] === 'development' ? err.message : 'An internal error occurred';

  res.status(500).json({
    success: false,
    error: message,
    requestId,
  });
}
