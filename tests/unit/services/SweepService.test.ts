// ============================================================
// tests/unit/services/SweepService.test.ts
// Unit tests for SweepService (Phase 2 auto-sweeping engine)
// Mock Signer and chain adapters to avoid ESM issues with @solana/web3.js in Jest
// ============================================================

process.env['DB_SERVER'] = 'mock';
process.env['NODE_ENV'] = 'test';

// --- Jest module mocks must be hoisted above imports ---

// Mock the entire chain adapter registry so @solana/web3.js is never loaded
jest.mock('../../../src/chains/index', () => ({
  getAdapter: jest.fn(() => ({
    getBalance: jest.fn(async () => 0n),
    getTokenBalance: jest.fn(async () => 0n),
    estimateFee: jest.fn(async () => 0n),
    buildTransaction: jest.fn(async () => ({ raw: {}, estimatedFee: 0n })),
    signTransaction: jest.fn(async () => ({ raw: '0x...', txHash: '0xmock_tx' })),
    broadcastTransaction: jest.fn(async () => '0xmock_tx'),
    getTransactionStatus: jest.fn(async () => ({ txHash: '0xmock', status: 'CONFIRMED', confirmations: 20 })),
  })),
  adapters: new Map(),
  initializeAdapters: jest.fn(() => new Map()),
}));

// Mock the KMS Signer so no AKV or key material is needed
jest.mock('../../../src/kms/Signer', () => ({
  signAndBroadcast: jest.fn(async () => `0xsweep_mock_${Date.now()}`),
}));

// Mock AKV client to return a deterministic seed buffer
jest.mock('../../../src/kms/AzureKeyVaultClient', () => ({
  akvClient: {
    getMasterSeed: jest.fn(async () => Buffer.alloc(64, 'a')),
    getSecret: jest.fn(async () => 'mock-secret'),
  },
}));

import { SweepService } from '../../../src/services/SweepService';
import { mockDb } from '../../../src/db/mockDb';
import { Network, Asset, EventType } from '../../../src/types';
import { eventEmitter } from '../../../src/events/EventEmitter';
import { v4 as uuidv4 } from 'uuid';

describe('SweepService', () => {
  const sweepService = new SweepService();

  const testUserId = uuidv4();
  const testExternalUserId = `sweep-user-${Date.now()}`;
  const smallWalletId = uuidv4();
  const largeWalletId = uuidv4();

  beforeAll(() => {
    // Seed user
    mockDb.users.push({
      id: testUserId,
      external_user_id: testExternalUserId,
      derivation_index: 20,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Seed small deposit wallet (< $50)
    mockDb.wallets.push({
      id: smallWalletId,
      user_id: testUserId,
      network: Network.ETH,
      asset: Asset.ETH,
      address: '0x2222222222222222222222222222222222222222',
      derivation_path: "m/44'/60'/0'/0/20",
      is_active: 1,
      created_at: new Date(),
    });

    // Seed large deposit wallet (>= $50)
    mockDb.wallets.push({
      id: largeWalletId,
      user_id: testUserId,
      network: Network.ETH,
      asset: Asset.ETH,
      address: '0x3333333333333333333333333333333333333333',
      derivation_path: "m/44'/60'/0'/0/21",
      is_active: 1,
      created_at: new Date(),
    });

    // Small deposit: 5 units (below $50 threshold)
    mockDb.deposits.push({
      id: uuidv4(),
      wallet_id: smallWalletId,
      tx_hash: `0xsmall_dep_${Date.now()}`,
      asset: Asset.ETH,
      network: Network.ETH,
      amount: '5',
      confirmations: 15,
      status: 'COMPLETED',
      created_at: new Date(),
      confirmed_at: new Date(),
      updated_at: new Date(),
    });

    // Large deposit: 100 units (above $50 threshold)
    mockDb.deposits.push({
      id: uuidv4(),
      wallet_id: largeWalletId,
      tx_hash: `0xlarge_dep_${Date.now()}`,
      asset: Asset.ETH,
      network: Network.ETH,
      amount: '100',
      confirmations: 15,
      status: 'COMPLETED',
      created_at: new Date(),
      confirmed_at: new Date(),
      updated_at: new Date(),
    });
  });

  describe('checkAndSweep()', () => {
    it('should NOT sweep when wallet balance is below the $50 threshold', async () => {
      const initialTransfersCount = mockDb.internalTransfers.length;
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      await sweepService.checkAndSweep(smallWalletId, Network.ETH);

      expect(mockDb.internalTransfers.length).toBe(initialTransfersCount);
      expect(emitSpy).not.toHaveBeenCalledWith(EventType.SWEEP_COMPLETED, expect.anything());

      emitSpy.mockRestore();
    });

    it('should execute sweep to Omnibus Vault when balance >= threshold', async () => {
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      await sweepService.checkAndSweep(largeWalletId, Network.ETH);

      // Verify internal transfer record was created
      const transfers = await sweepService.getInternalTransfers();
      const sweepTransfer = transfers.find(
        (t: { from_address: string; transfer_type: string; status: string; network: string }) =>
          t.from_address === '0x3333333333333333333333333333333333333333' && t.transfer_type === 'SWEEP',
      );
      expect(sweepTransfer).toBeDefined();
      expect(sweepTransfer.status).toBe('COMPLETED');
      expect(sweepTransfer.network).toBe(Network.ETH);

      // Verify SWEEP_COMPLETED event emitted
      expect(emitSpy).toHaveBeenCalledWith(
        EventType.SWEEP_COMPLETED,
        expect.objectContaining({
          walletId: largeWalletId,
          network: Network.ETH,
          amount: '100',
        }),
      );

      emitSpy.mockRestore();
    });
  });

  describe('triggerSweep()', () => {
    it('should trigger sweep by externalUserId and network', async () => {
      const res = await sweepService.triggerSweep(testExternalUserId, Network.ETH);
      expect(res).toBe('Sweep triggered');
    });

    it('should not crash when called for an unknown user in mock mode', async () => {
      // In mock mode, JOINs are not enforced — this verifies no unhandled error propagates
      await expect(sweepService.triggerSweep('non-existent-user-xyz', Network.ETH)).resolves.toBeDefined();
    });
  });

  describe('runSweepCycle()', () => {
    it('should run sweep cycle across active wallets without throwing', async () => {
      await expect(sweepService.runSweepCycle(Network.ETH)).resolves.not.toThrow();
    });
  });
});
