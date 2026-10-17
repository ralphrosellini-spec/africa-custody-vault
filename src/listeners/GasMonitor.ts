// ============================================================
// src/listeners/GasMonitor.ts
// Monitors gas station wallet balances every 15 minutes.
// Emits LOW_GAS_ALERT if any balance falls below threshold.
// ============================================================

import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { getAdapter, getRegisteredNetworks } from '../chains/index.js';
import { ASSET_DECIMALS, NATIVE_ASSET } from '../utils/constants.js';
import { fromSmallestUnit, isLessThan } from '../utils/bigDecimal.js';
import { WalletService } from '../services/WalletService.js';
import { Network } from '../types/index.js';

interface GasBalance {
  balance: string;
  threshold: string;
  healthy: boolean;
  address: string;
}

export class GasMonitor {
  private cronJob: cron.ScheduledTask | null = null;
  private walletService = new WalletService();
  private lastBalances = new Map<string, GasBalance>();

  start(): void {
    // Every 15 minutes
    this.cronJob = cron.schedule('*/15 * * * *', () => {
      void this.checkAll();
    });

    // Run immediately on start
    void this.checkAll();
    logger.info('[GasMonitor] Started');
  }

  stop(): void {
    this.cronJob?.stop();
    this.cronJob = null;
  }

  async getBalances(): Promise<Record<string, GasBalance>> {
    const result: Record<string, GasBalance> = {};
    for (const [network, balance] of this.lastBalances) {
      result[network] = balance;
    }
    return result;
  }

  private async checkAll(): Promise<void> {
    const networks = getRegisteredNetworks();

    for (const network of networks) {
      try {
        await this.checkNetwork(network);
      } catch (err) {
        logger.error('[GasMonitor] Error checking gas balance', {
          network,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async checkNetwork(network: string): Promise<void> {
    const adapter = getAdapter(network);
    const nativeAsset = NATIVE_ASSET[network] ?? network;
    const decimals = ASSET_DECIMALS[nativeAsset] ?? 18;

    // Get gas station address
    let gasAddress: string;
    try {
      gasAddress = await this.walletService.getGasStationAddress(network as Network);
    } catch {
      return; // Gas station not set up for this network yet
    }

    const balanceRaw = await adapter.getBalance(gasAddress);
    const balance = fromSmallestUnit(balanceRaw, decimals);

    // Get threshold from env
    const thresholdKey = `GAS_ALERT_THRESHOLD_${nativeAsset.toUpperCase()}`;
    const threshold = process.env[thresholdKey] ?? '0.01';

    const healthy = !isLessThan(balance, threshold);

    this.lastBalances.set(network, { balance, threshold, healthy, address: gasAddress });

    if (!healthy) {
      logger.warn('[GasMonitor] LOW GAS BALANCE — action required', {
        network,
        nativeAsset,
        balance,
        threshold,
        gasAddress,
      });
    }
  }
}
