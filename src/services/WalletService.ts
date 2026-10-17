// ============================================================
// src/services/WalletService.ts
// ============================================================

import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { Network, WalletRecord } from '../types/index.js';
import { TABLES } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { getPool, transaction } from '../db/connection.js';
import {
  deriveUserDepositAddress,
  deriveOmnibusAddress,
  deriveRevenueAddress,
  deriveGasStationAddress,
} from '../kms/Deriver.js';
import { akvClient } from '../kms/AzureKeyVaultClient.js';

export class WalletService {
  private readonly usersTable: string = TABLES.USERS;
  private readonly walletsTable: string = TABLES.WALLETS;
  private readonly configTable: string = TABLES.CONFIG;

  /**
   * Internal helper: Get existing user DB record or atomically create one with a reserved derivation_index.
   */
  private async getOrCreateUser(externalUserId: string): Promise<{ id: string; derivationIndex: number }> {
    const pool = await getPool();

    // Check if user already exists
    const existingResult = await pool
      .request()
      .input('externalUserId', sql.NVarChar(100), externalUserId)
      .query(`
        SELECT id, derivation_index AS derivationIndex
        FROM ${this.usersTable}
        WHERE external_user_id = @externalUserId
      `);

    if (existingResult.recordset.length > 0 && existingResult.recordset[0]) {
      return {
        id: String(existingResult.recordset[0].id),
        derivationIndex: Number(existingResult.recordset[0].derivationIndex),
      };
    }

    // Atomic insert with derivation index reservation
    return await transaction(async (tx) => {
      const lockResult = await tx
        .request()
        .input('externalUserId', sql.NVarChar(100), externalUserId)
        .query(`
          SELECT id, derivation_index AS derivationIndex
          FROM ${this.usersTable} WITH (UPDLOCK, HOLDLOCK)
          WHERE external_user_id = @externalUserId
        `);

      if (lockResult.recordset.length > 0 && lockResult.recordset[0]) {
        return {
          id: String(lockResult.recordset[0].id),
          derivationIndex: Number(lockResult.recordset[0].derivationIndex),
        };
      }

      const id = uuidv4();
      const insertResult = await tx
        .request()
        .input('id', sql.UniqueIdentifier, id)
        .input('externalUserId', sql.NVarChar(100), externalUserId)
        .query(`
          INSERT INTO ${this.usersTable} (id, external_user_id, derivation_index, created_at, updated_at)
          OUTPUT INSERTED.id, INSERTED.derivation_index AS derivationIndex
          SELECT 
            @id,
            @externalUserId,
            ISNULL(MAX(derivation_index), -1) + 1,
            SYSDATETIMEOFFSET(),
            SYSDATETIMEOFFSET()
          FROM ${this.usersTable} WITH (TABLOCKX);
        `);

      const insertedRow = insertResult.recordset[0];
      return {
        id: String(insertedRow?.id ?? id),
        derivationIndex: Number(insertedRow?.derivationIndex ?? 0),
      };
    });
  }

  /**
   * Derives deposit wallet addresses for a user across all specified or supported networks.
   */
  public async createUserWallets(externalUserId: string, networks?: Network[]): Promise<WalletRecord[]> {
    if (!externalUserId || externalUserId.trim().length === 0) {
      throw new Error('[WalletService] externalUserId is required.');
    }

    const { id: userId, derivationIndex } = await this.getOrCreateUser(externalUserId);
    const targetNetworks = networks && networks.length > 0
      ? networks
      : [Network.ETH, Network.BSC, Network.POLYGON, Network.BTC, Network.LTC, Network.DOGE, Network.TRX, Network.SOL, Network.XRP];
    const createdWallets: WalletRecord[] = [];

    const pool = await getPool();
    const masterSeed = await akvClient.getMasterSeed();

    try {
      for (const network of targetNetworks) {
        // Check if wallet record already exists for user and network
        const existingWalletResult = await pool
          .request()
          .input('userId', sql.UniqueIdentifier, userId)
          .input('network', sql.NVarChar(20), network)
          .query(`
            SELECT 
              id,
              user_id AS userId,
              network,
              address,
              derivation_path AS derivationPath,
              created_at AS createdAt
            FROM ${this.walletsTable}
            WHERE user_id = @userId AND network = @network
          `);

        if (existingWalletResult.recordset.length > 0 && existingWalletResult.recordset[0]) {
          const row = existingWalletResult.recordset[0];
          createdWallets.push({
            id: String(row.id),
            userId: String(row.userId),
            externalUserId,
            network: row.network as Network,
            address: String(row.address),
            derivationPath: String(row.derivationPath),
            createdAt: new Date(String(row.createdAt)),
          });
          continue;
        }

        // Derive address and derivation path via KMS Deriver
        const derived = await deriveUserDepositAddress(masterSeed, network, derivationIndex);
        const walletId = uuidv4();

        await pool
          .request()
          .input('id', sql.UniqueIdentifier, walletId)
          .input('userId', sql.UniqueIdentifier, userId)
          .input('network', sql.NVarChar(20), network)
          .input('asset', sql.NVarChar(30), network)
          .input('address', sql.NVarChar(500), derived.address)
          .input('derivationPath', sql.NVarChar(200), derived.derivationPath)
          .query(`
            INSERT INTO ${this.walletsTable} 
              (id, user_id, network, asset, address, derivation_path, is_active, created_at)
            VALUES 
              (@id, @userId, @network, @asset, @address, @derivationPath, 1, SYSDATETIMEOFFSET());
          `);

        createdWallets.push({
          id: walletId,
          userId,
          externalUserId,
          network,
          address: derived.address,
          derivationPath: derived.derivationPath,
          createdAt: new Date(),
        });
      }
    } finally {
      masterSeed.fill(0);
    }

    return createdWallets;
  }

  /**
   * Get all active wallet addresses for an external user.
   */
  public async getUserWallets(externalUserId: string): Promise<WalletRecord[]> {
    const pool = await getPool();

    const result = await pool
      .request()
      .input('externalUserId', sql.NVarChar(100), externalUserId)
      .query(`
        SELECT 
          w.id,
          w.user_id AS userId,
          u.external_user_id AS externalUserId,
          w.network,
          w.asset,
          w.address,
          w.derivation_path AS derivationPath,
          w.created_at AS createdAt
        FROM ${this.walletsTable} w
        INNER JOIN ${this.usersTable} u ON w.user_id = u.id
        WHERE u.external_user_id = @externalUserId AND w.is_active = 1
        ORDER BY w.network ASC;
      `);

    return result.recordset.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      userId: String(row.userId),
      externalUserId: String(row.externalUserId),
      network: row.network as Network,
      address: String(row.address),
      derivationPath: String(row.derivationPath),
      createdAt: new Date(String(row.createdAt)),
    }));
  }

  /**
   * Get specific wallet for an external user and network.
   */
  public async getUserWalletForNetwork(externalUserId: string, network: Network): Promise<WalletRecord | null> {
    const pool = await getPool();

    const result = await pool
      .request()
      .input('externalUserId', sql.NVarChar(100), externalUserId)
      .input('network', sql.NVarChar(20), network)
      .query(`
        SELECT 
          w.id,
          w.user_id AS userId,
          u.external_user_id AS externalUserId,
          w.network,
          w.asset,
          w.address,
          w.derivation_path AS derivationPath,
          w.created_at AS createdAt
        FROM ${this.walletsTable} w
        INNER JOIN ${this.usersTable} u ON w.user_id = u.id
        WHERE u.external_user_id = @externalUserId 
          AND w.network = @network 
          AND w.is_active = 1;
      `);

    if (result.recordset.length === 0 || !result.recordset[0]) {
      return null;
    }

    const row = result.recordset[0];
    return {
      id: String(row.id),
      userId: String(row.userId),
      externalUserId: String(row.externalUserId),
      network: row.network as Network,
      address: String(row.address),
      derivationPath: String(row.derivationPath),
      createdAt: new Date(String(row.createdAt)),
    };
  }

  /**
   * Get omnibus vault address for a network.
   */
  public async getOmnibusAddress(network: Network): Promise<string> {
    const key = `${network.toLowerCase()}_omnibus_address`;
    const pool = await getPool();

    try {
      const result = await pool
        .request()
        .input('key', sql.NVarChar(100), key)
        .query(`SELECT [value] FROM ${this.configTable} WHERE [key] = @key`);

      if (result.recordset.length > 0 && result.recordset[0]?.value) {
        return String(result.recordset[0].value);
      }
    } catch (err) {
      logger.warn(`[WalletService] Could not read ${key} from db config:`, err);
    }

    try {
      const masterSeed = await akvClient.getMasterSeed();
      const derived = await deriveOmnibusAddress(masterSeed, network);
      masterSeed.fill(0);
      return derived.address;
    } catch {
      return '0x0000000000000000000000000000000000000000';
    }
  }

  /**
   * Get revenue vault address for a network.
   */
  public async getRevenueAddress(network: Network): Promise<string> {
    const key = `${network.toLowerCase()}_revenue_address`;
    const pool = await getPool();

    try {
      const result = await pool
        .request()
        .input('key', sql.NVarChar(100), key)
        .query(`SELECT [value] FROM ${this.configTable} WHERE [key] = @key`);

      if (result.recordset.length > 0 && result.recordset[0]?.value) {
        return String(result.recordset[0].value);
      }
    } catch (err) {
      logger.warn(`[WalletService] Could not read ${key} from db config:`, err);
    }

    try {
      const masterSeed = await akvClient.getMasterSeed();
      const derived = await deriveRevenueAddress(masterSeed, network);
      masterSeed.fill(0);
      return derived.address;
    } catch {
      return '0x0000000000000000000000000000000000000000';
    }
  }

  /**
   * Get gas station address for a network.
   */
  public async getGasStationAddress(network: Network): Promise<string> {
    const key = `${network.toLowerCase()}_gas_station_address`;
    const pool = await getPool();

    try {
      const result = await pool
        .request()
        .input('key', sql.NVarChar(100), key)
        .query(`SELECT [value] FROM ${this.configTable} WHERE [key] = @key`);

      if (result.recordset.length > 0 && result.recordset[0]?.value) {
        return String(result.recordset[0].value);
      }
    } catch (err) {
      logger.warn(`[WalletService] Could not read ${key} from db config:`, err);
    }

    try {
      const masterSeed = await akvClient.getMasterSeed();
      const derived = await deriveGasStationAddress(masterSeed, network);
      masterSeed.fill(0);
      return derived.address;
    } catch {
      return '0x0000000000000000000000000000000000000000';
    }
  }
}

export const walletService = new WalletService();
