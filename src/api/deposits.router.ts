// ============================================================
// src/api/deposits.router.ts
// Phase 2: Deposit detection, confirmation tracking, sweeps & events
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyAuth } from './middleware/auth.js';
import { standardRateLimit } from './middleware/rateLimit.js';
import { validateQuery, paginationSchema } from './middleware/validate.js';
import { asyncHandler, NotFoundError } from './middleware/errorHandler.js';
import { DepositService } from '../services/DepositService.js';
import { WalletService } from '../services/WalletService.js';
import { SweepService } from '../services/SweepService.js';
import { eventEmitter } from '../events/EventEmitter.js';
import { REQUIRED_CONFIRMATIONS } from '../utils/constants.js';
import { Network, Asset } from '../types/index.js';

const router = Router();
const depositService = new DepositService();
const walletService = new WalletService();
const sweepService = new SweepService();

/** POST /api/v1/deposits/simulate — simulate an on-chain deposit event */
router.post(
  '/simulate',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId, network, asset, amount, autoConfirm = true } = req.body as {
      externalUserId: string;
      network: Network;
      asset: Asset;
      amount: string;
      autoConfirm?: boolean;
    };

    if (!externalUserId || !network || !asset || !amount) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: externalUserId, network, asset, amount',
        requestId: uuidv4(),
      });
      return;
    }

    // 1. Get or create user wallet for this network
    let wallet = await walletService.getUserWalletForNetwork(externalUserId, network);
    if (!wallet) {
      await walletService.createUserWallets(externalUserId);
      wallet = await walletService.getUserWalletForNetwork(externalUserId, network);
    }

    if (!wallet) {
      res.status(500).json({ success: false, error: 'Failed to locate user deposit wallet', requestId: uuidv4() });
      return;
    }

    // 2. Generate simulated transaction hash
    const txHash = `0xdep_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 3. Record detected deposit (UNCONFIRMED)
    await depositService.recordDetectedDeposit({
      walletId: wallet.id,
      txHash,
      asset,
      network,
      amount: String(amount),
    });

    const requiredConfs = REQUIRED_CONFIRMATIONS[network] ?? 12;

    // 4. If autoConfirm is requested, advance confirmations to the required threshold
    if (autoConfirm) {
      await depositService.updateConfirmations(txHash, requiredConfs, network);
      // Auto-sweep check: user deposit vault -> omnibus vault
      await sweepService.checkAndSweep(wallet.id, network);
    }

    const recorded = await depositService.getTransactionByHash(txHash);

    res.status(201).json({
      success: true,
      data: {
        deposit: recorded,
        walletAddress: wallet.address,
        requiredConfirmations: requiredConfs,
        autoConfirmed: Boolean(autoConfirm),
      },
      requestId: uuidv4(),
    });
  }),
);

/** POST /api/v1/deposits/confirm — update confirmation count for a deposit */
router.post(
  '/confirm',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { txHash, confirmations, network } = req.body as {
      txHash: string;
      confirmations: number;
      network: Network;
    };

    if (!txHash || confirmations === undefined || !network) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: txHash, confirmations, network',
        requestId: uuidv4(),
      });
      return;
    }

    await depositService.updateConfirmations(txHash, Number(confirmations), network);
    const deposit = await depositService.getTransactionByHash(txHash);

    if (deposit?.status === 'COMPLETED' && deposit.walletId) {
      await sweepService.checkAndSweep(deposit.walletId, network);
    }

    res.json({ success: true, data: deposit, requestId: uuidv4() });
  }),
);

/** GET /api/v1/deposits/events — retrieve recent emitted custody events & webhook payloads */
router.get(
  '/events',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const events = eventEmitter.getRecentEvents();
    res.json({ success: true, data: events, requestId: uuidv4() });
  }),
);

/** GET /api/v1/deposits/internal-transfers — list sweeps (user deposit -> omnibus -> revenue) */
router.get(
  '/internal-transfers',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const transfers = await sweepService.getInternalTransfers();
    res.json({ success: true, data: transfers, requestId: uuidv4() });
  }),
);

/** GET /api/v1/deposits/:externalUserId — list confirmed deposits for a user */
router.get(
  '/:externalUserId',
  standardRateLimit,
  apiKeyAuth,
  validateQuery(paginationSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId } = req.params as { externalUserId: string };
    const { page, limit } = req.query as { page: string; limit: string };

    const deposits = await depositService.getUserDeposits(
      externalUserId,
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '20', 10),
    );

    res.json({ success: true, data: deposits, requestId: uuidv4() });
  }),
);

/** GET /api/v1/deposits/tx/:txHash — raw transaction status by hash */
router.get(
  '/tx/:txHash',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { txHash } = req.params as { txHash: string };
    const deposit = await depositService.getTransactionByHash(txHash);
    if (!deposit) throw new NotFoundError('Transaction');
    res.json({ success: true, data: deposit, requestId: uuidv4() });
  }),
);

export default router;
