// ============================================================
// src/db/mockDb.ts
// In-memory MS SQL Server mock engine for zero-setup local dev & testing.
// Mirrors MSSQL queries, transactional rollbacks, and pre-seeds data.
// ============================================================

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export interface MockRow {
  [key: string]: unknown;
}

export class MockDatabase {
  public users: MockRow[] = [];
  public wallets: MockRow[] = [];
  public deposits: MockRow[] = [];
  public withdrawals: MockRow[] = [];
  public internalTransfers: MockRow[] = [];
  public ledgerEvents: MockRow[] = [];
  public apiKeys: MockRow[] = [];
  public config: Map<string, { value: string; description: string | null }> = new Map();
  public migrations: Set<string> = new Set();

  private derivationCounter = 0;

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults(): void {
    // 1. Seed Config
    this.config.set('sweep_threshold_usd', { value: '50', description: 'Sweep threshold' });
    this.config.set('emergency_pause', { value: 'false', description: 'Emergency pause flag' });
    this.config.set('withdrawal_alert_threshold_usd', { value: '10000', description: 'Large withdrawal alert' });
    this.config.set('gas_alert_threshold_eth', { value: '0.05', description: 'Gas ETH alert' });
    this.config.set('gas_alert_threshold_bnb', { value: '0.1', description: 'Gas BNB alert' });
    this.config.set('gas_alert_threshold_trx', { value: '100', description: 'Gas TRX alert' });
    this.config.set('gas_alert_threshold_sol', { value: '0.5', description: 'Gas SOL alert' });
    this.config.set('gas_alert_threshold_pol', { value: '5', description: 'Gas POL alert' });

    // Withdrawal fees
    this.config.set('withdrawal_fee_USDT_ERC20', { value: '2', description: 'USDT ERC20 fee' });
    this.config.set('withdrawal_fee_USDT_BEP20', { value: '1', description: 'USDT BEP20 fee' });
    this.config.set('withdrawal_fee_USDT_TRC20', { value: '1', description: 'USDT TRC20 fee' });
    this.config.set('withdrawal_fee_ETH', { value: '0.005', description: 'ETH fee' });
    this.config.set('withdrawal_fee_BTC', { value: '0.0001', description: 'BTC fee' });
    this.config.set('withdrawal_fee_SOL', { value: '0.01', description: 'SOL fee' });
    this.config.set('withdrawal_fee_XRP', { value: '0.5', description: 'XRP fee' });
    this.config.set('withdrawal_fee_BNB', { value: '0.002', description: 'BNB fee' });
    this.config.set('last_fee_sweep_at', { value: '1970-01-01T00:00:00Z', description: 'Last fee sweep' });

    // 2. Seed Default Test API Key
    const testApiKey = 'test-api-key-12345';
    const keyHash = createHash('sha256').update(testApiKey).digest('hex');
    this.apiKeys.push({
      id: uuidv4(),
      key_hash: keyHash,
      key_id: 'test-key-id',
      caller_name: 'test-client',
      is_admin: true,
      is_active: true,
      last_used_at: null,
      expires_at: null,
      created_at: new Date(),
    });

    // 3. Seed Initial Omnibus Liquidity in cv_ledger_events so withdrawals succeed in dev
    const systemUserId = '00000000-0000-0000-0000-000000000001';
    const initialAssets = ['ETH', 'BTC', 'SOL', 'BNB', 'POL', 'XRP', 'TRX', 'USDT_ERC20', 'USDT_BEP20', 'USDT_TRC20'];
    for (const asset of initialAssets) {
      this.ledgerEvents.push({
        id: uuidv4(),
        user_id: systemUserId,
        event_type: 'INITIAL_OMNIBUS_CREDIT',
        asset,
        network: asset.startsWith('USDT') ? asset.split('_')[1] : asset,
        amount: '1000000.000000000000000000',
        reference_id: 'system-init',
        reference_type: 'genesis',
        created_at: new Date(),
      });
    }

    logger.info('[MockDB] In-memory database initialized with test API key and default config');
  }

  public execute(queryStr: string, inputs: Record<string, unknown>): { recordset: MockRow[]; rowsAffected: number[] } {
    const q = queryStr.trim();
    const upper = q.toUpperCase();

    // ---- cv_api_keys ----
    if (upper.includes('CV_API_KEYS')) {
      if (upper.startsWith('SELECT')) {
        const hash = inputs['key_hash'];
        let matched = this.apiKeys.filter((k) => k['key_hash'] === hash && k['is_active']);
        if (upper.includes('IS_ADMIN = 1')) {
          matched = matched.filter((k) => Boolean(k['is_admin']));
        }
        return { recordset: matched, rowsAffected: [matched.length] };
      }
      if (upper.startsWith('UPDATE')) {
        const id = inputs['id'];
        const key = this.apiKeys.find((k) => k['id'] === id);
        if (key) key['last_used_at'] = new Date();
        return { recordset: [], rowsAffected: [1] };
      }
    }

    // ---- cv_config ----
    if (upper.includes('CV_CONFIG')) {
      if (upper.startsWith('SELECT')) {
        const keyParam = (inputs['key'] ?? inputs['config_key']) as string | undefined;
        if (keyParam) {
          const entry = this.config.get(keyParam);
          return {
            recordset: entry ? [{ key: keyParam, value: entry.value, config_value: entry.value }] : [],
            rowsAffected: [entry ? 1 : 0],
          };
        }
        // General config query e.g. emergency_pause
        if (q.includes("emergency_pause")) {
          const entry = this.config.get('emergency_pause');
          return { recordset: [{ value: entry?.value ?? 'false' }], rowsAffected: [1] };
        }
        return { recordset: [], rowsAffected: [0] };
      }
      if (upper.startsWith('UPDATE')) {
        const key = inputs['key'] as string;
        const val = inputs['value'] as string;
        const desc = inputs['reason'] as string ?? null;
        if (key) {
          this.config.set(key, { value: val, description: desc });
        } else if (q.includes("last_fee_sweep_at")) {
          this.config.set('last_fee_sweep_at', { value: String(inputs['value']), description: null });
        } else if (q.includes("emergency_pause")) {
          this.config.set('emergency_pause', { value: String(inputs['value']), description: desc });
        }
        return { recordset: [], rowsAffected: [1] };
      }
    }

    // ---- cv_users ----
    if (upper.includes('CV_USERS') && !upper.includes('CV_WALLETS') && !upper.includes('CV_WITHDRAWALS') && !upper.includes('CV_DEPOSITS')) {
      if (upper.startsWith('SELECT')) {
        const extId = (inputs['externalUserId'] ?? inputs['external_user_id']) as string;
        const matched = this.users.filter((u) => u['external_user_id'] === extId);
        return {
          recordset: matched.map((u) => ({
            id: u['id'],
            external_user_id: u['external_user_id'],
            derivationIndex: u['derivation_index'],
            derivation_index: u['derivation_index'],
          })),
          rowsAffected: [matched.length],
        };
      }
      if (upper.startsWith('INSERT')) {
        const id = inputs['id'] as string ?? uuidv4();
        const extId = inputs['externalUserId'] as string;
        const derivationIndex = this.derivationCounter++;
        const newUser: MockRow = {
          id,
          external_user_id: extId,
          derivation_index: derivationIndex,
          created_at: new Date(),
          updated_at: new Date(),
        };
        this.users.push(newUser);
        return {
          recordset: [{ id, derivationIndex, derivation_index: derivationIndex }],
          rowsAffected: [1],
        };
      }
    }

    // ---- cv_wallets ----
    if (upper.includes('CV_WALLETS') && !upper.includes('CV_DEPOSITS')) {
      if (upper.startsWith('SELECT')) {
        const userId = inputs['userId'] as string | undefined;
        const network = inputs['network'] as string | undefined;
        const extId = inputs['externalUserId'] as string | undefined;
        const id = inputs['id'] as string | undefined;

        if (id) {
          const w = this.wallets.find((x) => x['id'] === id);
          return { recordset: w ? [w] : [], rowsAffected: [w ? 1 : 0] };
        }

        let res = this.wallets;
        if (userId) res = res.filter((w) => w['user_id'] === userId);
        if (network) res = res.filter((w) => String(w['network']).toUpperCase() === network.toUpperCase());
        if (extId) {
          const user = this.users.find((u) => u['external_user_id'] === extId);
          res = user ? res.filter((w) => w['user_id'] === user['id']) : [];
        }

        return {
          recordset: res.map((w) => {
            const user = this.users.find((u) => u['id'] === w['user_id']);
            return {
              ...w,
              userId: w['user_id'],
              derivationPath: w['derivation_path'],
              externalUserId: user ? user['external_user_id'] : extId,
            };
          }),
          rowsAffected: [res.length],
        };
      }
      if (upper.startsWith('INSERT')) {
        const newWallet: MockRow = {
          id: inputs['id'] ?? uuidv4(),
          user_id: inputs['userId'],
          network: inputs['network'],
          asset: inputs['asset'] ?? inputs['network'],
          address: inputs['address'],
          derivation_path: inputs['derivationPath'],
          is_active: 1,
          created_at: new Date(),
        };
        this.wallets.push(newWallet);
        return { recordset: [newWallet], rowsAffected: [1] };
      }
    }

    // ---- cv_ledger_events ----
    if (upper.includes('CV_LEDGER_EVENTS')) {
      if (upper.startsWith('SELECT')) {
        const asset = inputs['asset'] as string | undefined;
        let sum = 0;
        for (const ev of this.ledgerEvents) {
          if (!asset || ev['asset'] === asset) {
            sum += parseFloat(String(ev['amount']));
          }
        }
        return {
          recordset: [{ balance: sum.toString(), total: sum.toString() }],
          rowsAffected: [1],
        };
      }
      if (upper.startsWith('INSERT')) {
        const newEvent: MockRow = {
          id: inputs['id'] ?? uuidv4(),
          user_id: inputs['user_id'] ?? inputs['userId'],
          wallet_id: inputs['wallet_id'] ?? inputs['walletId'],
          event_type: inputs['event_type'] ?? inputs['eventType'],
          asset: inputs['asset'],
          network: inputs['network'],
          amount: String(inputs['amount']),
          reference_id: inputs['reference_id'] ?? inputs['referenceId'],
          reference_type: inputs['reference_type'] ?? inputs['referenceType'] ?? 'deposit',
          created_at: new Date(),
        };
        this.ledgerEvents.push(newEvent);
        return { recordset: [newEvent], rowsAffected: [1] };
      }
    }

    // ---- cv_withdrawals ----
    if (upper.includes('CV_WITHDRAWALS')) {
      if (upper.startsWith('SELECT')) {
        const id = inputs['id'] as string | undefined;
        const network = inputs['network'] as string | undefined;

        if (id) {
          const w = this.withdrawals.find((x) => x['id'] === id);
          if (w) {
            const user = this.users.find((u) => u['id'] === w['user_id']);
            return {
              recordset: [{ ...w, external_user_id: user ? user['external_user_id'] : 'test-user' }],
              rowsAffected: [1],
            };
          }
          return { recordset: [], rowsAffected: [0] };
        }

        let res = this.withdrawals;
        if (network) res = res.filter((x) => String(x['network']).toUpperCase() === network.toUpperCase());
        return {
          recordset: res.map((w) => {
            const user = this.users.find((u) => u['id'] === w['user_id']);
            return { ...w, external_user_id: user ? user['external_user_id'] : 'test-user' };
          }),
          rowsAffected: [res.length],
        };
      }
      if (upper.startsWith('INSERT')) {
        const w: MockRow = {
          id: inputs['id'] ?? uuidv4(),
          user_id: inputs['user_id'],
          asset: inputs['asset'],
          network: inputs['network'],
          destination_address: inputs['destination_address'],
          gross_amount: String(inputs['gross_amount']),
          fee_charged: String(inputs['fee_charged'] ?? '0'),
          net_amount_sent: String(inputs['net_amount_sent']),
          requestor_ip: inputs['requestor_ip'],
          requestor_api_key_id: inputs['requestor_api_key_id'],
          status: 'PENDING',
          tx_hash: null,
          requested_at: new Date(),
          completed_at: null,
        };
        this.withdrawals.push(w);
        return { recordset: [w], rowsAffected: [1] };
      }
      if (upper.startsWith('UPDATE')) {
        const id = inputs['id'] as string;
        const w = this.withdrawals.find((x) => x['id'] === id);
        if (w) {
          if (inputs['status']) w['status'] = inputs['status'];
          if (inputs['tx_hash']) w['tx_hash'] = inputs['tx_hash'];
          if (inputs['reason']) w['failure_reason'] = inputs['reason'];
          if (inputs['status'] === 'COMPLETED' || inputs['status'] === 'FAILED') {
            w['completed_at'] = new Date();
          }
        }
        return { recordset: [], rowsAffected: [1] };
      }
    }

    // ---- cv_internal_transfers ----
    if (upper.includes('CV_INTERNAL_TRANSFERS')) {
      if (upper.startsWith('INSERT')) {
        const t: MockRow = {
          id: inputs['id'] ?? uuidv4(),
          transfer_type: inputs['transfer_type'],
          asset: inputs['asset'],
          network: inputs['network'],
          from_address: inputs['from_address'],
          to_address: inputs['to_address'],
          amount: String(inputs['amount']),
          tx_hash: inputs['tx_hash'],
          status: inputs['status'] ?? 'COMPLETED',
          created_at: new Date(),
          completed_at: new Date(),
        };
        this.internalTransfers.push(t);
        return { recordset: [t], rowsAffected: [1] };
      }
      if (upper.startsWith('SELECT')) {
        return { recordset: this.internalTransfers, rowsAffected: [this.internalTransfers.length] };
      }
    }

    // ---- cv_deposits ----
    if (upper.includes('CV_DEPOSITS')) {
      if (upper.startsWith('SELECT')) {
        const txHash = (inputs['txHash'] ?? inputs['tx_hash']) as string | undefined;
        const depositId = (inputs['depositId'] ?? inputs['id']) as string | undefined;
        const extId = inputs['externalUserId'] as string | undefined;
        const walletId = (inputs['walletId'] ?? inputs['wallet_id']) as string | undefined;
        const network = inputs['network'] as string | undefined;

        if (txHash) {
          const matched = this.deposits.filter((d) => d['tx_hash'] === txHash);
          return {
            recordset: matched.map((d) => {
              const wallet = this.wallets.find((w) => w['id'] === d['wallet_id']);
              const user = wallet ? this.users.find((u) => u['id'] === wallet['user_id']) : undefined;
              return {
                ...d,
                id: d['id'],
                walletId: d['wallet_id'],
                txHash: d['tx_hash'],
                network: d['network'],
                asset: d['asset'],
                amount: d['amount'],
                confirmations: d['confirmations'],
                status: d['status'],
                userId: user ? user['id'] : 'mock-user-id',
                externalUserId: user ? user['external_user_id'] : 'mock-user',
                createdAt: d['created_at'],
                confirmedAt: d['confirmed_at'],
                updatedAt: d['updated_at'],
              };
            }),
            rowsAffected: [matched.length],
          };
        }

        if (depositId) {
          const matched = this.deposits.filter((d) => d['id'] === depositId);
          return { recordset: matched, rowsAffected: [matched.length] };
        }

        if (extId) {
          const user = this.users.find((u) => u['external_user_id'] === extId);
          if (!user) return { recordset: [], rowsAffected: [0] };
          const userWallets = this.wallets.filter((w) => w['user_id'] === user['id']);
          const userWalletIds = new Set(userWallets.map((w) => w['id']));
          const matched = this.deposits.filter((d) => userWalletIds.has(d['wallet_id']));
          return {
            recordset: matched.map((d) => ({
              ...d,
              id: d['id'],
              walletId: d['wallet_id'],
              txHash: d['tx_hash'],
              network: d['network'],
              asset: d['asset'],
              amount: d['amount'],
              confirmations: d['confirmations'],
              status: d['status'],
              createdAt: d['created_at'],
              confirmedAt: d['confirmed_at'],
              updatedAt: d['updated_at'],
            })),
            rowsAffected: [matched.length],
          };
        }

        if (walletId) {
          if (upper.includes('SUM')) {
            const completed = this.deposits.filter((d) => d['wallet_id'] === walletId && d['status'] === 'COMPLETED');
            const sum = completed.reduce((acc, d) => acc + parseFloat(String(d['amount'] || 0)), 0);
            return { recordset: [{ total: sum.toString() }], rowsAffected: [1] };
          }
          const matched = this.deposits.filter((d) => d['wallet_id'] === walletId);
          return { recordset: matched, rowsAffected: [matched.length] };
        }

        if (network) {
          let matched = this.deposits.filter((d) => d['network'] === network);
          if (upper.includes('STATUS IN')) {
            matched = matched.filter((d) => ['UNCONFIRMED', 'CONFIRMING', 'PENDING'].includes(String(d['status'])));
          }
          return {
            recordset: matched.map((d) => ({
              ...d,
              id: d['id'],
              walletId: d['wallet_id'],
              txHash: d['tx_hash'],
              network: d['network'],
              asset: d['asset'],
              amount: d['amount'],
              confirmations: d['confirmations'],
              status: d['status'],
              createdAt: d['created_at'],
              confirmedAt: d['confirmed_at'],
              updatedAt: d['updated_at'],
            })),
            rowsAffected: [matched.length],
          };
        }

        return { recordset: this.deposits, rowsAffected: [this.deposits.length] };
      }
      if (upper.startsWith('INSERT')) {
        const d: MockRow = {
          id: inputs['id'] ?? uuidv4(),
          wallet_id: inputs['walletId'] ?? inputs['wallet_id'],
          tx_hash: inputs['txHash'] ?? inputs['tx_hash'],
          asset: inputs['asset'],
          network: inputs['network'],
          amount: String(inputs['amount']),
          confirmations: inputs['confirmations'] ?? 0,
          status: inputs['status'] ?? 'UNCONFIRMED',
          detected_at: new Date(),
          confirmed_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        this.deposits.push(d);
        return { recordset: [d], rowsAffected: [1] };
      }
      if (upper.startsWith('UPDATE')) {
        const txHash = (inputs['txHash'] ?? inputs['tx_hash']) as string | undefined;
        const depositId = (inputs['depositId'] ?? inputs['id']) as string | undefined;
        const d = this.deposits.find((x) => (txHash && x['tx_hash'] === txHash) || (depositId && x['id'] === depositId));
        if (d) {
          if (inputs['confirmations'] !== undefined) d['confirmations'] = inputs['confirmations'];
          let newStatus = inputs['status'] as string | undefined;
          if (!newStatus) {
            if (upper.includes("STATUS = 'FAILED'")) newStatus = 'FAILED';
            else if (upper.includes("STATUS = 'COMPLETED'")) newStatus = 'COMPLETED';
            else if (upper.includes("STATUS = 'CONFIRMING'")) newStatus = 'CONFIRMING';
          }
          if (newStatus) {
            d['status'] = newStatus;
            if (newStatus === 'COMPLETED') {
              d['confirmed_at'] = new Date();
            }
          }
          d['updated_at'] = new Date();
        }
        return { recordset: [], rowsAffected: [1] };
      }
    }

    // Default fallback for unmatched queries
    return { recordset: [], rowsAffected: [0] };
  }
}

export const mockDb = new MockDatabase();
