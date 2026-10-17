// ============================================================
// src/services/ReconciliationService.ts
// Compares internal ledger totals against on-chain balances.
// Any mismatch triggers an alert and emergency pause.
// ============================================================

import cron from 'node-cron';
import { getPool, sql } from '../db/connection.js';
import { getAdapter, getRegisteredNetworks } from '../chains/index.js';
import { logger } from '../utils/logger.js';
import { TABLES, NATIVE_ASSET, ASSET_DECIMALS } from '../utils/constants.js';
import { subtract, isZero, fromSmallestUnit } from '../utils/bigDecimal.js';
import { ReconciliationReport } from '../types/index.js';
import { WalletService } from './WalletService.js';

const walletService = new WalletService();

export class ReconciliationService {
  private cronJob: cron.ScheduledTask | null = null;

  async runReconciliation(): Promise<ReconciliationReport[]> {
    logger.info('[Reconciliation] Starting reconciliation run');
    const networks = getRegisteredNetworks();
    const reports: ReconciliationReport[] = [];

    for (const network of networks) {
      try {
        const asset = NATIVE_ASSET[network] ?? network;
        const report = await this.reconcileAsset(network, asset);
        reports.push(report);

        if (report.status === 'MISMATCH') {
          await this.handleMismatch(report);
        }
      } catch (err) {
        logger.error('[Reconciliation] Error reconciling network', {
          network,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('[Reconciliation] Run complete', {
      total: reports.length,
      mismatches: reports.filter((r) => r.status === 'MISMATCH').length,
    });

    return reports;
  }

  private async reconcileAsset(network: string, asset: string): Promise<ReconciliationReport> {
    const pool = await getPool();

    // Internal ledger total = sum of all ledger events for this asset/network
    const ledgerResult = await pool.request()
      .input('asset', sql.NVarChar, asset)
      .input('network', sql.NVarChar, network)
      .query(`
        SELECT ISNULL(SUM(CAST(amount AS DECIMAL(28,18))), 0) as total
        FROM ${TABLES.LEDGER_EVENTS}
        WHERE asset = @asset AND network = @network
      `);

    const internalLedgerTotal = String(ledgerResult.recordset[0]?.total ?? '0');

    // On-chain omnibus balance
    let onChainOmnibusBalance = '0';
    try {
      const omnibusAddress = await walletService.getOmnibusAddress(network as Parameters<typeof walletService.getOmnibusAddress>[0]);
      const adapter = getAdapter(network);
      const rawBalance = await adapter.getBalance(omnibusAddress);
      const decimals = ASSET_DECIMALS[asset] ?? 18;
      onChainOmnibusBalance = fromSmallestUnit(rawBalance, decimals);
    } catch (err) {
      logger.warn('[Reconciliation] Could not fetch on-chain balance', { network, error: String(err) });
    }

    const discrepancy = subtract(internalLedgerTotal, onChainOmnibusBalance);
    const status = isZero(discrepancy) ? 'OK' : 'MISMATCH';

    return {
      runAt: new Date().toISOString(),
      network,
      asset,
      internalLedgerTotal,
      onChainOmnibusBalance,
      discrepancy,
      status,
    };
  }

  private async handleMismatch(report: ReconciliationReport): Promise<void> {
    logger.error('[Reconciliation] BALANCE MISMATCH DETECTED', {
      network: report.network,
      asset: report.asset,
      internal: report.internalLedgerTotal,
      onChain: report.onChainOmnibusBalance,
      discrepancy: report.discrepancy,
    });

    // Trigger emergency pause
    const pool = await getPool();
    await pool.request()
      .input('value', sql.NVarChar, 'true')
      .input('reason', sql.NVarChar, `Auto-paused: reconciliation mismatch on ${report.network}/${report.asset}`)
      .query(`
        UPDATE ${TABLES.CONFIG}
        SET [value] = @value,
            description = @reason,
            updated_at = SYSDATETIMEOFFSET(),
            updated_by = 'reconciliation-service'
        WHERE [key] = 'emergency_pause'
      `);

    logger.error('[Reconciliation] EMERGENCY PAUSE ACTIVATED — investigate immediately');
  }

  startSchedule(): void {
    const cronExpr = process.env['RECONCILIATION_CRON'] ?? '0 */6 * * *';

    this.cronJob = cron.schedule(cronExpr, () => {
      void this.runReconciliation();
    });

    logger.info('[Reconciliation] Scheduled', { cron: cronExpr });
  }

  stopSchedule(): void {
    this.cronJob?.stop();
    this.cronJob = null;
  }
}
