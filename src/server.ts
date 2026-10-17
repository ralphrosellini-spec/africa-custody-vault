// ============================================================
// src/server.ts — Application entry point
// ============================================================

import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';
import { getPool, closePool } from './db/connection.js';
import { initializeAdapters } from './chains/index.js';
import { logger } from './utils/logger.js';
import { DepositListenerManager } from './listeners/DepositListenerManager.js';
import { GasMonitor } from './listeners/GasMonitor.js';
import { ReconciliationService } from './services/ReconciliationService.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

let server: http.Server;
const listenerManager = new DepositListenerManager();
const gasMonitor = new GasMonitor();
const reconciliationService = new ReconciliationService();

async function bootstrap(): Promise<void> {
  logger.info('[Server] Starting Custody Vault...');

  // 1. Connect to database
  await getPool();
  logger.info('[Server] Database connected');

  // 2. Initialize chain adapters
  initializeAdapters({
    alchemyEthRpc: process.env['ALCHEMY_ETH_RPC'],
    alchemyBscRpc: process.env['ALCHEMY_BSC_RPC'],
    alchemyPolygonRpc: process.env['ALCHEMY_POLYGON_RPC'],
    quicknodeEthRpc: process.env['QUICKNODE_ETH_RPC'],
    quicknodeBscRpc: process.env['QUICKNODE_BSC_RPC'],
    quicknodePolygonRpc: process.env['QUICKNODE_POLYGON_RPC'],
    bitcoinRpcUrl: process.env['BITCOIN_RPC_URL'],
    litecoinRpcUrl: process.env['LITECOIN_RPC_URL'],
    dogecoinRpcUrl: process.env['DOGECOIN_RPC_URL'],
    tronRpcUrl: process.env['TRON_RPC_URL'],
    tronApiKey: process.env['TRON_API_KEY'],
    solanaRpcUrl: process.env['SOLANA_RPC_URL'],
    xrpWsUrl: process.env['XRP_WS_URL'],
  });

  // 3. Start Express server
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, '0.0.0.0', resolve));
  logger.info(`[Server] Listening on 0.0.0.0:${PORT}`);

  // 4. Start blockchain listeners
  await listenerManager.startAll();
  logger.info('[Server] Blockchain listeners started');

  // 5. Start gas monitor
  gasMonitor.start();
  logger.info('[Server] Gas monitor started');

  // 6. Start reconciliation schedule
  reconciliationService.startSchedule();
  logger.info('[Server] Reconciliation scheduler started');

  logger.info('[Server] Custody Vault is ready');
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`[Server] ${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  server?.close();

  // Stop background jobs
  reconciliationService.stopSchedule();
  gasMonitor.stop();
  await listenerManager.stop();

  // Close DB pool
  await closePool();

  logger.info('[Server] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

process.on('unhandledRejection', (reason) => {
  logger.error('[Server] Unhandled promise rejection', { reason });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('[Server] Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

bootstrap().catch((err) => {
  // Use console.error here ONLY because logger may not be initialized
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
