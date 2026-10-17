// ============================================================
// src/db/connection.ts
// MS SQL Server connection pool (singleton).
// Automatically supports in-memory mock database in development mode.
// ============================================================

import sql from 'mssql';
import { logger } from '../utils/logger.js';
import { mockDb } from './mockDb.js';

let pool: any = null;
let isMock = false;

class MockRequest {
  private inputs: Record<string, unknown> = {};

  input(name: string, _typeOrVal: unknown, value?: unknown) {
    if (value !== undefined) {
      this.inputs[name] = value;
    } else {
      this.inputs[name] = _typeOrVal;
    }
    return this;
  }

  async query(sqlStr: string) {
    return mockDb.execute(sqlStr, this.inputs);
  }
}

class MockConnectionPool {
  connected = true;

  request() {
    return new MockRequest();
  }

  async close() {
    this.connected = false;
  }
}

function getDbConfig(): sql.config {
  return {
    server: process.env['DB_SERVER'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '1433', 10),
    database: process.env['DB_NAME'] ?? 'custody_vault',
    user: process.env['DB_USER'] ?? 'sa',
    password: process.env['DB_PASSWORD'] ?? '',
    options: {
      encrypt: process.env['DB_ENCRYPT'] !== 'false',
      trustServerCertificate: process.env['DB_TRUST_SERVER_CERT'] === 'true',
      enableArithAbort: true,
    },
    pool: {
      min: 2,
      max: 20,
      idleTimeoutMillis: 30_000,
    },
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
  };
}

/**
 * Get (or create) the singleton connection pool.
 */
export async function getPool(): Promise<any> {
  if (pool && pool.connected) return pool;

  const useMock = process.env['DB_SERVER'] === 'mock' || process.env['DB_USE_MOCK'] === 'true';

  if (!useMock) {
    try {
      logger.info('[DB] Connecting to MS SQL Server...');
      const realPool = new sql.ConnectionPool(getDbConfig());
      realPool.on('error', (err: Error) => {
        logger.error('[DB] Pool error', { error: err.message });
      });
      await realPool.connect();
      logger.info('[DB] Connected to MS SQL Server');
      pool = realPool;
      isMock = false;
      return pool;
    } catch (err: unknown) {
      const isDev = process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test';
      if (isDev) {
        logger.warn('[DB] MS SQL Server not reachable on port 1433. Activating in-memory mock database for development.');
        pool = new MockConnectionPool();
        isMock = true;
        return pool;
      }
      throw err;
    }
  }

  logger.info('[DB] Using in-memory mock database pool');
  pool = new MockConnectionPool();
  isMock = true;
  return pool;
}

/**
 * Close the connection pool gracefully.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    logger.info('[DB] Connection pool closed');
  }
}

/**
 * Execute a callback inside a SQL transaction.
 * Automatically rolls back on any error.
 */
export async function transaction<T>(
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  const p = await getPool();

  if (isMock) {
    const mockTx = {
      request: () => new MockRequest(),
    };
    return await fn(mockTx);
  }

  const tx = new sql.Transaction(p);
  await tx.begin();

  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    logger.error('[DB] Transaction rolled back', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export { sql };
