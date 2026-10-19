// ============================================================
// src/app.ts — Express application setup
// ============================================================

import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from './api/index.js';
import { errorHandler, notFoundHandler } from './api/middleware/errorHandler.js';
import { API_PREFIX, REQUIRED_CONFIRMATIONS } from './utils/constants.js';
import { logger } from './utils/logger.js';
import { getDashboardHtml } from './views/dashboard.js';
import { WalletService } from './services/WalletService.js';
import { DepositService } from './services/DepositService.js';
import { SweepService } from './services/SweepService.js';
import { eventEmitter } from './events/EventEmitter.js';
import { Network, Asset } from './types/index.js';

export function createApp(): express.Application {
  const app = express();

  // ---- Security headers ----
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    xPoweredBy: false,
  }));

  // ---- CORS — only allowed origins in production ----
  const allowedOrigins = process.env['CORS_ORIGINS']?.split(',') ?? [];
  app.use(cors({
    origin: process.env['NODE_ENV'] === 'production'
      ? allowedOrigins
      : true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Api-Key', 'X-Timestamp', 'X-Signature'],
    credentials: false,
  }));

  // ---- Body parsing — capture raw body for HMAC verification ----
  app.use(express.json({
    limit: '1mb',
    verify: (req: Request & { rawBody?: string }, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));

  // ---- Request logging ----
  app.use((req: Request, _res, next) => {
    logger.info('[HTTP] Incoming request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    next();
  });

  // ---- Interactive Portal Dashboard for Manager / Evaluator ----
  app.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getDashboardHtml());
  });

  // ---- Demo endpoint for live interactive address derivation ----
  const demoWalletService = new WalletService();
  const demoDepositService = new DepositService();
  const demoSweepService = new SweepService();

  app.post('/demo/derive', async (req: Request, res: Response) => {
    try {
      const extId = (req.body?.externalUserId as string) || 'manager-demo';
      const wallets = await demoWalletService.createUserWallets(extId);
      res.json({ success: true, data: wallets });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Demo endpoint for deposit & auto-sweep simulation ----
  app.post('/demo/deposit', async (req: Request, res: Response) => {
    try {
      const extId = (req.body?.externalUserId as string) || 'manager-demo';
      const network = (req.body?.network as Network) || Network.ETH;
      const asset = (req.body?.asset as Asset) || (network as unknown as Asset);
      const amount = (req.body?.amount as string) || '100.00';

      let wallet = await demoWalletService.getUserWalletForNetwork(extId, network);
      if (!wallet) {
        await demoWalletService.createUserWallets(extId);
        wallet = await demoWalletService.getUserWalletForNetwork(extId, network);
      }

      if (!wallet) throw new Error('Could not derive wallet for user');

      const txHash = `0xdep_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      await demoDepositService.recordDetectedDeposit({
        walletId: wallet.id,
        txHash,
        asset,
        network,
        amount,
      });

      const requiredConfs = REQUIRED_CONFIRMATIONS[network] ?? 12;
      await demoDepositService.updateConfirmations(txHash, requiredConfs, network);
      await demoSweepService.checkAndSweep(wallet.id, network);

      const deposit = await demoDepositService.getTransactionByHash(txHash);
      const transfers = await demoSweepService.getInternalTransfers();
      const events = eventEmitter.getRecentEvents();

      res.json({
        success: true,
        data: {
          deposit,
          walletAddress: wallet.address,
          requiredConfirmations: requiredConfs,
          recentEvents: events.slice(0, 5),
          sweeps: transfers.slice(0, 5),
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Demo endpoint for recent custody events ----
  app.get('/demo/events', (_req: Request, res: Response) => {
    res.json({
      success: true,
      events: eventEmitter.getRecentEvents(),
    });
  });

  // ---- Demo endpoint for withdrawal simulation ----
  app.post('/demo/withdrawal', async (req: Request, res: Response) => {
    try {
      const { WithdrawalService } = await import('./services/WithdrawalService.js');
      const svc = new WithdrawalService();
      const extId = (req.body?.externalUserId as string) || 'manager-demo';
      const asset = (req.body?.asset as Asset) || Asset.ETH;
      const network = (req.body?.network as Network) || Network.ETH;
      const grossAmount = (req.body?.grossAmount as string) || '10';
      const destinationAddress = (req.body?.destinationAddress as string) || '0xDemo000000000000000000000000000000000001';

      // Ensure user has a wallet so balance ledger can be seeded
      let wallet = await demoWalletService.getUserWalletForNetwork(extId, network);
      if (!wallet) {
        await demoWalletService.createUserWallets(extId);
        wallet = await demoWalletService.getUserWalletForNetwork(extId, network);
      }

      const result = await svc.createWithdrawal({
        externalUserId: extId,
        asset,
        network,
        destinationAddress,
        grossAmount,
        requestorIp: req.ip ?? '127.0.0.1',
        requestorApiKeyId: 'demo-api-key',
      });

      res.json({ success: true, data: result });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(status).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Demo endpoint for balance query ----
  app.get('/demo/balance', async (req: Request, res: Response) => {
    try {
      const { WithdrawalService } = await import('./services/WithdrawalService.js');
      const svc = new WithdrawalService();
      const extId = (req.query?.externalUserId as string) || 'manager-demo';
      const balances = await svc.getUserBalance(extId);
      const withdrawals = await svc.getWithdrawalsByUser(extId);
      res.json({ success: true, data: { balances, recentWithdrawals: withdrawals.slice(0, 10) } });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Health check (no auth required) ----
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: process.env['npm_package_version'] ?? '1.0.0',
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  });

  // ---- API routes ----
  app.use(API_PREFIX, apiRouter);

  // ---- 404 + Error handlers (must be last) ----
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
