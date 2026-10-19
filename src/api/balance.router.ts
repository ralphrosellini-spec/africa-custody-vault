// ============================================================
// src/api/balance.router.ts
// Balance ledger endpoints — Phase 3
// GET /api/v1/balance/:externalUserId           - balance per asset/network
// GET /api/v1/balance/:externalUserId/ledger    - full audit ledger
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyAuth } from './middleware/auth.js';
import { standardRateLimit } from './middleware/rateLimit.js';
import { asyncHandler } from './middleware/errorHandler.js';
import { WithdrawalService } from '../services/WithdrawalService.js';

const router = Router();
const withdrawalService = new WithdrawalService();

/**
 * GET /api/v1/balance/:externalUserId
 * Returns aggregated available balance per asset+network for a user.
 * Optional query params: ?asset=ETH&network=ETH to filter
 */
router.get(
  '/:externalUserId',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId } = req.params as { externalUserId: string };
    const { asset, network } = req.query as { asset?: string; network?: string };
    const balance = await withdrawalService.getUserBalance(externalUserId, asset, network);
    res.json({ success: true, data: balance, requestId: uuidv4() });
  }),
);

/**
 * GET /api/v1/balance/:externalUserId/ledger
 * Returns paginated append-only audit ledger for a user.
 * Query params: ?page=1&limit=50
 */
router.get(
  '/:externalUserId/ledger',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId } = req.params as { externalUserId: string };
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10));
    const limit = Math.min(100, parseInt(String(req.query['limit'] ?? '50'), 10));
    const ledger = await withdrawalService.getBalanceLedger(externalUserId, page, limit);
    res.json({ success: true, data: ledger, requestId: uuidv4() });
  }),
);

export default router;
