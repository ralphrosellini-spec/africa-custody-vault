// ============================================================
// src/api/withdrawals.router.ts
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { apiKeyAuth } from './middleware/auth.js';
import { withdrawalRateLimit, standardRateLimit } from './middleware/rateLimit.js';
import { validate, withdrawalSchema } from './middleware/validate.js';
import { asyncHandler, NotFoundError } from './middleware/errorHandler.js';
import { WithdrawalService } from '../services/WithdrawalService.js';
import { WithdrawalRequest } from '../types/index.js';

const router = Router();
const withdrawalService = new WithdrawalService();

/**
 * GET /api/v1/withdrawals?externalUserId=xxx
 * List withdrawals for a user (paginated).
 * Must be registered BEFORE /:id to avoid route conflict.
 */
router.get(
  '/',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const externalUserId = String(req.query['externalUserId'] ?? '').trim();
    if (!externalUserId) {
      res.status(400).json({
        success: false,
        error: 'Query parameter externalUserId is required',
        requestId: uuidv4(),
      });
      return;
    }
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10));
    const limit = Math.min(100, parseInt(String(req.query['limit'] ?? '20'), 10));
    const withdrawals = await withdrawalService.getWithdrawalsByUser(externalUserId, page, limit);
    res.json({ success: true, data: withdrawals, requestId: uuidv4() });
  }),
);

/** POST /api/v1/withdrawals — initiate a withdrawal */
router.post(
  '/',
  withdrawalRateLimit,
  apiKeyAuth,
  validate(withdrawalSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as {
      externalUserId: string;
      asset: WithdrawalRequest['asset'];
      network: WithdrawalRequest['network'];
      destinationAddress: string;
      grossAmount: string;
    };

    const request: WithdrawalRequest = {
      externalUserId: body.externalUserId,
      asset: body.asset,
      network: body.network,
      destinationAddress: body.destinationAddress,
      grossAmount: body.grossAmount,
      requestorIp: req.callerIp,
      requestorApiKeyId: req.apiKeyId,
    };

    const withdrawal = await withdrawalService.createWithdrawal(request);
    res.status(202).json({ success: true, data: withdrawal, requestId: uuidv4() });
  }),
);

/** GET /api/v1/withdrawals/:id — get withdrawal status */
router.get(
  '/:id',
  standardRateLimit,
  apiKeyAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    const withdrawal = await withdrawalService.getWithdrawal(id);
    if (!withdrawal) throw new NotFoundError('Withdrawal');
    res.json({ success: true, data: withdrawal, requestId: uuidv4() });
  }),
);

export default router;
