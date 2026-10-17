// ============================================================
// src/chains/index.ts
// Chain adapter registry — initialised once at startup.
// All business logic calls getAdapter(network) from here.
// ============================================================

import { ChainAdapter } from './ChainAdapter.js';
import { EVMAdapter } from './EVMAdapter.js';
import { BitcoinAdapter } from './BitcoinAdapter.js';
import { TronAdapter } from './TronAdapter.js';
import { SolanaAdapter } from './SolanaAdapter.js';
import { XRPAdapter } from './XRPAdapter.js';
import { logger } from '../utils/logger.js';

export interface ChainConfig {
  alchemyEthRpc?: string;
  alchemyBscRpc?: string;
  alchemyPolygonRpc?: string;
  quicknodeEthRpc?: string;
  quicknodeBscRpc?: string;
  quicknodePolygonRpc?: string;
  bitcoinRpcUrl?: string;
  litecoinRpcUrl?: string;
  dogecoinRpcUrl?: string;
  tronRpcUrl?: string;
  tronApiKey?: string;
  solanaRpcUrl?: string;
  xrpWsUrl?: string;
}

const adapters = new Map<string, ChainAdapter>();

export function initializeAdapters(config: ChainConfig): void {
  // EVM adapters (with Alchemy primary + QuickNode fallback)
  if (config.alchemyEthRpc) {
    adapters.set('ETH', new EVMAdapter({
      network: 'ETH',
      rpcUrl: config.alchemyEthRpc,
      fallbackRpcUrl: config.quicknodeEthRpc,
    }));
  }

  if (config.alchemyBscRpc) {
    adapters.set('BSC', new EVMAdapter({
      network: 'BSC',
      rpcUrl: config.alchemyBscRpc,
      fallbackRpcUrl: config.quicknodeBscRpc,
    }));
  }

  if (config.alchemyPolygonRpc) {
    adapters.set('POLYGON', new EVMAdapter({
      network: 'POLYGON',
      rpcUrl: config.alchemyPolygonRpc,
      fallbackRpcUrl: config.quicknodePolygonRpc,
    }));
  }

  // UTXO adapters
  if (config.bitcoinRpcUrl) {
    adapters.set('BTC', new BitcoinAdapter('BTC', config.bitcoinRpcUrl));
  }
  if (config.litecoinRpcUrl) {
    adapters.set('LTC', new BitcoinAdapter('LTC', config.litecoinRpcUrl));
  }
  if (config.dogecoinRpcUrl) {
    adapters.set('DOGE', new BitcoinAdapter('DOGE', config.dogecoinRpcUrl));
  }

  // Tron
  if (config.tronRpcUrl) {
    adapters.set('TRX', new TronAdapter(config.tronRpcUrl, config.tronApiKey));
  }

  // Solana
  if (config.solanaRpcUrl) {
    adapters.set('SOL', new SolanaAdapter(config.solanaRpcUrl));
  }

  // XRP
  if (config.xrpWsUrl) {
    adapters.set('XRP', new XRPAdapter(config.xrpWsUrl));
  }

  logger.info('[Chains] Adapters initialized', {
    networks: Array.from(adapters.keys()),
  });
}

/**
 * Get the chain adapter for a network.
 * Throws if the network is not configured.
 */
export function getAdapter(network: string): ChainAdapter {
  const adapter = adapters.get(network.toUpperCase());
  if (!adapter) {
    throw new Error(`No chain adapter configured for network: ${network}`);
  }
  return adapter;
}

/**
 * Get all registered networks.
 */
export function getRegisteredNetworks(): string[] {
  return Array.from(adapters.keys());
}

export { ChainAdapter };
