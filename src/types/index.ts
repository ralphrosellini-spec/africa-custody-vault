// ============================================================
// src/types/index.ts
// All shared TypeScript types and enums used across the project
// ============================================================

// ---- Enums ----

export enum Network {
  ETH = 'ETH',
  BSC = 'BSC',
  POLYGON = 'POLYGON',
  BTC = 'BTC',
  LTC = 'LTC',
  DOGE = 'DOGE',
  TRX = 'TRX',
  SOL = 'SOL',
  XRP = 'XRP',
  // Backward compatibility aliases
  ETHEREUM = 'ETH',
  BITCOIN = 'BTC',
  LITECOIN = 'LTC',
  DOGECOIN = 'DOGE',
  TRON = 'TRX',
  SOLANA = 'SOL',
}

export enum Asset {
  ETH = 'ETH',
  BNB = 'BNB',
  USDT_ERC20 = 'USDT_ERC20',
  USDT_BEP20 = 'USDT_BEP20',
  USDT_TRC20 = 'USDT_TRC20',
  USDC_ERC20 = 'USDC_ERC20',
  BTC = 'BTC',
  LTC = 'LTC',
  DOGE = 'DOGE',
  TRX = 'TRX',
  SOL = 'SOL',
  XRP = 'XRP',
  POL = 'POL',
  MATIC = 'POL',
  // Generic token aliases
  USDT = 'USDT_ERC20',
  USDC = 'USDC_ERC20',
}

export enum TxStatus {
  PENDING = 'PENDING',
  BROADCASTING = 'BROADCASTING',
  UNCONFIRMED = 'UNCONFIRMED',
  CONFIRMING = 'CONFIRMING',
  COMPLETED = 'COMPLETED',
  CONFIRMED = 'COMPLETED',
  FAILED = 'FAILED',
  DROPPED = 'FAILED',
}

export enum TransferType {
  SWEEP = 'SWEEP',
  FEE_SWEEP = 'FEE_SWEEP',
  GAS_REFILL = 'GAS_REFILL',
}

export enum EventType {
  DEPOSIT_DETECTED = 'DEPOSIT_DETECTED',
  DEPOSIT_CONFIRMED = 'DEPOSIT_CONFIRMED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_BROADCAST = 'WITHDRAWAL_BROADCAST',
  WITHDRAWAL_CONFIRMED = 'WITHDRAWAL_CONFIRMED',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_FAILED = 'WITHDRAWAL_FAILED',
  SWEEP_INITIATED = 'SWEEP_INITIATED',
  SWEEP_COMPLETED = 'SWEEP_COMPLETED',
  SWEEP_CONFIRMED = 'SWEEP_CONFIRMED',
  FEE_SWEEP_COMPLETED = 'FEE_SWEEP_COMPLETED',
  LOW_GAS_ALERT = 'LOW_GAS_ALERT',
  ALERT_GAS_LOW = 'LOW_GAS_ALERT',
  RECONCILIATION_COMPLETED = 'RECONCILIATION_COMPLETED',
  RECONCILIATION_DISCREPANCY = 'RECONCILIATION_MISMATCH',
  RECONCILIATION_MISMATCH = 'RECONCILIATION_MISMATCH',
}

export enum VaultType {
  USER_DEPOSIT = 'USER_DEPOSIT',
  OMNIBUS = 'OMNIBUS',
  REVENUE = 'REVENUE',
  GAS_STATION = 'GAS_STATION',
  USER = 'USER_DEPOSIT',
}

export enum LedgerEventType {
  DEPOSIT_CREDIT = 'DEPOSIT_CREDIT',
  WITHDRAWAL_DEBIT = 'WITHDRAWAL_DEBIT',
  FEE_DEBIT = 'FEE_DEBIT',
}

// ---- DB Row Interfaces (mirrors SQL tables) ----

export interface DbUser {
  id: string;
  external_user_id: string;
  derivation_index: number;
  created_at: Date;
  updated_at: Date;
}

export interface DbWallet {
  id: string;
  user_id: string;
  network: string;
  asset: string;
  address: string;
  derivation_path: string;
  is_active: boolean;
  created_at: Date;
}

export interface DbDeposit {
  id: string;
  wallet_id: string;
  tx_hash: string;
  asset: string;
  network: string;
  amount: string;
  confirmations: number;
  status: string;
  detected_at: Date;
  confirmed_at: Date | null;
}

export interface DbWithdrawal {
  id: string;
  user_id: string;
  asset: string;
  network: string;
  destination_address: string;
  gross_amount: string;
  fee_charged: string;
  net_amount_sent: string;
  tx_hash: string | null;
  status: string;
  failure_reason: string | null;
  requestor_ip: string;
  requestor_api_key_id: string;
  requested_at: Date;
  completed_at: Date | null;
}

export interface DbInternalTransfer {
  id: string;
  transfer_type: string;
  asset: string;
  network: string;
  from_address: string;
  to_address: string;
  amount: string;
  tx_hash: string | null;
  status: string;
  created_at: Date;
  completed_at: Date | null;
}

export interface DbLedgerEvent {
  id: string;
  user_id: string;
  event_type: string;
  asset: string;
  network: string;
  amount: string;
  reference_id: string;
  reference_type: string;
  created_at: Date;
}

export interface DbConfig {
  key: string;
  value: string;
  description: string | null;
  updated_at: Date;
  updated_by: string;
}

export interface DbApiKey {
  id: string;
  key_hash: string;
  key_id: string;
  caller_name: string;
  is_admin: boolean;
  is_active: boolean;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

// ---- API / Service Interfaces ----

export interface WalletAddress {
  network: Network;
  address: string;
  derivationPath?: string | undefined;
  tagOrMemo?: string | undefined;
}

export interface UserWalletsResult {
  externalUserId: string;
  wallets: WalletAddress[];
}

export interface CreateWalletRequest {
  externalUserId: string;
  networks?: Network[] | undefined;
}

export interface WalletRecord {
  id: string;
  userId?: string | undefined;
  externalUserId?: string | undefined;
  network: Network;
  asset?: Asset | undefined;
  address: string;
  derivationPath: string;
  isActive?: boolean | undefined;
  createdAt: Date;
}

export interface DepositRecord {
  id: string;
  walletId?: string | undefined;
  externalUserId?: string | undefined;
  txHash: string;
  asset: Asset;
  network: Network;
  amount: string;
  confirmations: number;
  status: TxStatus;
  detectedAt?: Date | undefined;
  confirmedAt?: Date | undefined;
  blockNumber?: number | undefined;
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export interface WithdrawalRequest {
  externalUserId: string;
  asset: Asset;
  network: Network;
  destinationAddress: string;
  grossAmount: string;
  destinationTag?: string | undefined;
  requestorIp: string;
  requestorApiKeyId: string;
}

export interface WithdrawalRecord {
  id: string;
  userId?: string | undefined;
  externalUserId?: string | undefined;
  asset: Asset;
  network: Network;
  destinationAddress: string;
  grossAmount: string;
  feeCharged?: string | undefined;
  feeAmount?: string | undefined;
  netAmountSent?: string | undefined;
  netAmount?: string | undefined;
  txHash?: string | undefined;
  status: TxStatus;
  failureReason?: string | undefined;
  requestorIp?: string | undefined;
  requestorApiKeyId?: string | undefined;
  destinationTag?: string | undefined;
  requestedAt?: Date | undefined;
  completedAt?: Date | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export interface TransactionRecord {
  id: string;
  txHash: string;
  network: Network;
  asset: Asset;
  amount: string;
  status: TxStatus;
  blockNumber?: number | undefined;
  confirmations?: number | undefined;
  fromAddress: string;
  toAddress: string;
  createdAt: Date;
}

export interface BalanceRecord {
  externalUserId: string;
  asset: Asset;
  network: Network;
  availableBalance: string;
}

export interface CustodyEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: EventType;
  timestamp: string;
  signature: string;
  data: T;
}

export interface DepositConfirmedPayload {
  externalUserId: string;
  asset: Asset;
  network: Network;
  amount: string;
  txHash: string;
  confirmations: number;
}

export interface WithdrawalCompletedPayload {
  withdrawalId: string;
  externalUserId: string;
  asset: Asset;
  network: Network;
  amount: string;
  txHash: string;
}

export interface WithdrawalFailedPayload {
  withdrawalId: string;
  externalUserId: string;
  asset: Asset;
  network: Network;
  reason: string;
}

export interface LowGasAlertPayload {
  network: Network;
  balance: string;
  threshold: string;
  gasStationAddress: string;
}

export interface ReconciliationMismatchPayload {
  network: Network;
  asset: Asset;
  internalTotal: string;
  onChainTotal: string;
  discrepancy: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
  requestId: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SweepResult {
  success: boolean;
  network: Network;
  sweepTxHashes: string[];
  totalAmountSwept: string;
  message?: string | undefined;
}

export interface ReconciliationReport {
  runAt: string;
  network: string;
  asset: string;
  internalLedgerTotal: string;
  onChainOmnibusBalance: string;
  discrepancy: string;
  status: 'OK' | 'MISMATCH';
  reconciledAt?: Date | undefined;
  isBalanced?: boolean | undefined;
  totalAssetsChecked?: number | undefined;
  discrepancies?: Array<{
    asset: Asset;
    network: Network;
    ledgerBalance: string;
    onChainBalance: string;
    difference: string;
  }> | undefined;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  gasBalances: Record<string, { balance: string; isLow: boolean }>;
  listeners: Record<string, { active: boolean; lastBlockProcessed: number }>;
  database: 'connected' | 'disconnected';
  queue: 'connected' | 'disconnected';
}
