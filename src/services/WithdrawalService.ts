// ============================================================
// src/services/WithdrawalService.ts
// MOST CRITICAL SERVICE — handles all outgoing transactions.
// Balance debit happens in the SAME SQL transaction as the
// withdrawal record creation. Never debit after signing.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { getPool, transaction, sql } from '../db/connection.js';
import { signAndBroadcast } from '../kms/Signer.js';
import { logger } from '../utils/logger.js';
import { subtract, isGreaterThanOrEqual } from '../utils/bigDecimal.js';
import { TABLES } from '../utils/constants.js';
import {
  WithdrawalRequest,
  WithdrawalRecord,
  TxStatus,
  Network,
  Asset,
} from '../types/index.js';
import { InsufficientBalanceError, AppError } from '../api/middleware/errorHandler.js';

export class WithdrawalService {

  /**
   * Creates and processes a withdrawal.
   *
   * SAFETY SEQUENCE:
   * 1. Check emergency_pause flag
   * 2. Get withdrawal fee from config
   * 3. In ONE SQL transaction: check balance, INSERT record, debit omnibus
   * 4. Sign and broadcast (outside the transaction)
   * 5. Update status to BROADCASTING
   */
  async createWithdrawal(request: WithdrawalRequest): Promise<WithdrawalRecord> {
    const pool = await getPool();

    // 1. Check emergency pause
    const configResult = await pool.request().query(
      `SELECT [value] FROM ${TABLES.CONFIG} WHERE [key] = 'emergency_pause'`,
    );
    if (configResult.recordset[0]?.value === 'true') {
      throw new AppError(503, 'All outgoing transactions are currently paused. Contact support.');
    }

    // 2. Get fee for this asset
    const feeResult = await pool.request()
      .input('key', sql.NVarChar, `withdrawal_fee_${request.asset}`)
      .query(`SELECT [value] FROM ${TABLES.CONFIG} WHERE [key] = @key`);
    const feeCharged = feeResult.recordset[0]?.value ?? '0';
    const netAmountSent = subtract(request.grossAmount, feeCharged);

    if (!isGreaterThanOrEqual(netAmountSent, '0')) {
      throw new AppError(400, 'Gross amount is less than the withdrawal fee');
    }

    // 3. Get user record
    const userResult = await pool.request()
      .input('external_user_id', sql.NVarChar, request.externalUserId)
      .query(`SELECT id FROM ${TABLES.USERS} WHERE external_user_id = @external_user_id`);

    const user = userResult.recordset[0] as { id: string } | undefined;
    if (!user) throw new AppError(404, 'User not found');

    // 4. Get omnibus derivation path for this network
    const omnibusWallet = await pool.request()
      .input('network', sql.NVarChar, request.network)
      .query(`
        SELECT address, derivation_path FROM ${TABLES.WALLETS}
        WHERE user_id = '00000000-0000-0000-0000-000000000001'
          AND network = @network
      `);

    // For MVP: use a hardcoded omnibus wallet path per network
    // In production this is stored under a system user
    const omnibusDerivationPath = omnibusWallet.recordset[0]?.derivation_path
      ?? `m/44'/60'/1'/0/0`; // fallback EVM omnibus path
    const omnibusAddress = omnibusWallet.recordset[0]?.address ?? '';

    // 5. Critical: check balance + debit in ONE transaction
    let withdrawalId: string;

    await transaction(async (tx) => {
      // Check omnibus balance (simplified — in production sum ledger_events)
      const balanceResult = await tx.request()
        .input('asset', sql.NVarChar, request.asset)
        .input('network', sql.NVarChar, request.network)
        .query(`
          SELECT ISNULL(SUM(CAST(amount AS DECIMAL(28,18))), 0) as balance
          FROM ${TABLES.LEDGER_EVENTS}
          WHERE asset = @asset AND network = @network
        `);

      const currentBalance = String(balanceResult.recordset[0]?.balance ?? '0');

      if (!isGreaterThanOrEqual(currentBalance, request.grossAmount)) {
        throw new InsufficientBalanceError();
      }

      // Insert withdrawal record
      withdrawalId = uuidv4();
      await tx.request()
        .input('id', sql.UniqueIdentifier, withdrawalId)
        .input('user_id', sql.UniqueIdentifier, user.id)
        .input('asset', sql.NVarChar, request.asset)
        .input('network', sql.NVarChar, request.network)
        .input('destination_address', sql.NVarChar, request.destinationAddress)
        .input('gross_amount', sql.Decimal(28, 18), parseFloat(request.grossAmount))
        .input('fee_charged', sql.Decimal(28, 18), parseFloat(feeCharged))
        .input('net_amount_sent', sql.Decimal(28, 18), parseFloat(netAmountSent))
        .input('requestor_ip', sql.NVarChar, request.requestorIp)
        .input('requestor_api_key_id', sql.NVarChar, request.requestorApiKeyId)
        .query(`
          INSERT INTO ${TABLES.WITHDRAWALS}
            (id, user_id, asset, network, destination_address,
             gross_amount, fee_charged, net_amount_sent,
             requestor_ip, requestor_api_key_id, status)
          VALUES
            (@id, @user_id, @asset, @network, @destination_address,
             @gross_amount, @fee_charged, @net_amount_sent,
             @requestor_ip, @requestor_api_key_id, 'PENDING')
        `);

      // Debit the omnibus ledger (negative amount = debit)
      await tx.request()
        .input('user_id', sql.UniqueIdentifier, user.id)
        .input('event_type', sql.NVarChar, 'WITHDRAWAL_DEBIT')
        .input('asset', sql.NVarChar, request.asset)
        .input('network', sql.NVarChar, request.network)
        .input('amount', sql.Decimal(28, 18), -parseFloat(request.grossAmount))
        .input('reference_id', sql.NVarChar, withdrawalId!)
        .input('reference_type', sql.NVarChar, 'withdrawal')
        .query(`
          INSERT INTO ${TABLES.LEDGER_EVENTS}
            (user_id, event_type, asset, network, amount, reference_id, reference_type)
          VALUES
            (@user_id, @event_type, @asset, @network, @amount, @reference_id, @reference_type)
        `);
    });

    logger.info('[WithdrawalService] Withdrawal record created and balance debited', {
      withdrawalId: withdrawalId!,
      asset: request.asset,
      grossAmount: request.grossAmount,
    });

    // 6. Sign and broadcast (outside the SQL transaction)
    try {
      const txHash = await signAndBroadcast({
        derivationPath: omnibusDerivationPath,
        network: request.network,
        txParams: {
          fromAddress: omnibusAddress,
          toAddress: request.destinationAddress,
          amount: BigInt(Math.floor(parseFloat(netAmountSent) * 1e18)),
          asset: request.asset,
        },
      });

      // 7. Update to BROADCASTING
      await pool.request()
        .input('id', sql.UniqueIdentifier, withdrawalId!)
        .input('tx_hash', sql.NVarChar, txHash)
        .query(`
          UPDATE ${TABLES.WITHDRAWALS}
          SET status = 'BROADCASTING', tx_hash = @tx_hash
          WHERE id = @id
        `);

      logger.info('[WithdrawalService] Withdrawal broadcast', { withdrawalId: withdrawalId!, txHash });

    } catch (err) {
      // Broadcast failed — mark as FAILED and refund the debit
      await this.markFailed(withdrawalId!, `Broadcast failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    return this.getWithdrawal(withdrawalId!) as Promise<WithdrawalRecord>;
  }

  async updateWithdrawalStatus(
    withdrawalId: string,
    status: TxStatus,
    confirmations: number,
  ): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .input('status', sql.NVarChar, status)
      .input('confirmations', sql.Int, confirmations)
      .query(`
        UPDATE ${TABLES.WITHDRAWALS}
        SET status = @status
        WHERE id = @id
      `);
  }

  async markCompleted(withdrawalId: string, txHash: string): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .input('tx_hash', sql.NVarChar, txHash)
      .query(`
        UPDATE ${TABLES.WITHDRAWALS}
        SET status = 'COMPLETED',
            tx_hash = @tx_hash,
            completed_at = SYSDATETIMEOFFSET()
        WHERE id = @id
      `);

    logger.info('[WithdrawalService] Withdrawal completed', { withdrawalId, txHash });
  }

  async markFailed(withdrawalId: string, reason: string): Promise<void> {
    const pool = await getPool();

    // Get withdrawal to refund the debit
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .query(`
        SELECT user_id, gross_amount, asset, network
        FROM ${TABLES.WITHDRAWALS}
        WHERE id = @id
      `);

    const w = result.recordset[0] as {
      user_id: string;
      gross_amount: string;
      asset: string;
      network: string;
    } | undefined;

    await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .input('reason', sql.NVarChar, reason)
      .query(`
        UPDATE ${TABLES.WITHDRAWALS}
        SET status = 'FAILED',
            failure_reason = @reason,
            completed_at = SYSDATETIMEOFFSET()
        WHERE id = @id
      `);

    // Refund the debited balance (credit it back)
    if (w) {
      await pool.request()
        .input('user_id', sql.UniqueIdentifier, w.user_id)
        .input('asset', sql.NVarChar, w.asset)
        .input('network', sql.NVarChar, w.network)
        .input('amount', sql.Decimal(28, 18), parseFloat(String(w.gross_amount)))
        .input('reference_id', sql.NVarChar, withdrawalId)
        .query(`
          INSERT INTO ${TABLES.LEDGER_EVENTS}
            (user_id, event_type, asset, network, amount, reference_id, reference_type)
          VALUES
            (@user_id, 'WITHDRAWAL_REFUND', @asset, @network, @amount, @reference_id, 'withdrawal_refund')
        `);
    }

    logger.warn('[WithdrawalService] Withdrawal failed and refunded', { withdrawalId, reason });
  }

  async getWithdrawal(withdrawalId: string): Promise<WithdrawalRecord | null> {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .query(`
        SELECT w.*, u.external_user_id
        FROM ${TABLES.WITHDRAWALS} w
        JOIN ${TABLES.USERS} u ON u.id = w.user_id
        WHERE w.id = @id
      `);

    const row = result.recordset[0] as (Record<string, unknown>) | undefined;
    if (!row) return null;
    return this.mapWithdrawal(row);
  }

  async getPendingWithdrawals(network: Network): Promise<WithdrawalRecord[]> {
    const pool = await getPool();
    const result = await pool.request()
      .input('network', sql.NVarChar, network)
      .query(`
        SELECT w.*, u.external_user_id
        FROM ${TABLES.WITHDRAWALS} w
        JOIN ${TABLES.USERS} u ON u.id = w.user_id
        WHERE w.network = @network
          AND w.status IN ('BROADCASTING', 'UNCONFIRMED', 'CONFIRMING')
      `);

    return result.recordset.map((row: Record<string, unknown>) => this.mapWithdrawal(row));
  }

  private mapWithdrawal(row: Record<string, unknown>): WithdrawalRecord {
    return {
      id: String(row['id']),
      userId: String(row['user_id']),
      asset: String(row['asset']) as Asset,
      network: String(row['network']) as Network,
      destinationAddress: String(row['destination_address']),
      grossAmount: String(row['gross_amount']),
      feeCharged: String(row['fee_charged']),
      netAmountSent: String(row['net_amount_sent']),
      txHash: row['tx_hash'] ? String(row['tx_hash']) : undefined,
      status: String(row['status']) as TxStatus,
      failureReason: row['failure_reason'] ? String(row['failure_reason']) : undefined,
      requestorIp: String(row['requestor_ip']),
      requestorApiKeyId: String(row['requestor_api_key_id']),
      requestedAt: new Date(String(row['requested_at'])),
      completedAt: row['completed_at'] ? new Date(String(row['completed_at'])) : undefined,
    };
  }
}
