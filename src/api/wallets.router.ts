// ============================================================
// src/api/wallets.router.ts
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyAuth } from './middleware/auth.js';
import { standardRateLimit } from './middleware/rateLimit.js';
import { validate, validateParams, createWalletSchema, userIdParamSchema } from './middleware/validate.js';
import { asyncHandler } from './middleware/errorHandler.js';
import { WalletService } from '../services/WalletService.js';
import { Network } from '../types/index.js';

const router = Router();
const walletService = new WalletService();

/** POST /api/v1/wallets — create deposit addresses for a new user */
router.post(
  '/',
  standardRateLimit,
  apiKeyAuth,
  validate(createWalletSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId, networks } = req.body as { externalUserId: string; networks?: Network[] };
    const wallets = await walletService.createUserWallets(externalUserId, networks);
    res.status(201).json({ success: true, data: wallets, requestId: uuidv4() });
  }),
);

/** GET /api/v1/wallets/:externalUserId — get all addresses for a user */
router.get(
  '/:externalUserId',
  standardRateLimit,
  apiKeyAuth,
  validateParams(userIdParamSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId } = req.params as { externalUserId: string };
    const wallets = await walletService.getUserWallets(externalUserId);
    res.json({ success: true, data: wallets, requestId: uuidv4() });
  }),
);

/** GET /api/v1/wallets/:externalUserId/:network — get address for specific network */
router.get(
  '/:externalUserId/:network',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId, network } = req.params as { externalUserId: string; network: string };
    const wallet = await walletService.getUserWalletForNetwork(externalUserId, network as Network);
    if (!wallet) {
      res.status(404).json({ success: false, error: 'Wallet not found', requestId: uuidv4() });
      return;
    }
    res.json({ success: true, data: wallet, requestId: uuidv4() });
  }),
);

export default router;
