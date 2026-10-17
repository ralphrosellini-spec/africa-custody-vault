// ============================================================
// src/api/admin.router.ts
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { adminKeyAuth } from './middleware/auth.js';
import { adminRateLimit } from './middleware/rateLimit.js';
import { validate, sweepSchema, feeSweepSchema, emergencyPauseSchema } from './middleware/validate.js';
import { asyncHandler } from './middleware/errorHandler.js';
import { SweepService } from '../services/SweepService.js';
import { ReconciliationService } from '../services/ReconciliationService.js';
import { DepositListenerManager } from '../listeners/DepositListenerManager.js';
import { GasMonitor } from '../listeners/GasMonitor.js';
import { getPool, sql } from '../db/connection.js';
import { TABLES } from '../utils/constants.js';
import { Network, Asset } from '../types/index.js';

const router = Router();
const sweepService = new SweepService();
const reconciliationService = new ReconciliationService();
const listenerManager = new DepositListenerManager();
const gasMonitor = new GasMonitor();

/** POST /api/v1/admin/sweep — manually trigger user vault sweep */
router.post(
  '/sweep',
  adminRateLimit,
  adminKeyAuth,
  validate(sweepSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { externalUserId, network } = req.body as { externalUserId: string; network: Network };
    const txHash = await sweepService.triggerSweep(externalUserId, network);
    res.json({ success: true, data: { txHash }, requestId: uuidv4() });
  }),
);

/** POST /api/v1/admin/fee-sweep — sweep fees omnibus -> revenue vault */
router.post(
  '/fee-sweep',
  adminRateLimit,
  adminKeyAuth,
  validate(feeSweepSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { asset, network } = req.body as { asset: Asset; network: Network };
    const txHash = await sweepService.triggerFeeSweep(asset, network);
    res.json({ success: true, data: { txHash }, requestId: uuidv4() });
  }),
);

/** GET /api/v1/admin/health — system health check */
router.get(
  '/health',
  adminRateLimit,
  adminKeyAuth,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const [listenerHealth, gasBalances] = await Promise.all([
      Promise.resolve(listenerManager.getHealthStatus()),
      gasMonitor.getBalances(),
    ]);

    res.json({
      success: true,
      data: {
        status: 'ok',
        listeners: listenerHealth,
        gasBalances,
        timestamp: new Date().toISOString(),
      },
      requestId: uuidv4(),
    });
  }),
);

/** POST /api/v1/admin/emergency-pause — halt all outgoing transactions */
router.post(
  '/emergency-pause',
  adminRateLimit,
  adminKeyAuth,
  validate(emergencyPauseSchema),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paused, reason } = req.body as { paused: boolean; reason: string };
    const pool = await getPool();

    await pool.request()
      .input('value', sql.NVarChar, String(paused))
      .input('reason', sql.NVarChar, reason)
      .input('updated_by', sql.NVarChar, req.apiKeyId)
      .query(`
        UPDATE ${TABLES.CONFIG}
        SET [value] = @value,
            description = @reason,
            updated_at = SYSDATETIMEOFFSET(),
            updated_by = @updated_by
        WHERE [key] = 'emergency_pause'
      `);

    res.json({
      success: true,
      data: { emergencyPause: paused, reason },
      requestId: uuidv4(),
    });
  }),
);

/** GET /api/v1/admin/reconciliation — trigger manual reconciliation */
router.get(
  '/reconciliation',
  adminRateLimit,
  adminKeyAuth,
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const report = await reconciliationService.runReconciliation();
    res.json({ success: true, data: report, requestId: uuidv4() });
  }),
);

export default router;
