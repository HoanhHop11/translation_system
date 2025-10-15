/**
 * WorkerManager - Quản lý MediaSoup Worker pool cho streaming
 * 
 * Worker pool với:
 * - Load balancing cho rooms
 * - Auto-restart khi worker dies
 * - Health monitoring
 * - Streaming-optimized allocation
 */

import * as mediasoup from 'mediasoup';
import { Worker, Router } from 'mediasoup/node/lib/types';
import { config } from '../config';
import { logger } from '../logger';
import { WorkerData } from '../types';

export class WorkerManager {
  private workers: Map<number, WorkerData> = new Map();
  private currentWorkerIndex = 0;
  private isShuttingDown = false;

  /**
   * Initialize worker pool cho streaming
   */
  async initialize(): Promise<void> {
    logger.info(`🚀 Initializing ${config.mediasoup.numWorkers} MediaSoup workers...`);

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < config.mediasoup.numWorkers; i++) {
      workerPromises.push(this.createWorker(i));
    }

    await Promise.all(workerPromises);

    logger.info(`✅ Worker pool initialized với ${this.workers.size} workers`);
  }

  /**
   * Tạo MediaSoup worker với lifecycle events
   */
  private async createWorker(index: number): Promise<void> {
    try {
      logger.info(`Creating worker #${index}...`);

      const worker = await mediasoup.createWorker({
        logLevel: config.mediasoup.worker.logLevel,
        logTags: config.mediasoup.worker.logTags,
        rtcMinPort: config.mediasoup.worker.rtcMinPort,
        rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
      });

      // CRITICAL: Worker 'died' event handler (theo MediaSoup best practices)
      worker.on('died', (error) => {
        logger.error(`❌ Worker #${index} died unexpectedly:`, {
          error: error?.message || 'Unknown error',
          pid: worker.pid,
        });

        // Cleanup failed worker
        this.workers.delete(index);

        // Auto-restart nếu không đang shutdown
        if (!this.isShuttingDown) {
          logger.info(`♻️  Auto-restarting worker #${index}...`);
          this.createWorker(index).catch((err) => {
            logger.error(`Failed to restart worker #${index}:`, err);
          });
        }
      });

      // Store worker data
      this.workers.set(index, {
        worker,
        routers: new Map(),
        roomCount: 0,
      });

      logger.info(`✅ Worker #${index} created (PID: ${worker.pid})`);
    } catch (error) {
      logger.error(`Failed to create worker #${index}:`, error);
      throw error;
    }
  }

  /**
   * Lấy least-loaded worker cho room mới (load balancing cho streaming)
   */
  getLeastLoadedWorker(): WorkerData | null {
    if (this.workers.size === 0) {
      logger.error('No workers available');
      return null;
    }

    let leastLoadedWorker: WorkerData | null = null;
    let minRoomCount = Infinity;

    for (const workerData of this.workers.values()) {
      if (workerData.roomCount < minRoomCount) {
        minRoomCount = workerData.roomCount;
        leastLoadedWorker = workerData;
      }
    }

    return leastLoadedWorker;
  }

  /**
   * Tạo Router trên worker cho streaming room
   */
  async createRouter(workerId?: number): Promise<Router> {
    let workerData: WorkerData | null;

    if (workerId !== undefined) {
      workerData = this.workers.get(workerId) || null;
      if (!workerData) {
        throw new Error(`Worker #${workerId} not found`);
      }
    } else {
      // Round-robin allocation cho streaming rooms
      workerData = this.getLeastLoadedWorker();
      if (!workerData) {
        throw new Error('No workers available');
      }
    }

    try {
      const router = await workerData.worker.createRouter({
        mediaCodecs: config.mediasoup.router.mediaCodecs,
      });

      // CRITICAL: Router lifecycle events (theo MediaSoup best practices)
      router.on('workerclose', () => {
        logger.warn('Router closed due to worker closure', {
          routerId: router.id,
        });
        // Cleanup will be handled by RoomManager
      });

      // Track router
      workerData.routers.set(router.id, router);
      workerData.roomCount++;

      logger.info('Router created for streaming room', {
        routerId: router.id,
        workerPid: workerData.worker.pid,
      });

      return router;
    } catch (error) {
      logger.error('Failed to create router:', error);
      throw error;
    }
  }

  /**
   * Close router và update worker stats
   */
  async closeRouter(routerId: string): Promise<void> {
    for (const workerData of this.workers.values()) {
      const router = workerData.routers.get(routerId);
      if (router) {
        try {
          router.close();
          workerData.routers.delete(routerId);
          workerData.roomCount = Math.max(0, workerData.roomCount - 1);

          logger.info('Router closed', { routerId });
        } catch (error) {
          logger.error('Error closing router:', { routerId, error });
        }
        return;
      }
    }

    logger.warn('Router not found for closing', { routerId });
  }

  /**
   * Lấy thống kê workers cho monitoring
   */
  getStats(): any {
    const stats: any[] = [];

    for (const [index, workerData] of this.workers.entries()) {
      stats.push({
        index,
        pid: workerData.worker.pid,
        roomCount: workerData.roomCount,
        routerCount: workerData.routers.size,
      });
    }

    return {
      totalWorkers: this.workers.size,
      workers: stats,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down WorkerManager...');
    this.isShuttingDown = true;

    // Close all routers trước
    for (const workerData of this.workers.values()) {
      for (const router of workerData.routers.values()) {
        try {
          router.close();
        } catch (error) {
          logger.error('Error closing router during shutdown:', error);
        }
      }
      workerData.routers.clear();
    }

    // Close all workers
    for (const [index, workerData] of this.workers.entries()) {
      try {
        workerData.worker.close();
        logger.info(`Worker #${index} closed (PID: ${workerData.worker.pid})`);
      } catch (error) {
        logger.error(`Error closing worker #${index}:`, error);
      }
    }

    this.workers.clear();
    logger.info('✅ WorkerManager shutdown complete');
  }
}
