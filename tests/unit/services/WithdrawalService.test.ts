// ============================================================
// tests/unit/services/WithdrawalService.test.ts
// Unit tests for WithdrawalService (Phase 3 withdrawal pipeline & ledger)
// ============================================================

process.env['DB_SERVER'] = 'mock';
process.env['NODE_ENV'] = 'test';

// Hoist Jest mocks to prevent ESM / @solana loading issues
jest.mock('../../../src/chains/index', () => ({
  getAdapter: jest.fn(() => ({
    getBalance: jest.fn(async () => 0n),
    estimateFee: jest.fn(async () => 21000n),
    buildTransaction: jest.fn(async () => ({ raw: {}, estimatedFee: 21000n })),
    signTransaction: jest.fn(async () => ({ raw: '0xsigned', txHash: '0xmockhash' })),
    broadcastTransaction: jest.fn(async () => '0xmockhash'),
  })),
  adapters: new Map(),
  initializeAdapters: jest.fn(() => new Map()),
}));

jest.mock('../../../src/kms/Signer', () => ({
  signAndBroadcast: jest.fn(async () => `0xwithdrawal_mock_${Date.now()}`),
}));

jest.mock('../../../src/kms/AzureKeyVaultClient', () => ({
  akvClient: {
    getMasterSeed: jest.fn(async () => Buffer.alloc(64, 'a')),
    getSecret: jest.fn(async () => 'mock-secret'),
  },
}));

import { WithdrawalService } from '../../../src/services/WithdrawalService';
import { signAndBroadcast } from '../../../src/kms/Signer';
import { mockDb } from '../../../src/db/mockDb';
import { Network, Asset } from '../../../src/types';
import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

describe('WithdrawalService', () => {
  const withdrawalService = new WithdrawalService();

  const testUserId = uuidv4();
  const testExternalUserId = `wd-user-${Date.now()}`;
  const testWalletId = uuidv4();

  beforeAll(() => {
    // Seed user
    mockDb.users.push({
      id: testUserId,
      external_user_id: testExternalUserId,
      derivation_index: 300,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Seed wallet
    mockDb.wallets.push({
      id: testWalletId,
      user_id: testUserId,
      network: 'ETH',
      asset: 'ETH',
      address: '0xTestUserDepositAddress',
      derivation_path: "m/44'/60'/0'/0/300",
      is_active: 1,
      created_at: new Date(),
    });

    // Seed initial ledger credit of 1000 ETH
    mockDb.ledgerEvents.push({
      id: uuidv4(),
      user_id: testUserId,
      wallet_id: testWalletId,
      event_type: 'DEPOSIT_CONFIRMED',
      asset: 'ETH',
      network: 'ETH',
      amount: '1000',
      reference_id: uuidv4(),
      reference_type: 'deposit',
      created_at: new Date(),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (signAndBroadcast as jest.Mock).mockResolvedValue(`0xwd_tx_${Date.now()}`);

    // Ensure emergency_pause is false
    mockDb.config.set('emergency_pause', { value: 'false', description: 'Emergency pause flag' });
  });

  describe('createWithdrawal()', () => {
    it('creates a withdrawal record, debits ledger, and transitions to BROADCASTING', async () => {
      const result = await withdrawalService.createWithdrawal({
        externalUserId: testExternalUserId,
        asset: Asset.ETH,
        network: Network.ETH,
        destinationAddress: '0xRecipientAddress00000000000000000000001',
        grossAmount: '10.0',
        requestorIp: '127.0.0.1',
        requestorApiKeyId: 'test-api-key',
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.status).toBe('BROADCASTING');
      expect(result.txHash).toBeDefined();
      expect(new Decimal(result.grossAmount).equals('10')).toBe(true);

      // Check that a debit was appended to cv_ledger_events
      const debitEvent = mockDb.ledgerEvents.find(
        (ev) => ev['reference_id'] === result.id && ev['event_type'] === 'WITHDRAWAL_DEBIT'
      );
      expect(debitEvent).toBeDefined();
      expect(new Decimal(String(debitEvent?.['amount'])).equals('-10')).toBe(true);
    });

    it('applies configured fee and sets netAmountSent correctly', async () => {
      const result = await withdrawalService.createWithdrawal({
        externalUserId: testExternalUserId,
        asset: Asset.ETH,
        network: Network.ETH,
        destinationAddress: '0xRecipientAddress00000000000000000000002',
        grossAmount: '25.0',
        requestorIp: '127.0.0.1',
        requestorApiKeyId: 'test-api-key',
      });

      const fee = mockDb.config.get('withdrawal_fee_ETH')?.value ?? '0';
      const expectedNet = new Decimal('25.0').minus(new Decimal(fee)).toFixed();

      expect(result.netAmountSent).toBe(expectedNet);
      expect(result.feeCharged).toBe(fee);
    });

    it('rejects with 503 when emergency_pause is active', async () => {
      mockDb.config.set('emergency_pause', { value: 'true', description: 'Emergency pause flag' });

      await expect(
        withdrawalService.createWithdrawal({
          externalUserId: testExternalUserId,
          asset: Asset.ETH,
          network: Network.ETH,
          destinationAddress: '0xRecipientAddress00000000000000000000003',
          grossAmount: '5.0',
          requestorIp: '127.0.0.1',
          requestorApiKeyId: 'test-api-key',
        })
      ).rejects.toMatchObject({ statusCode: 503 });
    });

    it('rejects with 422 InsufficientBalanceError when balance < grossAmount', async () => {
      const poorExternalUserId = `poor-user-${Date.now()}`;
      mockDb.users.push({
        id: uuidv4(),
        external_user_id: poorExternalUserId,
        derivation_index: 301,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(
        withdrawalService.createWithdrawal({
          externalUserId: poorExternalUserId,
          asset: Asset.ETH,
          network: Network.ETH,
          destinationAddress: '0xRecipientAddress00000000000000000000004',
          grossAmount: '500.0',
          requestorIp: '127.0.0.1',
          requestorApiKeyId: 'test-api-key',
        })
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('refunds ledger and marks status FAILED when signAndBroadcast throws', async () => {
      (signAndBroadcast as jest.Mock).mockRejectedValueOnce(new Error('KMS offline'));

      const spy = jest.spyOn(withdrawalService, 'markFailed');

      await expect(
        withdrawalService.createWithdrawal({
          externalUserId: testExternalUserId,
          asset: Asset.ETH,
          network: Network.ETH,
          destinationAddress: '0xRecipientAddress00000000000000000000005',
          grossAmount: '5.0',
          requestorIp: '127.0.0.1',
          requestorApiKeyId: 'test-api-key',
        })
      ).rejects.toThrow('KMS offline');

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('markCompleted()', () => {
    it('sets status to COMPLETED and emits WITHDRAWAL_COMPLETED event', async () => {
      const result = await withdrawalService.createWithdrawal({
        externalUserId: testExternalUserId,
        asset: Asset.ETH,
        network: Network.ETH,
        destinationAddress: '0xRecipientAddress00000000000000000000006',
        grossAmount: '12.0',
        requestorIp: '127.0.0.1',
        requestorApiKeyId: 'test-api-key',
      });

      await withdrawalService.markCompleted(result.id, '0xconfirmed_tx_hash');

      const updated = await withdrawalService.getWithdrawal(result.id);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.completedAt).toBeDefined();

      // Check for WITHDRAWAL_COMPLETED ledger entry
      const completedEvent = mockDb.ledgerEvents.find(
        (ev) => ev['reference_id'] === result.id && ev['event_type'] === 'WITHDRAWAL_COMPLETED'
      );
      expect(completedEvent).toBeDefined();
    });
  });

  describe('markFailed()', () => {
    it('sets status to FAILED and inserts WITHDRAWAL_REFUND ledger credit', async () => {
      const result = await withdrawalService.createWithdrawal({
        externalUserId: testExternalUserId,
        asset: Asset.ETH,
        network: Network.ETH,
        destinationAddress: '0xRecipientAddress00000000000000000000007',
        grossAmount: '8.0',
        requestorIp: '127.0.0.1',
        requestorApiKeyId: 'test-api-key',
      });

      await withdrawalService.markFailed(result.id, 'Gas price spiked unexpectedly');

      const updated = await withdrawalService.getWithdrawal(result.id);
      expect(updated?.status).toBe('FAILED');
      expect(updated?.failureReason).toBe('Gas price spiked unexpectedly');

      // Check for refund credit
      const refundEvent = mockDb.ledgerEvents.find(
        (ev) => ev['reference_id'] === result.id && ev['event_type'] === 'WITHDRAWAL_REFUND'
      );
      expect(refundEvent).toBeDefined();
      expect(new Decimal(String(refundEvent?.['amount'])).equals('8')).toBe(true);
    });
  });

  describe('getUserBalance()', () => {
    it('returns aggregated available balances for a user', async () => {
      const balances = await withdrawalService.getUserBalance(testExternalUserId);
      expect(Array.isArray(balances)).toBe(true);

      const ethBalance = balances.find((b) => b.asset === 'ETH' && b.network === 'ETH');
      expect(ethBalance).toBeDefined();
      expect(new Decimal(ethBalance!.availableBalance).greaterThan(0)).toBe(true);
    });

    it('filters by asset and network when specified', async () => {
      const balances = await withdrawalService.getUserBalance(testExternalUserId, 'ETH', 'ETH');
      expect(Array.isArray(balances)).toBe(true);
      expect(balances.every((b) => b.asset === 'ETH' && b.network === 'ETH')).toBe(true);
    });
  });

  describe('getWithdrawalsByUser()', () => {
    it('returns paginated list of user withdrawals', async () => {
      const withdrawals = await withdrawalService.getWithdrawalsByUser(testExternalUserId, 1, 10);
      expect(Array.isArray(withdrawals)).toBe(true);
      expect(withdrawals.length).toBeGreaterThan(0);
      expect(withdrawals[0]?.externalUserId).toBe(testExternalUserId);
    });
  });

  describe('getBalanceLedger()', () => {
    it('returns chronological audit ledger records for user', async () => {
      const ledger = await withdrawalService.getBalanceLedger(testExternalUserId, 1, 20);
      expect(Array.isArray(ledger)).toBe(true);
      expect(ledger.length).toBeGreaterThan(0);
    });
  });
});
