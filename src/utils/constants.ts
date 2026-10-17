// ============================================================
// src/utils/constants.ts
// ============================================================

import { Network } from '../types/index.js';

export const REQUIRED_CONFIRMATIONS: Record<string, number> = {
  [Network.ETH]: 12,
  [Network.BSC]: 15,
  [Network.POLYGON]: 128,
  [Network.BTC]: 3,
  [Network.LTC]: 6,
  [Network.DOGE]: 6,
  [Network.TRX]: 19,
  [Network.SOL]: 32,
  [Network.XRP]: 1,
};

/** BIP44 coin_type per network */
export const COIN_TYPE: Record<string, number> = {
  [Network.BTC]: 0,
  [Network.LTC]: 2,
  [Network.DOGE]: 3,
  [Network.ETH]: 60,
  [Network.BSC]: 60,
  [Network.POLYGON]: 60,
  [Network.TRX]: 195,
  [Network.SOL]: 501,
  [Network.XRP]: 144,
};

/** EVM chainId per network */
export const EVM_CHAIN_IDS: Record<string, number> = {
  [Network.ETH]: 1,
  [Network.BSC]: 56,
  [Network.POLYGON]: 137,
};

/** BIP44 account index per vault type */
export const VAULT_ACCOUNT_INDEX = {
  USER_DEPOSIT: 0,
  OMNIBUS: 1,
  REVENUE: 2,
  GAS_STATION: 3,
} as const;

/** DB table names — prefixed cv_ to avoid collisions */
export const TABLES = {
  USERS: 'cv_users',
  WALLETS: 'cv_wallets',
  DEPOSITS: 'cv_deposits',
  WITHDRAWALS: 'cv_withdrawals',
  INTERNAL_TRANSFERS: 'cv_internal_transfers',
  LEDGER_EVENTS: 'cv_ledger_events',
  CONFIG: 'cv_config',
  API_KEYS: 'cv_api_keys',
  MIGRATIONS: 'cv_migrations',
} as const;

export const RABBITMQ_EXCHANGE = 'custody.events';
export const RABBITMQ_WEBHOOK_QUEUE = 'custody.webhooks';
export const RABBITMQ_DLQ = 'custody.webhooks.dlq';

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

/** HMAC algorithm used for request and webhook signing */
export const HMAC_ALGORITHM = 'sha256';

/** Maximum age of a signed request before it's rejected (replay protection) */
export const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/** USD value above which a withdrawal triggers an alert */
export const DEFAULT_WITHDRAWAL_ALERT_USD = 10_000;

/** Default sweep threshold in USD equivalent */
export const DEFAULT_SWEEP_THRESHOLD_USD = 50;

/** Rate limit defaults */
export const RATE_LIMIT_DEFAULTS = {
  STANDARD_WINDOW_MS: 60 * 1000,
  STANDARD_MAX: 100,
  WITHDRAWAL_WINDOW_MS: 60 * 1000,
  WITHDRAWAL_MAX: 10,
  ADMIN_WINDOW_MS: 60 * 1000,
  ADMIN_MAX: 30,
};

/** Pagination defaults */
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
};

/** All networks supported in Phase 1 */
export const SUPPORTED_NETWORKS: Network[] = [
  Network.ETH,
  Network.BSC,
  Network.POLYGON,
  Network.BTC,
  Network.LTC,
  Network.DOGE,
  Network.TRX,
  Network.SOL,
  Network.XRP,
];

/** Networks that are EVM-compatible (share EVMAdapter) */
export const EVM_NETWORKS: Network[] = [Network.ETH, Network.BSC, Network.POLYGON];

/** Default asset per network (native coin) */
export const NATIVE_ASSET: Record<string, string> = {
  [Network.ETH]: 'ETH',
  [Network.BSC]: 'BNB',
  [Network.POLYGON]: 'POL',
  [Network.BTC]: 'BTC',
  [Network.LTC]: 'LTC',
  [Network.DOGE]: 'DOGE',
  [Network.TRX]: 'TRX',
  [Network.SOL]: 'SOL',
  [Network.XRP]: 'XRP',
};

/** Decimal places for native assets (for fromWei/toWei conversions) */
export const ASSET_DECIMALS: Record<string, number> = {
  ETH: 18,
  BNB: 18,
  POL: 18,
  MATIC: 18,
  BTC: 8,
  LTC: 8,
  DOGE: 8,
  TRX: 6,     // SUN
  SOL: 9,     // lamports
  XRP: 6,     // drops
  USDT_ERC20: 6,
  USDT_BEP20: 18,
  USDT_TRC20: 6,
  USDC_ERC20: 6,
};
