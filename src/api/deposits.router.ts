// ============================================================
// src/api/deposits.router.ts
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyAuth } from './middleware/auth.js';
import { standardRateLimit } from './middleware/rateLimit.js';
import { validateQuery, paginationSchema } from './middleware/validate.js';
import { asyncHandler, NotFoundError } from './middleware/errorHandler.js';
import { DepositService } from '../services/DepositService.js';

const router = Router();
const depositService = new DepositService();

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

/** GET /api/v1/transactions/:txHash — raw transaction status by hash */
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
