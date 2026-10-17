// ============================================================
// src/api/middleware/rateLimit.ts
// Per-IP rate limiting using express-rate-limit
// ============================================================

import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

const rateLimitHandler = (_req: unknown, res: { status: (n: number) => { json: (v: unknown) => void } }): void => {
  res.status(429).json({
    success: false,
    error: 'Too many requests — please slow down',
    requestId: uuidv4(),
  });
};

/** Standard limit: 100 requests per minute per IP */
export const standardRateLimit = rateLimit({
  windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
  max: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] ?? '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Withdrawal limit: 10 per minute (much stricter) */
export const withdrawalRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Admin endpoints: 30 per minute */
export const adminRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
