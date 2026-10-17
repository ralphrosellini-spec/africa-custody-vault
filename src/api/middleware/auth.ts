// ============================================================
// src/api/middleware/auth.ts
// Authentication: API key + HMAC request signature verification
// mTLS is handled at the load balancer / Azure API Gateway level.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { getPool, sql } from '../../db/connection.js';
import { verifyRequest } from '../../utils/hmac.js';
import { logger } from '../../utils/logger.js';
import { TABLES, TIMESTAMP_TOLERANCE_MS } from '../../utils/constants.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyId: string;
      callerIp: string;
      rawBody: string;
    }
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? req.ip ?? '';
  return req.ip ?? '';
}

/**
 * Standard API key + HMAC authentication.
 * Required headers:
 *   X-Api-Key   : API key (looked up in cv_api_keys by SHA-256 hash)
 *   X-Timestamp : Unix epoch milliseconds
 *   X-Signature : HMAC-SHA256(timestamp.METHOD.path.body)
 */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];

  if (!apiKey || !timestamp || !signature) {
    res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
    return;
  }

  // Reject stale requests early (before DB hit)
  const ts = parseInt(String(timestamp), 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
    return;
  }

  try {
    const pool = await getPool();

    // Hash the incoming key and look it up
    const keyHash = createHash('sha256').update(String(apiKey)).digest('hex');

    const result = await pool.request()
      .input('key_hash', sql.NVarChar, keyHash)
      .query(`
        SELECT id, key_id, is_active, is_admin, expires_at
        FROM ${TABLES.API_KEYS}
        WHERE key_hash = @key_hash
      `);

    const record = result.recordset[0] as {
      id: string;
      key_id: string;
      is_active: boolean;
      expires_at: Date | null;
    } | undefined;

    if (!record || !record.is_active) {
      res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
      return;
    }

    if (record.expires_at && record.expires_at < new Date()) {
      res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
      return;
    }

    // Verify HMAC signature
    const hmacSecret = process.env['HMAC_SECRET'] ?? '';
    const body = req.rawBody ?? '';
    const fullPath = (req.originalUrl ? req.originalUrl.split('?')[0] : req.path) ?? req.path;
    const valid =
      verifyRequest(req.method, fullPath, ts, body, hmacSecret, String(signature)) ||
      verifyRequest(req.method, req.path, ts, body, hmacSecret, String(signature));

    if (!valid) {
      logger.warn('[Auth] Invalid HMAC signature', {
        keyId: record.key_id,
        ip: getClientIp(req),
      });
      res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
      return;
    }

    // Attach caller identity to request
    req.apiKeyId = record.key_id;
    req.callerIp = getClientIp(req);

    // Update last_used_at (fire-and-forget — don't block the request)
    pool.request()
      .input('id', sql.UniqueIdentifier, record.id)
      .query(`UPDATE ${TABLES.API_KEYS} SET last_used_at = SYSDATETIMEOFFSET() WHERE id = @id`)
      .catch((err: Error) => logger.warn('[Auth] Failed to update last_used_at', { error: err.message }));

    next();
  } catch (err) {
    logger.error('[Auth] Authentication error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, error: 'Internal error', requestId: '' });
  }
}

/**
 * Admin-only auth — same as apiKeyAuth but additionally checks is_admin = 1.
 */
export async function adminKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];

  if (!apiKey || !timestamp || !signature) {
    res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
    return;
  }

  const ts = parseInt(String(timestamp), 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
    return;
  }

  try {
    const pool = await getPool();
    const keyHash = createHash('sha256').update(String(apiKey)).digest('hex');

    const result = await pool.request()
      .input('key_hash', sql.NVarChar, keyHash)
      .query(`
        SELECT id, key_id, is_active, is_admin, expires_at
        FROM ${TABLES.API_KEYS}
        WHERE key_hash = @key_hash AND is_admin = 1
      `);

    const record = result.recordset[0] as {
      id: string;
      key_id: string;
      is_active: boolean;
      expires_at: Date | null;
    } | undefined;

    if (!record || !record.is_active) {
      res.status(403).json({ success: false, error: 'Forbidden', requestId: '' });
      return;
    }

    const hmacSecret = process.env['HMAC_SECRET'] ?? '';
    const body = req.rawBody ?? '';
    const fullPath = (req.originalUrl ? req.originalUrl.split('?')[0] : req.path) ?? req.path;
    const valid =
      verifyRequest(req.method, fullPath, ts, body, hmacSecret, String(signature)) ||
      verifyRequest(req.method, req.path, ts, body, hmacSecret, String(signature));

    if (!valid) {
      res.status(401).json({ success: false, error: 'Unauthorized', requestId: '' });
      return;
    }

    req.apiKeyId = record.key_id;
    req.callerIp = getClientIp(req);

    next();
  } catch (err) {
    logger.error('[Auth] Admin auth error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: 'Internal error', requestId: '' });
  }
}
