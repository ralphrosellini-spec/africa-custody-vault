// ============================================================
// tests/unit/utils/hmac.test.ts
// ============================================================

import { signRequest, verifyRequest, signWebhook, verifyWebhook } from '../../../src/utils/hmac';

const SECRET = 'test-secret-min-32-chars-for-hmac-testing';

describe('HMAC utilities', () => {

  describe('signRequest() and verifyRequest()', () => {
    it('produces a non-empty hex string', () => {
      const sig = signRequest('POST', '/api/v1/wallets', Date.now(), '{}', SECRET);
      expect(sig).toBeTruthy();
      expect(sig).toMatch(/^[a-f0-9]+$/);
      expect(sig.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('verifies a valid signature', () => {
      const ts = Date.now();
      const body = JSON.stringify({ externalUserId: 'user_1' });
      const sig = signRequest('POST', '/api/v1/wallets', ts, body, SECRET);
      expect(verifyRequest('POST', '/api/v1/wallets', ts, body, SECRET, sig)).toBe(true);
    });

    it('rejects a tampered body', () => {
      const ts = Date.now();
      const originalBody = '{"amount":"100"}';
      const tamperedBody = '{"amount":"999"}';
      const sig = signRequest('POST', '/api/v1/withdrawals', ts, originalBody, SECRET);
      expect(verifyRequest('POST', '/api/v1/withdrawals', ts, tamperedBody, SECRET, sig)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const ts = Date.now();
      const body = '{}';
      const sig = signRequest('GET', '/api/v1/wallets', ts, body, SECRET);
      expect(verifyRequest('GET', '/api/v1/wallets', ts, body, 'wrong-secret', sig)).toBe(false);
    });

    it('rejects stale timestamp (> 5 min old)', () => {
      const staleTs = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const body = '{}';
      const sig = signRequest('GET', '/api/v1/wallets', staleTs, body, SECRET);
      expect(verifyRequest('GET', '/api/v1/wallets', staleTs, body, SECRET, sig)).toBe(false);
    });

    it('rejects a future timestamp (> 5 min ahead)', () => {
      const futureTs = Date.now() + 6 * 60 * 1000;
      const body = '{}';
      const sig = signRequest('GET', '/api/v1/wallets', futureTs, body, SECRET);
      expect(verifyRequest('GET', '/api/v1/wallets', futureTs, body, SECRET, sig)).toBe(false);
    });

    it('is method-sensitive', () => {
      const ts = Date.now();
      const body = '{}';
      const sig = signRequest('POST', '/api/v1/wallets', ts, body, SECRET);
      expect(verifyRequest('GET', '/api/v1/wallets', ts, body, SECRET, sig)).toBe(false);
    });

    it('is path-sensitive', () => {
      const ts = Date.now();
      const body = '{}';
      const sig = signRequest('GET', '/api/v1/wallets', ts, body, SECRET);
      expect(verifyRequest('GET', '/api/v1/withdrawals', ts, body, SECRET, sig)).toBe(false);
    });
  });

  describe('signWebhook() and verifyWebhook()', () => {
    it('produces sha256= prefixed signature', () => {
      const sig = signWebhook('{"event":"test"}', SECRET);
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('verifies a valid webhook signature', () => {
      const payload = JSON.stringify({ eventId: '123', eventType: 'DEPOSIT_CONFIRMED' });
      const sig = signWebhook(payload, SECRET);
      expect(verifyWebhook(payload, SECRET, sig)).toBe(true);
    });

    it('rejects a tampered webhook payload', () => {
      const originalPayload = '{"amount":"100"}';
      const tamperedPayload = '{"amount":"999"}';
      const sig = signWebhook(originalPayload, SECRET);
      expect(verifyWebhook(tamperedPayload, SECRET, sig)).toBe(false);
    });

    it('rejects wrong secret on webhook', () => {
      const payload = '{"event":"test"}';
      const sig = signWebhook(payload, SECRET);
      expect(verifyWebhook(payload, 'wrong-secret', sig)).toBe(false);
    });

    it('rejects malformed signature format', () => {
      expect(verifyWebhook('{}', SECRET, 'notsha256format')).toBe(false);
    });
  });
});
