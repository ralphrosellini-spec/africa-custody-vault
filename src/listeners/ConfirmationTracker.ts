// ============================================================
// src/listeners/ConfirmationTracker.ts
// Polls pending deposits and withdrawals every 30 seconds
// and updates confirmation counts.
// ============================================================

import { getAdapter } from '../chains/index.js';
import { logger } from '../utils/logger.js';
import { DepositService } from '../services/DepositService.js';
import { WithdrawalService } from '../services/WithdrawalService.js';
import { TxStatus, Network } from '../types/index.js';
import { REQUIRED_CONFIRMATIONS } from '../utils/constants.js';

const POLL_INTERVAL_MS = 30_000; // 30 seconds

type HealthCallback = (healthy: boolean) => void;

export class ConfirmationTracker {
  private readonly network: string;
  private readonly onHealth: HealthCallback;
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  private readonly depositService = new DepositService();
  private readonly withdrawalService = new WithdrawalService();

  constructor(network: string, onHealth: HealthCallback) {
    this.network = network;
    this.onHealth = onHealth;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.intervalId = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);

    logger.info('[ConfirmationTracker] Started', { network: this.network });
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      await Promise.all([
        this.pollDeposits(),
        this.pollWithdrawals(),
      ]);
      this.onHealth(true);
    } catch (err) {
      this.onHealth(false);
      logger.error('[ConfirmationTracker] Poll error', {
        network: this.network,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async pollDeposits(): Promise<void> {
    const adapter = getAdapter(this.network);
    const pendingDeposits = await this.depositService.getPendingDeposits(this.network as Network);

    for (const deposit of pendingDeposits) {
      try {
        const txStatus = await adapter.getTransactionStatus(deposit.txHash);

        if (txStatus.status === 'FAILED') {
          await this.depositService.updateConfirmations(deposit.txHash, 0, this.network as Network, true);
          continue;
        }

        await this.depositService.updateConfirmations(
          deposit.txHash,
          txStatus.confirmations,
          this.network as Network,
          false,
        );
      } catch (err) {
        logger.warn('[ConfirmationTracker] Error checking deposit', {
          txHash: deposit.txHash,
          error: String(err),
        });
      }
    }
  }

  private async pollWithdrawals(): Promise<void> {
    const adapter = getAdapter(this.network);
    const requiredConfs = REQUIRED_CONFIRMATIONS[this.network] ?? 12;
    const pendingWithdrawals = await this.withdrawalService.getPendingWithdrawals(this.network as Network);

    for (const withdrawal of pendingWithdrawals) {
      if (!withdrawal.txHash) continue;

      try {
        const txStatus = await adapter.getTransactionStatus(withdrawal.txHash);

        if (txStatus.status === 'FAILED') {
          await this.withdrawalService.markFailed(withdrawal.id, 'Transaction failed on-chain');
          continue;
        }

        if (txStatus.status === 'CONFIRMED' && txStatus.confirmations >= requiredConfs) {
          await this.withdrawalService.markCompleted(withdrawal.id, withdrawal.txHash);
        } else {
          const newStatus =
            txStatus.confirmations === 0 ? TxStatus.UNCONFIRMED : TxStatus.CONFIRMING;
          await this.withdrawalService.updateWithdrawalStatus(
            withdrawal.id,
            newStatus,
            txStatus.confirmations,
          );
        }
      } catch (err) {
        logger.warn('[ConfirmationTracker] Error checking withdrawal', {
          withdrawalId: withdrawal.id,
          error: String(err),
        });
      }
    }
  }
}
