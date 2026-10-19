// ============================================================
// src/api/index.ts — Main API router
// ============================================================

import { Router } from 'express';
import walletsRouter from './wallets.router.js';
import withdrawalsRouter from './withdrawals.router.js';
import depositsRouter from './deposits.router.js';
import adminRouter from './admin.router.js';
import balanceRouter from './balance.router.js';

const apiRouter = Router();

apiRouter.use('/wallets', walletsRouter);
apiRouter.use('/withdrawals', withdrawalsRouter);
apiRouter.use('/deposits', depositsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/balance', balanceRouter);

export default apiRouter;
