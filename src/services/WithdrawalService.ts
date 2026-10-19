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
  EventType,
} from '../types/index.js';
import { InsufficientBalanceError, AppError } from '../api/middleware/errorHandler.js';
import { eventEmitter } from '../events/EventEmitter.js';

export interface BalanceLedgerEntry {
  asset: string;
  network: string;
  availableBalance: string;
}

export class WithdrawalService {

  /**
   * Creates and processes a withdrawal.
   *
   * SAFETY SEQUENCE:
   * 1. Check emergency_pause flag
   * 2. Get withdrawal fee from config
   * 3. In ONE SQL transaction: check balance, INSERT record, debit omnibus ledger
   * 4. Sign and broadcast (outside the transaction)
   * 5. Update status to BROADCASTING
   * 6. On broadcast failure: markFailed() which refunds the debit
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

    const omnibusDerivationPath = omnibusWallet.recordset[0]?.derivation_path
      ?? `m/44'/60'/1'/0/0`;
    const omnibusAddress = omnibusWallet.recordset[0]?.address ?? '';

    // 5. Critical: check balance + debit in ONE SQL transaction
    let withdrawalId!: string;

    await transaction(async (tx) => {
      // Check user ledger balance (sum all events for this user/asset/network)
      const balanceResult = await tx.request()
        .input('userId', sql.UniqueIdentifier, user.id)
        .input('asset', sql.NVarChar, request.asset)
        .input('network', sql.NVarChar, request.network)
        .query(`
          SELECT ISNULL(SUM(CAST(amount AS DECIMAL(28,18))), 0) as balance
          FROM ${TABLES.LEDGER_EVENTS}
          WHERE user_id = @userId AND asset = @asset AND network = @network
        `);

      const currentBalance = String(balanceResult.recordset[0]?.balance ?? '0');

      if (!isGreaterThanOrEqual(currentBalance, request.grossAmount)) {
        throw new InsufficientBalanceError();
      }

      // Insert withdrawal record (status = PENDING)
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

      // Debit the omnibus ledger (negative amount = debit) — APPEND ONLY
      await tx.request()
        .input('user_id', sql.UniqueIdentifier, user.id)
        .input('event_type', sql.NVarChar, 'WITHDRAWAL_DEBIT')
        .input('asset', sql.NVarChar, request.asset)
        .input('network', sql.NVarChar, request.network)
        .input('amount', sql.Decimal(28, 18), -parseFloat(request.grossAmount))
        .input('reference_id', sql.NVarChar, withdrawalId)
        .input('reference_type', sql.NVarChar, 'withdrawal')
        .query(`
          INSERT INTO ${TABLES.LEDGER_EVENTS}
            (user_id, event_type, asset, network, amount, reference_id, reference_type)
          VALUES
            (@user_id, @event_type, @asset, @network, @amount, @reference_id, @reference_type)
        `);
    });

    logger.info('[WithdrawalService] Withdrawal record created and balance debited', {
      withdrawalId,
      asset: request.asset,
      grossAmount: request.grossAmount,
      feeCharged,
      netAmountSent,
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
        .input('id', sql.UniqueIdentifier, withdrawalId)
        .input('tx_hash', sql.NVarChar, txHash)
        .query(`
          UPDATE ${TABLES.WITHDRAWALS}
          SET status = 'BROADCASTING', tx_hash = @tx_hash
          WHERE id = @id
        `);

      logger.info('[WithdrawalService] Withdrawal broadcast', { withdrawalId, txHash });

    } catch (err) {
      // Broadcast failed — mark as FAILED and refund the debit
      await this.markFailed(withdrawalId, `Broadcast failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    return this.getWithdrawal(withdrawalId) as Promise<WithdrawalRecord>;
  }

  /**
   * Update withdrawal status (called by confirmation tracker).
   */
  async updateWithdrawalStatus(
    withdrawalId: string,
    status: TxStatus,
    _confirmations: number,
  ): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .input('status', sql.NVarChar, status)
      .query(`
        UPDATE ${TABLES.WITHDRAWALS}
        SET status = @status
        WHERE id = @id
      `);
  }

  /**
   * Mark a withdrawal as COMPLETED.
   * Also appends a WITHDRAWAL_COMPLETED entry to the audit ledger and emits event.
   */
  async markCompleted(withdrawalId: string, txHash: string): Promise<void> {
    const pool = await getPool();

    // Fetch the withdrawal details for ledger entry and event
    const wResult = await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .query(`
        SELECT w.user_id, w.asset, w.network, w.net_amount_sent, u.external_user_id
        FROM ${TABLES.WITHDRAWALS} w
        JOIN ${TABLES.USERS} u ON u.id = w.user_id
        WHERE w.id = @id
      `);

    const w = wResult.recordset[0] as {
      user_id: string;
      asset: string;
      network: string;
      net_amount_sent: string;
      external_user_id: string;
    } | undefined;

    // Update withdrawal to COMPLETED
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

    if (w) {
      // Append WITHDRAWAL_COMPLETED to audit ledger (credit the net amount sent as record)
      try {
        await pool.request()
          .input('user_id', sql.UniqueIdentifier, w.user_id)
          .input('event_type', sql.NVarChar, 'WITHDRAWAL_COMPLETED')
          .input('asset', sql.NVarChar, w.asset)
          .input('network', sql.NVarChar, w.network)
          .input('amount', sql.Decimal(28, 18), -parseFloat(String(w.net_amount_sent)))
          .input('reference_id', sql.NVarChar, withdrawalId)
          .input('reference_type', sql.NVarChar, 'withdrawal_completed')
          .query(`
            INSERT INTO ${TABLES.LEDGER_EVENTS}
              (user_id, event_type, asset, network, amount, reference_id, reference_type)
            VALUES
              (@user_id, @event_type, @asset, @network, @amount, @reference_id, @reference_type)
          `);
      } catch (ledgerErr) {
        logger.error('[WithdrawalService] Failed to append WITHDRAWAL_COMPLETED ledger entry:', ledgerErr);
      }

      // Emit event
      try {
        await eventEmitter.emit(EventType.WITHDRAWAL_COMPLETED, {
          withdrawalId,
          txHash,
          asset: w.asset,
          network: w.network,
          netAmountSent: String(w.net_amount_sent),
          externalUserId: w.external_user_id,
        });
      } catch (emitErr) {
        logger.error('[WithdrawalService] Failed to emit WITHDRAWAL_COMPLETED event:', emitErr);
      }
    }
  }

  /**
   * Mark a withdrawal as FAILED.
   * Refunds the debited balance (credit back) and emits event.
   */
  async markFailed(withdrawalId: string, reason: string): Promise<void> {
    const pool = await getPool();

    // Get withdrawal to refund the debit
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, withdrawalId)
      .query(`
        SELECT w.user_id, w.gross_amount, w.asset, w.network, u.external_user_id
        FROM ${TABLES.WITHDRAWALS} w
        JOIN ${TABLES.USERS} u ON u.id = w.user_id
        WHERE w.id = @id
      `);

    const w = result.recordset[0] as {
      user_id: string;
      gross_amount: string;
      asset: string;
      network: string;
      external_user_id: string;
    } | undefined;

    // Mark as FAILED
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

    // Refund the debited balance (positive credit entry) — APPEND ONLY
    if (w) {
      try {
        await pool.request()
          .input('user_id', sql.UniqueIdentifier, w.user_id)
          .input('event_type', sql.NVarChar, 'WITHDRAWAL_REFUND')
          .input('asset', sql.NVarChar, w.asset)
          .input('network', sql.NVarChar, w.network)
          .input('amount', sql.Decimal(28, 18), parseFloat(String(w.gross_amount)))
          .input('reference_id', sql.NVarChar, withdrawalId)
          .input('reference_type', sql.NVarChar, 'withdrawal_refund')
          .query(`
            INSERT INTO ${TABLES.LEDGER_EVENTS}
              (user_id, event_type, asset, network, amount, reference_id, reference_type)
            VALUES
              (@user_id, @event_type, @asset, @network, @amount, @reference_id, @reference_type)
          `);
      } catch (ledgerErr) {
        logger.error('[WithdrawalService] Failed to append WITHDRAWAL_REFUND ledger entry:', ledgerErr);
      }

      // Emit WITHDRAWAL_FAILED event
      try {
        await eventEmitter.emit(EventType.WITHDRAWAL_FAILED, {
          withdrawalId,
          reason,
          asset: w.asset,
          network: w.network,
          externalUserId: w.external_user_id,
        });
      } catch (emitErr) {
        logger.error('[WithdrawalService] Failed to emit WITHDRAWAL_FAILED event:', emitErr);
      }
    }

    logger.warn('[WithdrawalService] Withdrawal failed and refunded', { withdrawalId, reason });
  }

  /**
   * Get aggregated available balance per asset+network for a user.
   * Sums all cv_ledger_events for the user, grouped by asset and network.
   */
  async getUserBalance(
    externalUserId: string,
    asset?: string,
    network?: string,
  ): Promise<BalanceLedgerEntry[]> {
    const pool = await getPool();

    // Look up user ID
    const userResult = await pool.request()
      .input('external_user_id', sql.NVarChar, externalUserId)
      .query(`SELECT id FROM ${TABLES.USERS} WHERE external_user_id = @external_user_id`);

    const user = userResult.recordset[0] as { id: string } | undefined;
    if (!user) return [];

    const balanceResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, user.id)
      .input('asset', sql.NVarChar, asset ?? null)
      .input('network', sql.NVarChar, network ?? null)
      .query(`
        SELECT asset, network,
               ISNULL(SUM(CAST(amount AS DECIMAL(28,18))), 0) AS balance
        FROM ${TABLES.LEDGER_EVENTS}
        WHERE user_id = @userId
          AND (@asset IS NULL OR asset = @asset)
          AND (@network IS NULL OR network = @network)
        GROUP BY asset, network
        ORDER BY asset, network
      `);

    return balanceResult.recordset.map((row: Record<string, unknown>) => ({
      asset: String(row['asset']),
      network: String(row['network']),
      availableBalance: String(row['balance'] ?? '0'),
    }));
  }

  /**
   * Get paginated list of withdrawals for a user.
   */
  async getWithdrawalsByUser(
    externalUserId: string,
    page = 1,
    limit = 20,
  ): Promise<WithdrawalRecord[]> {
    const pool = await getPool();
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));
    const offset = (safePage - 1) * safeLimit;

    const userResult = await pool.request()
      .input('external_user_id', sql.NVarChar, externalUserId)
      .query(`SELECT id FROM ${TABLES.USERS} WHERE external_user_id = @external_user_id`);

    const user = userResult.recordset[0] as { id: string } | undefined;
    if (!user) return [];

    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, user.id)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, safeLimit)
      .query(`
        SELECT w.*, u.external_user_id
        FROM ${TABLES.WITHDRAWALS} w
        JOIN ${TABLES.USERS} u ON u.id = w.user_id
        WHERE w.user_id = @userId
        ORDER BY w.requested_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    return result.recordset.map((row: Record<string, unknown>) => this.mapWithdrawal(row));
  }

  /**
   * Get paginated audit ledger entries for a user.
   * Returns raw ledger rows for transparency and reconciliation.
   */
  async getBalanceLedger(
    externalUserId: string,
    page = 1,
    limit = 50,
  ): Promise<Record<string, unknown>[]> {
    const pool = await getPool();
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));
    const offset = (safePage - 1) * safeLimit;

    const userResult = await pool.request()
      .input('external_user_id', sql.NVarChar, externalUserId)
      .query(`SELECT id FROM ${TABLES.USERS} WHERE external_user_id = @external_user_id`);

    const user = userResult.recordset[0] as { id: string } | undefined;
    if (!user) return [];

    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, user.id)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, safeLimit)
      .query(`
        SELECT id, event_type, asset, network, amount, reference_id, reference_type, created_at
        FROM ${TABLES.LEDGER_EVENTS}
        WHERE user_id = @userId
        ORDER BY created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    return result.recordset;
  }

  /**
   * Get a single withdrawal by ID.
   */
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

  /**
   * Get pending withdrawals for a network (for confirmation tracker).
   */
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
      externalUserId: row['external_user_id'] ? String(row['external_user_id']) : undefined,
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

export const withdrawalService = new WithdrawalService();
