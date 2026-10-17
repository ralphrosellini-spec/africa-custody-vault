// ============================================================
// src/app.ts — Express application setup
// ============================================================

import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import apiRouter from './api/index.js';
import { errorHandler, notFoundHandler } from './api/middleware/errorHandler.js';
import { API_PREFIX } from './utils/constants.js';
import { logger } from './utils/logger.js';
import { getDashboardHtml } from './views/dashboard.js';
import { WalletService } from './services/WalletService.js';

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
  app.post('/demo/derive', async (req: Request, res: Response) => {
    try {
      const extId = (req.body?.externalUserId as string) || 'manager-demo';
      const wallets = await demoWalletService.createUserWallets(extId);
      res.json({ success: true, data: wallets });
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
