/**
 * Main Server Entry Point
 * 
 * - Express + Socket.IO server
 * - MediaSoup initialization
 * - Graceful shutdown handling
 * - Health check endpoints
 * - Production-ready (NO MOCK/DEMO)
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { config, validateConfig } from './config';
import { logger } from './logger';
import { WorkerManager } from './mediasoup/WorkerManager';
import { RoomManager } from './mediasoup/RoomManager';
import { AudioProcessor } from './mediasoup/AudioProcessor';
import { SignalingServer } from './socket/SignalingServer';

// Global instances
let workerManager: WorkerManager;
let roomManager: RoomManager;
let audioProcessor: AudioProcessor;
let signalingServer: SignalingServer;
let httpServer: any;

/**
 * Initialize application
 */
async function initialize(): Promise<void> {
  try {
    logger.info('🚀 Starting Gateway Service...');

    // Validate configuration
    validateConfig();

    // Initialize Express
    const app = express();

    // Middleware - Parse CORS origins
    const corsOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : '*';
    
    app.use(cors({
      origin: corsOrigins,
      credentials: true,
    }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Health check endpoint (cho Docker healthcheck)
    app.get('/health', (_req: Request, res: Response) => {
      const workerStats = workerManager ? workerManager.getStats() : null;
      const roomStats = roomManager ? roomManager.getStats() : null;
      const audioStats = audioProcessor ? audioProcessor.getStats() : null;

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        workers: workerStats,
        rooms: roomStats,
        audioStreaming: audioStats,
      });
    });

    // Metrics endpoint (cho Prometheus)
    app.get('/metrics', (_req: Request, res: Response) => {
      const workerStats = workerManager.getStats();
      const roomStats = roomManager.getStats();
      const audioStats = audioProcessor.getStats();

      // Prometheus format
      const metrics = [
        `# HELP gateway_workers_total Total number of MediaSoup workers`,
        `# TYPE gateway_workers_total gauge`,
        `gateway_workers_total ${workerStats.totalWorkers}`,
        ``,
        `# HELP gateway_rooms_total Total number of active rooms`,
        `# TYPE gateway_rooms_total gauge`,
        `gateway_rooms_total ${roomStats.totalRooms}`,
        ``,
        `# HELP gateway_audio_streams_total Total number of active audio streams`,
        `# TYPE gateway_audio_streams_total gauge`,
        `gateway_audio_streams_total ${audioStats.activeStreams}`,
      ].join('\n');

      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    });

    // Stats endpoint (human-readable)
    app.get('/stats', (_req: Request, res: Response) => {
      res.json({
        workers: workerManager.getStats(),
        rooms: roomManager.getStats(),
        audioStreaming: audioProcessor.getStats(),
      });
    });

    // 404 handler
    app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'Endpoint không tồn tại',
      });
    });

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: any) => {
      logger.error('Express error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Đã xảy ra lỗi server',
      });
    });

    // Create HTTP server
    httpServer = createServer(app);

    // Initialize MediaSoup workers
    logger.info('Initializing WorkerManager...');
    workerManager = new WorkerManager();
    await workerManager.initialize();

    // Initialize RoomManager với Redis
    logger.info('Initializing RoomManager...');
    roomManager = new RoomManager();
    await roomManager.initialize();

    // Initialize AudioProcessor
    logger.info('Initializing AudioProcessor...');
    audioProcessor = new AudioProcessor();

    // Initialize SignalingServer
    // NOTE: SignalingServer constructor đã tự đăng ký event listeners cho AudioProcessor
    // KHÔNG đăng ký lại ở đây để tránh duplicate handling
    logger.info('Initializing SignalingServer...');
    signalingServer = new SignalingServer(
      httpServer,
      workerManager,
      roomManager,
      audioProcessor
    );

    // Start HTTP server
    await new Promise<void>((resolve) => {
      httpServer.listen(config.server.port, config.server.host, () => {
        logger.info(`✅ Gateway Service started on ${config.server.host}:${config.server.port}`);
        logger.info(`   WebSocket: ws://${config.server.host}:${config.server.port}`);
        logger.info(`   Health: http://${config.server.host}:${config.server.port}/health`);
        logger.info(`   Metrics: http://${config.server.host}:${config.server.port}/metrics`);
        resolve();
      });
    });

    logger.info('🎉 Gateway Service is ready!');
  } catch (error) {
    logger.error('Failed to initialize Gateway Service:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`\n🛑 Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          logger.info('HTTP server closed');
          resolve();
        });
      });
    }

    // Shutdown components in reverse order
    if (audioProcessor) {
      await audioProcessor.shutdown();
    }

    if (roomManager) {
      await roomManager.shutdown();
    }

    if (workerManager) {
      await workerManager.shutdown();
    }

    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

/**
 * Handle uncaught errors
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('UNHANDLED_REJECTION');
});

/**
 * Handle shutdown signals
 */
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * Start application
 */
initialize().catch((error) => {
  logger.error('Fatal error during initialization:', error);
  process.exit(1);
});
