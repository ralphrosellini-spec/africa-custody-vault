import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { Network, Asset, TxStatus, EventType, DepositRecord } from '../types';
import { TABLES, REQUIRED_CONFIRMATIONS } from '../utils/constants';
import { logger } from '../utils/logger';
import { getPool, transaction } from '../db/connection';
import { eventEmitter } from '../events/EventEmitter';
import { DepositConfirmedPayload } from '../events/EventTypes';

export class DepositService {
  private readonly depositsTable: string = TABLES?.DEPOSITS || 'cv_deposits';
  private readonly walletsTable: string = TABLES?.WALLETS || 'cv_wallets';
  private readonly usersTable: string = TABLES?.USERS || 'cv_users';
  private readonly ledgerEventsTable: string = TABLES?.LEDGER_EVENTS || 'cv_ledger_events';

  /**
   * Helper to retrieve required confirmation count for a given network.
   */
  private getRequiredConfirmations(network: Network): number {
    if (REQUIRED_CONFIRMATIONS && typeof REQUIRED_CONFIRMATIONS[network] === 'number') {
      return REQUIRED_CONFIRMATIONS[network];
    }
    switch (network) {
      case Network.BITCOIN:
        return 3;
      case Network.ETHEREUM:
        return 12;
      case Network.TRON:
        return 19;
      case Network.SOLANA:
        return 32;
      case Network.XRP:
        return 1;
      default:
        return 12;
    }
  }

  /**
   * Record a newly detected deposit from a chain listener.
   * If already recorded, updates confirmations if higher.
   */
  public async recordDetectedDeposit(params: {
    walletId: string;
    txHash: string;
    asset: Asset;
    network: Network;
    amount: string;
  }): Promise<void> {
    const { walletId, txHash, asset, network, amount } = params;
    const pool = await getPool();

    // Check for existing record
    const existing = await pool
      .request()
      .input('txHash', sql.VarChar(255), txHash)
      .input('network', sql.VarChar(50), network)
      .query(`
        SELECT id, status, confirmations
        FROM ${this.depositsTable}
        WHERE tx_hash = @txHash AND network = @network
      `);

    if (existing.recordset.length > 0) {
      logger.info(`[DepositService] Deposit already exists for txHash: ${txHash}. Skipping duplicate insertion.`);
      return;
    }

    const depositId = uuidv4();
    const initialStatus = TxStatus.UNCONFIRMED || 'UNCONFIRMED';

    await pool
      .request()
      .input('id', sql.UniqueIdentifier, depositId)
      .input('walletId', sql.UniqueIdentifier, walletId)
      .input('txHash', sql.VarChar(255), txHash)
      .input('network', sql.VarChar(50), network)
      .input('asset', sql.VarChar(50), asset)
      .input('amount', sql.VarChar(100), amount)
      .input('confirmations', sql.Int, 0)
      .input('status', sql.VarChar(50), initialStatus)
      .query(`
        INSERT INTO ${this.depositsTable} (
          id, wallet_id, tx_hash, network, asset, amount, confirmations, status, created_at, updated_at
        ) VALUES (
          @id, @walletId, @txHash, @network, @asset, @amount, @confirmations, @status, SYSUTCDATETIME(), SYSUTCDATETIME()
        )
      `);

    logger.info(`[DepositService] Recorded detected deposit ${depositId} (txHash: ${txHash}, amount: ${amount} ${asset})`);
  }

  /**
   * Update confirmation count; mark COMPLETED when threshold reached.
   * In a single atomic SQL transaction:
   * 1. Updates cv_deposits to COMPLETED
   * 2. Appends event to cv_ledger_events
   * Then emits DEPOSIT_CONFIRMED event via eventEmitter.
   */
  public async updateConfirmations(
    txHash: string,
    confirmations: number,
    network: Network,
    isFailed = false,
  ): Promise<void> {
    const pool = await getPool();

    if (isFailed) {
      await pool
        .request()
        .input('txHash', sql.VarChar(255), txHash)
        .input('network', sql.VarChar(50), network)
        .query(`
          UPDATE ${this.depositsTable}
          SET status = 'FAILED'
          WHERE tx_hash = @txHash AND network = @network
        `);
      logger.warn(`[DepositService] Deposit marked FAILED for tx: ${txHash}`);
      return;
    }

    const requiredConfs = this.getRequiredConfirmations(network);

    // Check current state
    const currentResult = await pool
      .request()
      .input('txHash', sql.VarChar(255), txHash)
      .input('network', sql.VarChar(50), network)
      .query(`
        SELECT d.id, d.wallet_id AS walletId, d.network, d.asset, d.amount, d.confirmations, d.status,
               w.user_id AS userId, u.external_user_id AS externalUserId
        FROM ${this.depositsTable} d
        INNER JOIN ${this.walletsTable} w ON d.wallet_id = w.id
        INNER JOIN ${this.usersTable} u ON w.user_id = u.id
        WHERE d.tx_hash = @txHash AND d.network = @network
      `);

    if (currentResult.recordset.length === 0) {
      logger.warn(`[DepositService] updateConfirmations called for unknown txHash: ${txHash}`);
      return;
    }

    const row = currentResult.recordset[0];
    const depositId = String(row.id);
    const currentStatus = String(row.status);
    const userId = String(row.userId);
    const externalUserId = String(row.externalUserId);
    const asset = row.asset as Asset;
    const amount = String(row.amount);
    const walletId = String(row.walletId);

    if (currentStatus === TxStatus.COMPLETED || currentStatus === 'COMPLETED') {
      // Already fully confirmed and processed
      return;
    }

    const isThresholdMet = confirmations >= requiredConfs;

    if (!isThresholdMet) {
      // Update confirmation count and status to CONFIRMING
      const nextStatus = TxStatus.CONFIRMING || 'CONFIRMING';
      await pool
        .request()
        .input('depositId', sql.UniqueIdentifier, depositId)
        .input('confirmations', sql.Int, confirmations)
        .input('status', sql.VarChar(50), nextStatus)
        .query(`
          UPDATE ${this.depositsTable}
          SET confirmations = @confirmations, status = @status, updated_at = SYSUTCDATETIME()
          WHERE id = @depositId
        `);

      logger.info(
        `[DepositService] Updated confirmations for tx ${txHash}: ${confirmations}/${requiredConfs} (Status: ${nextStatus})`
      );
      return;
    }

    // Threshold met! Finalize in a single SQL transaction
    let shouldEmit = false;

    await transaction(async (tx) => {
      // Lock row to prevent race conditions
      const lockCheck = await tx
        .request()
        .input('depositId', sql.UniqueIdentifier, depositId)
        .query(`
          SELECT status
          FROM ${this.depositsTable} WITH (UPDLOCK, HOLDLOCK)
          WHERE id = @depositId
        `);

      if (lockCheck.recordset.length === 0 || lockCheck.recordset[0].status === 'COMPLETED') {
        return;
      }

      // 1. Update deposit status to COMPLETED
      await tx
        .request()
        .input('depositId', sql.UniqueIdentifier, depositId)
        .input('confirmations', sql.Int, confirmations)
        .input('status', sql.VarChar(50), TxStatus.COMPLETED || 'COMPLETED')
        .query(`
          UPDATE ${this.depositsTable}
          SET confirmations = @confirmations,
              status = @status,
              confirmed_at = SYSUTCDATETIME(),
              updated_at = SYSUTCDATETIME()
          WHERE id = @depositId
        `);

      // 2. Insert into append-only cv_ledger_events
      const ledgerEventId = uuidv4();
      await tx
        .request()
        .input('id', sql.UniqueIdentifier, ledgerEventId)
        .input('userId', sql.UniqueIdentifier, userId)
        .input('walletId', sql.UniqueIdentifier, walletId)
        .input('eventType', sql.VarChar(50), 'DEPOSIT_CONFIRMED')
        .input('network', sql.VarChar(50), network)
        .input('asset', sql.VarChar(50), asset)
        .input('amount', sql.VarChar(100), amount)
        .input('referenceId', sql.UniqueIdentifier, depositId)
        .query(`
          INSERT INTO ${this.ledgerEventsTable} (
            id, user_id, wallet_id, event_type, network, asset, amount, reference_id, created_at
          ) VALUES (
            @id, @userId, @walletId, @eventType, @network, @asset, @amount, @referenceId, SYSUTCDATETIME()
          )
        `);

      shouldEmit = true;
    });

    if (shouldEmit) {
      logger.info(
        `[DepositService] Deposit ${depositId} (txHash: ${txHash}) marked COMPLETED. Emitting DEPOSIT_CONFIRMED event.`
      );

      const eventPayload: DepositConfirmedPayload = {
        depositId,
        userId: externalUserId,
        walletId,
        txHash,
        network,
        asset,
        amount,
        confirmations,
        confirmedAt: new Date().toISOString(),
      };

      try {
        await eventEmitter.emit(EventType.DEPOSIT_CONFIRMED, eventPayload);
      } catch (emitterErr) {
        logger.error(`[DepositService] Failed to emit DEPOSIT_CONFIRMED event for deposit ${depositId}:`, emitterErr);
      }
    }
  }

  /**
   * Get all deposits for a user (paginated).
   */
  public async getUserDeposits(externalUserId: string, page: number = 1, limit: number = 20): Promise<DepositRecord[]> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));
    const offset = (safePage - 1) * safeLimit;

    const pool = await getPool();
    const result = await pool
      .request()
      .input('externalUserId', sql.VarChar(255), externalUserId)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, safeLimit)
      .query(`
        SELECT 
          d.id,
          d.wallet_id AS walletId,
          d.tx_hash AS txHash,
          d.network,
          d.asset,
          d.amount,
          d.confirmations,
          d.status,
          d.created_at AS createdAt,
          d.confirmed_at AS confirmedAt,
          d.updated_at AS updatedAt
        FROM ${this.depositsTable} d
        INNER JOIN ${this.walletsTable} w ON d.wallet_id = w.id
        INNER JOIN ${this.usersTable} u ON w.user_id = u.id
        WHERE u.external_user_id = @externalUserId
        ORDER BY d.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    return result.recordset.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      walletId: String(row.walletId),
      txHash: String(row.txHash),
      network: row.network as Network,
      asset: row.asset as Asset,
      amount: String(row.amount),
      confirmations: Number(row.confirmations),
      status: row.status as TxStatus,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Get deposit record by transaction hash.
   */
  public async getTransactionByHash(txHash: string): Promise<DepositRecord | null> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('txHash', sql.VarChar(255), txHash)
      .query(`
        SELECT 
          id,
          wallet_id AS walletId,
          tx_hash AS txHash,
          network,
          asset,
          amount,
          confirmations,
          status,
          created_at AS createdAt,
          confirmed_at AS confirmedAt,
          updated_at AS updatedAt
        FROM ${this.depositsTable}
        WHERE tx_hash = @txHash
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const row = result.recordset[0];
    return {
      id: String(row.id),
      walletId: String(row.walletId),
      txHash: String(row.txHash),
      network: row.network as Network,
      asset: row.asset as Asset,
      amount: String(row.amount),
      confirmations: Number(row.confirmations),
      status: row.status as TxStatus,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Get deposits that need confirmation tracking (status = UNCONFIRMED or CONFIRMING).
   */
  public async getPendingDeposits(network: Network): Promise<DepositRecord[]> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('network', sql.VarChar(50), network)
      .query(`
        SELECT 
          id,
          wallet_id AS walletId,
          tx_hash AS txHash,
          network,
          asset,
          amount,
          confirmations,
          status,
          created_at AS createdAt,
          confirmed_at AS confirmedAt,
          updated_at AS updatedAt
        FROM ${this.depositsTable}
        WHERE network = @network AND status IN ('UNCONFIRMED', 'CONFIRMING', 'PENDING')
        ORDER BY created_at ASC
      `);

    return result.recordset.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      walletId: String(row.walletId),
      txHash: String(row.txHash),
      network: row.network as Network,
      asset: row.asset as Asset,
      amount: String(row.amount),
      confirmations: Number(row.confirmations),
      status: row.status as TxStatus,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    }));
  }
}

export const depositService = new DepositService();
