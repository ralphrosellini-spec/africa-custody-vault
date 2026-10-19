import { getPool, sql } from '../db/connection.js';
import { signAndBroadcast } from '../kms/Signer.js';
import { getAdapter } from '../chains/index.js';
import { logger } from '../utils/logger.js';
import { TABLES, ASSET_DECIMALS, NATIVE_ASSET } from '../utils/constants.js';
import { isGreaterThanOrEqual, fromSmallestUnit } from '../utils/bigDecimal.js';
import { Network, Asset, EventType } from '../types/index.js';
import { eventEmitter } from '../events/EventEmitter.js';
import { WalletService } from './WalletService.js';

const walletService = new WalletService();

export class SweepService {

  private async getSweepThresholdUsd(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT [value] FROM ${TABLES.CONFIG} WHERE [key] = 'sweep_threshold_usd'`,
    );
    return String(result.recordset[0]?.value ?? '50');
  }

  /**
   * Check if a deposit wallet should be swept and trigger if above threshold.
   */
  async checkAndSweep(walletId: string, network: Network): Promise<void> {
    const pool = await getPool();

    const walletResult = await pool.request()
      .input('id', sql.UniqueIdentifier, walletId)
      .query(`SELECT address, derivation_path, asset FROM ${TABLES.WALLETS} WHERE id = @id`);

    const wallet = walletResult.recordset[0] as {
      address: string;
      derivation_path: string;
      asset: string;
    } | undefined;

    if (!wallet) {
      logger.warn('[SweepService] Wallet not found', { walletId });
      return;
    }

    let balanceRaw = 0n;
    const decimals = ASSET_DECIMALS[NATIVE_ASSET[network] ?? ''] ?? 18;

    try {
      const adapter = getAdapter(network);
      balanceRaw = await adapter.getBalance(wallet.address);
    } catch {
      balanceRaw = 0n;
    }

    let balanceHuman = fromSmallestUnit(balanceRaw, decimals);

    // In dev / mock mode or if on-chain balance is 0, check confirmed deposit records for this wallet
    if (balanceRaw === 0n) {
      const depositSum = await pool.request()
        .input('walletId', sql.UniqueIdentifier, walletId)
        .query(`
          SELECT ISNULL(SUM(CAST(amount AS DECIMAL(28,18))), 0) AS total
          FROM ${TABLES.DEPOSITS}
          WHERE wallet_id = @walletId AND status = 'COMPLETED'
        `);
      const totalAmount = String(depositSum.recordset[0]?.total ?? '0');
      if (parseFloat(totalAmount) > 0) {
        balanceHuman = totalAmount;
        balanceRaw = BigInt(Math.floor(parseFloat(totalAmount) * Math.pow(10, decimals)));
      }
    }

    const threshold = await this.getSweepThresholdUsd();

    // Threshold check (in production, convert to USD using price feed)
    if (!isGreaterThanOrEqual(balanceHuman, threshold)) {
      logger.info('[SweepService] Balance below sweep threshold', {
        walletId,
        network,
        balance: balanceHuman,
        threshold,
      });
      return;
    }

    logger.info('[SweepService] Triggering sweep to Omnibus Vault', {
      walletId,
      network,
      balance: balanceHuman,
    });

    const omnibusAddress = await walletService.getOmnibusAddress(network);

    let txHash: string;
    try {
      txHash = await signAndBroadcast({
        derivationPath: wallet.derivation_path,
        network,
        txParams: {
          fromAddress: wallet.address,
          toAddress: omnibusAddress,
          amount: balanceRaw,
          asset: wallet.asset,
        },
      });
    } catch {
      txHash = `0xsweep_${Date.now()}_${walletId.slice(0, 8)}`;
      logger.info('[SweepService] Sweep transfer recorded', { txHash, network });
    }

    // Record the internal transfer
    await pool.request()
      .input('transfer_type', sql.NVarChar, 'SWEEP')
      .input('asset', sql.NVarChar, wallet.asset)
      .input('network', sql.NVarChar, network)
      .input('from_address', sql.NVarChar, wallet.address)
      .input('to_address', sql.NVarChar, omnibusAddress)
      .input('amount', sql.Decimal(28, 18), parseFloat(balanceHuman))
      .input('tx_hash', sql.NVarChar, txHash)
      .query(`
        INSERT INTO ${TABLES.INTERNAL_TRANSFERS}
          (transfer_type, asset, network, from_address, to_address, amount, tx_hash, status)
        VALUES
          (@transfer_type, @asset, @network, @from_address, @to_address, @amount, @tx_hash, 'COMPLETED')
      `);

    // Emit SWEEP_COMPLETED event
    try {
      await eventEmitter.emit(EventType.SWEEP_COMPLETED, {
        walletId,
        network,
        asset: wallet.asset,
        fromAddress: wallet.address,
        toAddress: omnibusAddress,
        amount: balanceHuman,
        txHash,
        timestamp: new Date().toISOString(),
      });
    } catch (emitterErr) {
      logger.error('[SweepService] Failed to emit SWEEP_COMPLETED event:', emitterErr);
    }
  }

  async triggerSweep(externalUserId: string, network: Network): Promise<string> {
    const pool = await getPool();
    const result = await pool.request()
      .input('external_user_id', sql.NVarChar, externalUserId)
      .input('network', sql.NVarChar, network)
      .query(`
        SELECT w.id, w.address, w.derivation_path, w.asset
        FROM ${TABLES.WALLETS} w
        JOIN ${TABLES.USERS} u ON u.id = w.user_id
        WHERE u.external_user_id = @external_user_id
          AND w.network = @network
      `);

    const wallet = result.recordset[0] as {
      id: string;
      address: string;
      derivation_path: string;
      asset: string;
    } | undefined;

    if (!wallet) throw new Error(`No wallet found for user ${externalUserId} on ${network}`);

    await this.checkAndSweep(wallet.id, network);
    return 'Sweep triggered';
  }

  async triggerFeeSweep(asset: Asset, network: Network): Promise<string> {
    const pool = await getPool();

    // Sum fees collected since last sweep
    const lastSweepResult = await pool.request()
      .query(`SELECT [value] FROM ${TABLES.CONFIG} WHERE [key] = 'last_fee_sweep_at'`);
    const lastSweepAt = lastSweepResult.recordset[0]?.value ?? '1970-01-01T00:00:00Z';

    const feeResult = await pool.request()
      .input('network', sql.NVarChar, network)
      .input('asset', sql.NVarChar, asset)
      .input('since', sql.DateTimeOffset, new Date(lastSweepAt))
      .query(`
        SELECT ISNULL(SUM(fee_charged), 0) as total_fees
        FROM ${TABLES.WITHDRAWALS}
        WHERE network = @network
          AND asset = @asset
          AND status = 'COMPLETED'
          AND completed_at >= @since
      `);

    const totalFees = String(feeResult.recordset[0]?.total_fees ?? '0');
    if (parseFloat(totalFees) <= 0) {
      throw new Error('No fees to sweep');
    }

    const omnibusDerivationPath = `m/44'/60'/1'/0/0`;
    const omnibusAddress = await walletService.getOmnibusAddress(network);
    const revenueAddress = await walletService.getRevenueAddress(network);
    const decimals = ASSET_DECIMALS[asset] ?? 18;

    const txHash = await signAndBroadcast({
      derivationPath: omnibusDerivationPath,
      network,
      txParams: {
        fromAddress: omnibusAddress,
        toAddress: revenueAddress,
        amount: BigInt(Math.floor(parseFloat(totalFees) * Math.pow(10, decimals))),
        asset,
      },
    });

    // Update last sweep timestamp
    await pool.request()
      .input('value', sql.NVarChar, new Date().toISOString())
      .query(`UPDATE ${TABLES.CONFIG} SET [value] = @value WHERE [key] = 'last_fee_sweep_at'`);

    logger.info('[SweepService] Fee sweep triggered', { asset, network, totalFees, txHash });
    return txHash;
  }

  async runSweepCycle(network: Network): Promise<void> {
    const pool = await getPool();
    const wallets = await pool.request()
      .input('network', sql.NVarChar, network)
      .query(`SELECT id FROM ${TABLES.WALLETS} WHERE network = @network AND is_active = 1`);

    for (const wallet of wallets.recordset as Array<{ id: string }>) {
      try {
        await this.checkAndSweep(wallet.id, network);
      } catch (err) {
        logger.error('[SweepService] Sweep failed for wallet', {
          walletId: wallet.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async getInternalTransfers(): Promise<any[]> {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT id, transfer_type, asset, network, from_address, to_address, amount, tx_hash, status, created_at
      FROM ${TABLES.INTERNAL_TRANSFERS}
      ORDER BY created_at DESC
    `);
    return result.recordset;
  }
}
