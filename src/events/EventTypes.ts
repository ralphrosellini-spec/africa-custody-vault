import { Network, Asset, EventType } from '../types';

export interface DepositConfirmedPayload {
  depositId: string;
  userId: string;
  walletId: string;
  txHash: string;
  network: Network;
  asset: Asset;
  amount: string; // Smallest unit as string
  confirmations: number;
  confirmedAt: string; // ISO-8601 string
}

export interface WithdrawalCompletedPayload {
  withdrawalId: string;
  userId: string;
  network: Network;
  asset: Asset;
  grossAmount: string;
  netAmountSent: string;
  feeCharged: string;
  destinationAddress: string;
  txHash: string;
  completedAt: string;
}

export interface WithdrawalFailedPayload {
  withdrawalId: string;
  userId: string;
  network: Network;
  asset: Asset;
  amount: string;
  destinationAddress: string;
  reason: string;
  failedAt: string;
}

export interface SweepCompletedPayload {
  transferId: string;
  network: Network;
  asset: Asset;
  fromAddress: string;
  toAddress: string;
  amount: string;
  txHash: string;
  completedAt: string;
}

export interface FeeSweepCompletedPayload {
  network: Network;
  asset: Asset;
  fromAddress: string;
  toAddress: string;
  totalFeeAmount: string;
  txHash: string;
  completedAt: string;
}

export interface LowGasAlertPayload {
  network: Network;
  gasStationAddress: string;
  currentBalance: string;
  threshold: string;
  alertAt: string;
}

export interface ReconciliationMismatchPayload {
  network: Network;
  asset: Asset;
  internalLedgerTotal: string;
  onChainOmnibusBalance: string;
  discrepancy: string;
  detectedAt: string;
  status: 'MISMATCH';
}

export interface CustodyVaultEvent<T = unknown> {
  eventId: string; // UUID v4
  eventType: EventType;
  timestamp: string; // ISO-8601 string
  signature: string; // HMAC SHA-256 signature
  data: T;
}
