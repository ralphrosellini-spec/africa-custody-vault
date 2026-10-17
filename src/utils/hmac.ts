// ============================================================
// src/utils/hmac.ts
// HMAC-SHA256 signing and verification for API requests
// and webhook payloads.
// Uses Node.js built-in crypto ONLY — no third-party libs.
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';
import { HMAC_ALGORITHM, TIMESTAMP_TOLERANCE_MS } from './constants.js';

/**
 * Build the canonical message for an API request signature.
 * Format: `{timestamp}.{METHOD}.{path}.{bodyHash}`
 */
function buildRequestMessage(
  method: string,
  path: string,
  timestamp: number,
  body: string,
): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

/**
 * Sign an outgoing API request.
 * Returns a hex HMAC-SHA256 string.
 */
export function signRequest(
  method: string,
  path: string,
  timestamp: number,
  body: string,
  secret: string,
): string {
  const message = buildRequestMessage(method, path, timestamp, body);
  return createHmac(HMAC_ALGORITHM, secret).update(message).digest('hex');
}

/**
 * Verify an incoming API request signature.
 * - Checks timestamp is within tolerance (replay protection)
 * - Uses constant-time comparison (no timing side-channel)
 */
export function verifyRequest(
  method: string,
  path: string,
  timestamp: number,
  body: string,
  secret: string,
  signature: string,
): boolean {
  // Reject stale or future timestamps
  const now = Date.now();
  if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_MS) {
    return false;
  }

  const expected = signRequest(method, path, timestamp, body, secret);

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');

    // Buffers must be same length for timingSafeEqual
    if (expectedBuf.length !== actualBuf.length) return false;

    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Sign a webhook payload.
 * Returns `sha256=<hex>` format (same as GitHub webhooks).
 */
export function signWebhook(payload: string, secret: string): string {
  const sig = createHmac(HMAC_ALGORITHM, secret).update(payload).digest('hex');
  return `sha256=${sig}`;
}

/**
 * Verify a webhook signature.
 * Expected format: `sha256=<hex>`
 */
export function verifyWebhook(
  payload: string,
  secret: string,
  signature: string,
): boolean {
  if (!signature.startsWith('sha256=')) return false;

  const expected = signWebhook(payload, secret);

  try {
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);

    if (expectedBuf.length !== actualBuf.length) return false;

    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}
