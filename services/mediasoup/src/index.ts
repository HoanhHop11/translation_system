import express, { Request, Response } from 'express';
import cors from 'cors';
import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';

// Types
interface RoomData {
  router: mediasoupTypes.Router;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

// Configuration
const config = {
  port: parseInt(process.env.PORT || '4000'),
  workerCount: parseInt(process.env.WORKER_COUNT || '2'),
  rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000'),
  rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '40100'),
  announcedIp: process.env.ANNOUNCED_IP || '34.142.190.250',  // translation02 public IP (CORRECT!)
  logLevel: (process.env.LOG_LEVEL || 'warn') as mediasoupTypes.WorkerLogLevel,
};

// MediaCodecs configuration
const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: {
      'profile-id': 2,
      'x-google-start-bitrate': 1000,
    },
  },
  {
    kind: 'video',
    mimeType: 'video/h264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '4d0032',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

// Global state
const workers: mediasoupTypes.Worker[] = [];
const rooms = new Map<string, RoomData>();
let nextWorkerIndex = 0;

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

/**
 * Khởi tạo MediaSoup Workers
 */
async function initMediaSoupWorkers(): Promise<void> {
  console.log('🔧 Initializing MediaSoup workers...');
  
  for (let i = 0; i < config.workerCount; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.logLevel,
      rtcMinPort: config.rtcMinPort,
      rtcMaxPort: config.rtcMaxPort,
    });

    worker.on('died', (error) => {
      console.error(`❌ MediaSoup worker ${i} died:`, error);
      process.exit(1);
    });

    workers.push(worker);
    console.log(`✅ MediaSoup worker ${i} created (PID: ${worker.pid})`);
  }
}

/**
 * Lấy worker tiếp theo theo round-robin
 */
function getNextWorker(): mediasoupTypes.Worker {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

/**
 * Tạo Router cho Room
 */
async function createRouter(roomId: string): Promise<mediasoupTypes.Router> {
  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs });
  
  console.log(`✅ Router created for room ${roomId} on worker PID ${worker.pid}`);
  
  return router;
}

// ==================== REST API ENDPOINTS ====================

/**
 * Health Check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    workers: workers.length,
    rooms: rooms.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /router/:roomId/capabilities
 * Lấy RTP capabilities của router
 */
app.get('/router/:roomId/capabilities', async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    
    let roomData = rooms.get(roomId);
    
    // Tạo room mới nếu chưa tồn tại
    if (!roomData) {
      const router = await createRouter(roomId);
      roomData = {
        router,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      rooms.set(roomId, roomData);
    }
    
    res.json({
      rtpCapabilities: roomData.router.rtpCapabilities,
    });
  } catch (error) {
    console.error('Error getting router capabilities:', error);
    res.status(500).json({ error: 'Failed to get router capabilities' });
  }
});

/**
 * POST /transport/create
 * Tạo WebRTC Transport (send hoặc receive)
 */
app.post('/transport/create', async (req: Request, res: Response) => {
  try {
    const { roomId, type } = req.body;
    
    if (!roomId || !type) {
      return res.status(400).json({ error: 'roomId and type are required' });
    }
    
    let roomData = rooms.get(roomId);
    if (!roomData) {
      // Fallback: lazily create router/room if not exists (race-safe for first request sequence)
      const router = await createRouter(roomId);
      roomData = {
        router,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      rooms.set(roomId, roomData);
      console.log(`ℹ️  Room ${roomId} was missing during transport/create → created on-the-fly`);
    }
    
    // Tạo WebRTC Transport
    const transport = await roomData.router.createWebRtcTransport({
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: config.announcedIp,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: false,  // 🔄 Try TCP first (fallback for UDP issues)
      preferTcp: true,   // 🔄 Prefer TCP over UDP
    });
    
    // Lưu transport
    roomData.transports.set(transport.id, transport);
    
    console.log(`✅ ${type} transport created: ${transport.id} for room ${roomId}`);
    console.log(`🌐 ICE candidates:`, JSON.stringify(transport.iceCandidates, null, 2));
    console.log(`🔑 ICE parameters:`, JSON.stringify(transport.iceParameters, null, 2));
    console.log(`🔐 DTLS parameters:`, JSON.stringify(transport.dtlsParameters, null, 2));
    
    res.json({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  } catch (error: any) {
    // Provide detailed diagnostics to aid remote debugging
    const message = error?.message || String(error);
    console.error('Error creating transport:', message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ error: 'Failed to create transport', details: message });
  }
});

/**
 * POST /transport/connect
 * Kết nối WebRTC Transport
 */
app.post('/transport/connect', async (req: Request, res: Response) => {
  try {
    const { roomId, transportId, dtlsParameters } = req.body;
    
    if (!roomId || !transportId || !dtlsParameters) {
      return res.status(400).json({ 
        error: 'roomId, transportId, and dtlsParameters are required' 
      });
    }
    
    const roomData = rooms.get(roomId);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const transport = roomData.transports.get(transportId);
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    
    console.log(`🔗 Connecting transport ${transportId}...`);
    console.log(`📨 DTLS parameters from client:`, JSON.stringify(dtlsParameters, null, 2));
    
    await transport.connect({ dtlsParameters });
    
    console.log(`✅ Transport connected: ${transportId} (DTLS handshake complete)`);
    console.log(`🔍 Transport state:`, {
      id: transport.id,
      // Note: MediaSoup doesn't expose iceState directly, check via events
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error connecting transport:', error);
    res.status(500).json({ error: 'Failed to connect transport' });
  }
});

/**
 * POST /transport/close
 * Đóng WebRTC Transport (cleanup producers/consumers tự động)
 * Theo MediaSoup lifecycle: transport.close() → auto cleanup all producers/consumers
 */
app.post('/transport/close', async (req: Request, res: Response) => {
  try {
    const { roomId, transportId } = req.body;
    
    if (!roomId || !transportId) {
      return res.status(400).json({ 
        error: 'roomId and transportId are required' 
      });
    }
    
    const roomData = rooms.get(roomId);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const transport = roomData.transports.get(transportId);
    if (!transport) {
      // Transport đã bị close rồi - OK
      console.log(`⚠️  Transport already closed: ${transportId}`);
      return res.json({ success: true, message: 'Transport already closed' });
    }
    
    // Close transport - auto cleanup producers/consumers
    transport.close();
    
    // Remove từ room state
    roomData.transports.delete(transportId);
    
    console.log(`🧹 Transport closed: ${transportId} for room ${roomId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error closing transport:', error);
    res.status(500).json({ error: 'Failed to close transport' });
  }
});

/**
 * POST /producer/create
 * Tạo Producer (gửi media)
 */
app.post('/producer/create', async (req: Request, res: Response) => {
  try {
    const { roomId, transportId, kind, rtpParameters } = req.body;
    
    if (!roomId || !transportId || !kind || !rtpParameters) {
      return res.status(400).json({
        error: 'roomId, transportId, kind, and rtpParameters are required',
      });
    }
    
    const roomData = rooms.get(roomId);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const transport = roomData.transports.get(transportId);
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    
    const producer = await transport.produce({
      kind,
      rtpParameters,
    });
    
    roomData.producers.set(producer.id, producer);
    
    console.log(`✅ Producer created: ${producer.id} (${kind}) for room ${roomId}`);
    
    res.json({
      id: producer.id,
    });
  } catch (error) {
    console.error('Error creating producer:', error);
    res.status(500).json({ error: 'Failed to create producer' });
  }
});

/**
 * POST /consumer/create
 * Tạo Consumer (nhận media)
 */
app.post('/consumer/create', async (req: Request, res: Response) => {
  try {
    const { roomId, transportId, producerId, rtpCapabilities } = req.body;
    
    if (!roomId || !transportId || !producerId || !rtpCapabilities) {
      return res.status(400).json({
        error: 'roomId, transportId, producerId, and rtpCapabilities are required',
      });
    }
    
    const roomData = rooms.get(roomId);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const transport = roomData.transports.get(transportId);
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    
    const producer = roomData.producers.get(producerId);
    if (!producer) {
      return res.status(404).json({ error: 'Producer not found' });
    }
    
    // Check if can consume
    if (!roomData.router.canConsume({ producerId, rtpCapabilities })) {
      return res.status(400).json({ error: 'Cannot consume this producer' });
    }
    
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused
    });
    
    roomData.consumers.set(consumer.id, consumer);
    
    console.log(`✅ Consumer created: ${consumer.id} for producer ${producerId}`);
    
    res.json({
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  } catch (error) {
    console.error('Error creating consumer:', error);
    res.status(500).json({ error: 'Failed to create consumer' });
  }
});

/**
 * POST /consumer/:consumerId/resume
 * Resume consumer
 */
app.post('/consumer/:consumerId/resume', async (req: Request, res: Response) => {
  try {
    const { consumerId } = req.params;
    const { roomId } = req.body;
    
    if (!roomId) {
      return res.status(400).json({ error: 'roomId is required' });
    }
    
    const roomData = rooms.get(roomId);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const consumer = roomData.consumers.get(consumerId);
    if (!consumer) {
      return res.status(404).json({ error: 'Consumer not found' });
    }
    
    await consumer.resume();
    
    console.log(`✅ Consumer resumed: ${consumerId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error resuming consumer:', error);
    res.status(500).json({ error: 'Failed to resume consumer' });
  }
});

/**
 * DELETE /room/:roomId
 * Xóa room và cleanup resources
 */
app.delete('/room/:roomId', async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    
    const roomData = rooms.get(roomId);
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Close all consumers
    for (const consumer of roomData.consumers.values()) {
      consumer.close();
    }
    
    // Close all producers
    for (const producer of roomData.producers.values()) {
      producer.close();
    }
    
    // Close all transports
    for (const transport of roomData.transports.values()) {
      transport.close();
    }
    
    // Close router
    roomData.router.close();
    
    // Remove room
    rooms.delete(roomId);
    
    console.log(`✅ Room deleted: ${roomId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

/**
 * GET /stats
 * Lấy statistics
 */
app.get('/stats', (req: Request, res: Response) => {
  const stats = {
    workers: workers.length,
    rooms: rooms.size,
    roomDetails: Array.from(rooms.entries()).map(([roomId, roomData]) => ({
      roomId,
      transports: roomData.transports.size,
      producers: roomData.producers.size,
      consumers: roomData.consumers.size,
    })),
  };
  
  res.json(stats);
});

// ==================== SERVER INITIALIZATION ====================

async function main() {
  try {
    console.log('🚀 Starting MediaSoup Service...');
    console.log('📋 Configuration:', config);
    
    // Initialize workers
    await initMediaSoupWorkers();
    
    // Start Express server
    app.listen(config.port, () => {
      console.log(`✅ MediaSoup Service listening on port ${config.port}`);
      console.log(`✅ RTC Ports: ${config.rtcMinPort}-${config.rtcMaxPort}`);
      console.log(`✅ Announced IP: ${config.announcedIp}`);
      console.log(`✅ Ready to handle requests`);
    });
  } catch (error) {
    console.error('❌ Failed to start MediaSoup Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  
  // Close all rooms
  for (const [roomId, roomData] of rooms.entries()) {
    roomData.router.close();
    console.log(`✅ Room ${roomId} closed`);
  }
  
  process.exit(0);
});

// Start server
main();
