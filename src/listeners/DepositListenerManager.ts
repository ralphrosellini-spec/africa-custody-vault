// ============================================================
// src/listeners/DepositListenerManager.ts
// Starts per-network ConfirmationTrackers + sweep scheduler
// ============================================================

import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { getRegisteredNetworks } from '../chains/index.js';
import { ConfirmationTracker } from './ConfirmationTracker.js';
import { SweepService } from '../services/SweepService.js';
import { Network } from '../types/index.js';

interface ListenerHealth {
  healthy: boolean;
  lastPollAt: string;
  network: string;
}

export class DepositListenerManager {
  private trackers = new Map<string, ConfirmationTracker>();
  private sweepJobs = new Map<string, cron.ScheduledTask>();
  private sweepService = new SweepService();
  private healthMap = new Map<string, ListenerHealth>();

  async startAll(): Promise<void> {
    const networks = getRegisteredNetworks();
    logger.info('[ListenerManager] Starting listeners', { networks });

    for (const network of networks) {
      // Start confirmation tracker for this network
      const tracker = new ConfirmationTracker(network, (healthy: boolean) => {
        this.healthMap.set(network, {
          healthy,
          lastPollAt: new Date().toISOString(),
          network,
        });
      });

      tracker.start();
      this.trackers.set(network, tracker);
      this.healthMap.set(network, {
        healthy: true,
        lastPollAt: new Date().toISOString(),
        network,
      });

      // Start sweep cycle every 5 minutes for this network
      const sweepJob = cron.schedule('*/5 * * * *', () => {
        void this.sweepService.runSweepCycle(network as Network);
      });
      this.sweepJobs.set(network, sweepJob);

      logger.info('[ListenerManager] Started listener + sweep cycle', { network });
    }
  }

  async stop(): Promise<void> {
    // Stop all trackers
    for (const [network, tracker] of this.trackers) {
      tracker.stop();
      logger.info('[ListenerManager] Stopped tracker', { network });
    }
    this.trackers.clear();

    // Stop all sweep jobs
    for (const [, job] of this.sweepJobs) {
      job.stop();
    }
    this.sweepJobs.clear();
  }

  getHealthStatus(): Record<string, ListenerHealth> {
    const result: Record<string, ListenerHealth> = {};
    for (const [network, health] of this.healthMap) {
      result[network] = health;
    }
    return result;
  }
}
