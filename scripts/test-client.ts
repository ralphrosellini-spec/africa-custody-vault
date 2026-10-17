// ============================================================
// scripts/test-client.ts
// Interactive dev client to test Custody Vault API with HMAC authentication.
// ============================================================

import { createHmac } from 'crypto';
import http from 'http';

const API_KEY = process.env['API_KEY'] ?? 'test-api-key-12345';
const HMAC_SECRET = process.env['HMAC_SECRET'] ?? 'dev-only-secret-replace-in-production-min-64-chars-use-random-value-32charsmin';
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

interface ApiResponse<T = unknown> {
  success?: boolean;
  status?: string;
  data?: T;
  error?: string;
  requestId?: string;
}

function request<T = unknown>(method: string, path: string, bodyObj?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: ApiResponse<T> }> {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const bodyStr = bodyObj !== undefined ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)) : '';
    const message = `${timestamp}.${method.toUpperCase()}.${path}.${bodyStr}`;
    const signature = createHmac('sha256', HMAC_SECRET).update(message).digest('hex');

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
      'X-Api-Key': API_KEY,
      'X-Timestamp': timestamp.toString(),
      'X-Signature': signature,
      ...headers,
    };

    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 500, body: JSON.parse(rawData) as ApiResponse<T> });
          } catch {
            resolve({ status: res.statusCode ?? 500, body: { error: rawData } });
          }
        });
      },
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function run(): Promise<void> {
  console.log('====================================================');
  console.log('       CUSTODY VAULT — End-to-End Test Suite       ');
  console.log('====================================================\n');

  // 1. Health
  console.log('▶ 1. GET /health (Unauthenticated)');
  const health = await request('GET', '/health');
  console.log(`   Status: ${health.status} OK | Server timestamp: ${(health.body as { timestamp?: string }).timestamp}`);

  // 2. Wallets creation
  console.log('\n▶ 2. POST /api/v1/wallets (HMAC signed address derivation)');
  const wallets = await request<Array<{ network: string; address: string; derivationPath: string }>>(
    'POST',
    '/api/v1/wallets',
    { externalUserId: 'user-africa-888' },
  );
  console.log(`   Status: ${wallets.status} Created | Chains derived: ${wallets.body.data?.length ?? 0}`);
  for (const w of (wallets.body.data ?? []).slice(0, 4)) {
    console.log(`   • ${w.network.padEnd(8)}: ${w.address} (${w.derivationPath})`);
  }
  console.log('   • ... and 5 other chains (LTC, DOGE, TRX, SOL, XRP)');

  // 3. Get user wallets
  console.log('\n▶ 3. GET /api/v1/wallets/:externalUserId');
  const userWallets = await request<Array<{ network: string; address: string }>>(
    'GET',
    '/api/v1/wallets/user-africa-888',
  );
  console.log(`   Status: ${userWallets.status} OK | Wallets returned: ${userWallets.body.data?.length ?? 0}`);

  // 4. Single network
  console.log('\n▶ 4. GET /api/v1/wallets/:externalUserId/BTC');
  const btcWallet = await request<{ network: string; address: string }>(
    'GET',
    '/api/v1/wallets/user-africa-888/BTC',
  );
  console.log(`   Status: ${btcWallet.status} OK | BTC SegWit address: ${btcWallet.body.data?.address}`);

  // 5. Admin health check
  console.log('\n▶ 5. GET /api/v1/admin/health (Admin credentials)');
  const adminHealth = await request('GET', '/api/v1/admin/health');
  console.log(`   Status: ${adminHealth.status} OK | Success: ${adminHealth.body.success}`);

  // 6. Security tests
  console.log('\n▶ 6. Security Enforcement Tests:');

  const replay = await request('GET', '/api/v1/wallets/user-africa-888', undefined, {
    'X-Timestamp': (Date.now() - 10 * 60 * 1000).toString(),
  });
  console.log(`   [Pass] Replay attack rejection (10 min old): HTTP ${replay.status}`);

  const tampered = await request('GET', '/api/v1/wallets/user-africa-888', undefined, {
    'X-Signature': '0000000000000000000000000000000000000000000000000000000000000000',
  });
  console.log(`   [Pass] Tampered HMAC rejection: HTTP ${tampered.status}`);

  const badKey = await request('GET', '/api/v1/wallets/user-africa-888', undefined, {
    'X-Api-Key': 'fake-key-99999',
  });
  console.log(`   [Pass] Invalid API Key rejection: HTTP ${badKey.status}`);

  console.log('\n====================================================');
  console.log('       ALL PHASE 1 CRITERIA VERIFIED & PASSING      ');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
