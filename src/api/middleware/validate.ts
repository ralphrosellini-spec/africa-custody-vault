// ============================================================
// src/api/middleware/validate.ts
// Zod-based request validation middleware + all schemas
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { Network, Asset } from '../../types/index.js';
import { v4 as uuidv4 } from 'uuid';

// ---- Validation middleware ----

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
        requestId: uuidv4(),
      });
      return;
    }
    req.body = result.data as unknown;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: formatZodErrors(result.error),
        requestId: uuidv4(),
      });
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid path parameters',
        details: formatZodErrors(result.error),
        requestId: uuidv4(),
      });
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

function formatZodErrors(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    result[path || 'root'] = issue.message;
  }
  return result;
}

// ---- Zod Schemas ----

const networkEnum = z.nativeEnum(Network);
const assetEnum = z.nativeEnum(Asset);

/** Validates a positive numeric string (e.g. '100.50') */
const positiveNumericString = z
  .string()
  .min(1)
  .refine((v) => {
    const n = parseFloat(v);
    return !isNaN(n) && n > 0 && isFinite(n);
  }, { message: 'Must be a positive numeric value' });

export const createWalletSchema = z.object({
  externalUserId: z.string().min(1).max(100),
  networks: z.array(networkEnum).optional(),
});

export const withdrawalSchema = z.object({
  externalUserId: z.string().min(1).max(100),
  asset: assetEnum,
  network: networkEnum,
  destinationAddress: z.string().min(10).max(200),
  grossAmount: positiveNumericString,
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const networkParamSchema = z.object({
  network: networkEnum,
});

export const userIdParamSchema = z.object({
  externalUserId: z.string().min(1).max(100),
});

export const sweepSchema = z.object({
  externalUserId: z.string().min(1).max(100),
  network: networkEnum,
});

export const feeSweepSchema = z.object({
  asset: assetEnum,
  network: networkEnum,
});

export const emergencyPauseSchema = z.object({
  reason: z.string().min(1).max(500),
  paused: z.boolean(),
});

// Inferred types
export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
