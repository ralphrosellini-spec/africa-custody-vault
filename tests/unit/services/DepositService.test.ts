// ============================================================
// tests/unit/services/DepositService.test.ts
// Unit tests for DepositService (Phase 2 deposit lifecycle)
// ============================================================

process.env['DB_SERVER'] = 'mock';
process.env['NODE_ENV'] = 'test';

import { depositService } from '../../../src/services/DepositService';
import { mockDb } from '../../../src/db/mockDb';
import { Network, Asset, TxStatus, EventType } from '../../../src/types';
import { eventEmitter } from '../../../src/events/EventEmitter';
import { v4 as uuidv4 } from 'uuid';

describe('DepositService', () => {
  const testUserId = uuidv4();
  const testExternalUserId = `test-user-${Date.now()}`;
  const testWalletId = uuidv4();
  const testAddress = '0x1111111111111111111111111111111111111111';

  beforeAll(() => {
    // Seed user and wallet in mockDb
    mockDb.users.push({
      id: testUserId,
      external_user_id: testExternalUserId,
      derivation_index: 10,
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockDb.wallets.push({
      id: testWalletId,
      user_id: testUserId,
      network: Network.ETH,
      asset: Asset.ETH,
      address: testAddress,
      derivation_path: "m/44'/60'/0'/0/10",
      is_active: 1,
      created_at: new Date(),
    });
  });

  describe('recordDetectedDeposit()', () => {
    it('should record a newly detected unconfirmed deposit', async () => {
      const txHash = `0xtest_deposit_${Date.now()}_1`;
      await depositService.recordDetectedDeposit({
        walletId: testWalletId,
        txHash,
        asset: Asset.ETH,
        network: Network.ETH,
        amount: '1.5',
      });

      const deposit = await depositService.getTransactionByHash(txHash);
      expect(deposit).toBeDefined();
      expect(deposit?.txHash).toBe(txHash);
      expect(deposit?.amount).toBe('1.5');
      expect(deposit?.status).toBe(TxStatus.UNCONFIRMED);
      expect(deposit?.confirmations).toBe(0);
    });

    it('should skip duplicate insertion if txHash already exists', async () => {
      const txHash = `0xtest_deposit_${Date.now()}_dup`;
      await depositService.recordDetectedDeposit({
        walletId: testWalletId,
        txHash,
        asset: Asset.ETH,
        network: Network.ETH,
        amount: '2.0',
      });

      const initialCount = mockDb.deposits.length;

      // Duplicate attempt
      await depositService.recordDetectedDeposit({
        walletId: testWalletId,
        txHash,
        asset: Asset.ETH,
        network: Network.ETH,
        amount: '2.0',
      });

      expect(mockDb.deposits.length).toBe(initialCount);
    });
  });

  describe('updateConfirmations()', () => {
    it('should transition to CONFIRMING when confirmations < required threshold', async () => {
      const txHash = `0xtest_deposit_${Date.now()}_partial`;
      await depositService.recordDetectedDeposit({
        walletId: testWalletId,
        txHash,
        asset: Asset.ETH,
        network: Network.ETH,
        amount: '0.75',
      });

      // ETH requires 12 confirmations; update to 4
      await depositService.updateConfirmations(txHash, 4, Network.ETH);

      const deposit = await depositService.getTransactionByHash(txHash);
      expect(deposit?.confirmations).toBe(4);
      expect(deposit?.status).toBe(TxStatus.CONFIRMING);
    });

    it('should transition to COMPLETED, credit ledger, and emit event when threshold is met', async () => {
      const txHash = `0xtest_deposit_${Date.now()}_complete`;
      await depositService.recordDetectedDeposit({
        walletId: testWalletId,
        txHash,
        asset: Asset.ETH,
        network: Network.ETH,
        amount: '5.0',
      });

      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      // ETH threshold is 12; provide 12
      await depositService.updateConfirmations(txHash, 12, Network.ETH);

      const deposit = await depositService.getTransactionByHash(txHash);
      expect(deposit?.confirmations).toBe(12);
      expect(deposit?.status).toBe(TxStatus.COMPLETED);

      // Verify cv_ledger_events has an append-only entry
      const ledgerEntry = mockDb.ledgerEvents.find(
        (ev) => ev['reference_id'] === deposit?.id && ev['event_type'] === 'DEPOSIT_CONFIRMED',
      );
      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry?.['amount']).toBe('5.0');
      expect(ledgerEntry?.['network']).toBe(Network.ETH);

      // Verify event was emitted
      expect(emitSpy).toHaveBeenCalledWith(
        EventType.DEPOSIT_CONFIRMED,
        expect.objectContaining({
          txHash,
          amount: '5.0',
          network: Network.ETH,
        }),
      );

      emitSpy.mockRestore();
    });

    it('should mark deposit as FAILED if isFailed is true', async () => {
      const txHash = `0xtest_deposit_${Date.now()}_reorg`;
      await depositService.recordDetectedDeposit({
        walletId: testWalletId,
        txHash,
        asset: Asset.ETH,
        network: Network.ETH,
        amount: '1.0',
      });

      await depositService.updateConfirmations(txHash, 0, Network.ETH, true);

      const deposit = await depositService.getTransactionByHash(txHash);
      expect(deposit?.status).toBe(TxStatus.FAILED);
    });
  });

  describe('getUserDeposits() and getPendingDeposits()', () => {
    it('should retrieve deposits for a user', async () => {
      const deposits = await depositService.getUserDeposits(testExternalUserId);
      expect(deposits.length).toBeGreaterThan(0);
      expect(deposits.some((d) => d.walletId === testWalletId)).toBe(true);
    });

    it('should retrieve pending deposits for a network', async () => {
      const pending = await depositService.getPendingDeposits(Network.ETH);
      expect(Array.isArray(pending)).toBe(true);
      // All pending deposits should have status UNCONFIRMED, CONFIRMING, or PENDING
      for (const d of pending) {
        expect(['UNCONFIRMED', 'CONFIRMING', 'PENDING']).toContain(d.status);
      }
    });
  });
});
