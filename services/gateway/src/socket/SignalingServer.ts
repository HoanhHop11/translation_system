/**
 * SignalingServer - WebRTC Signaling với Socket.IO
 * 
 * Features:
 * - Low-latency WebRTC signaling
 * - Room-based broadcasting
 * - Producer/Consumer coordination
 * - Error handling với error codes
 * - Production-ready (NO MOCK/DEMO)
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { WorkerManager } from '../mediasoup/WorkerManager';
import { RoomManager } from '../mediasoup/RoomManager';
import { AudioProcessor } from '../mediasoup/AudioProcessor';
import { logger } from '../logger';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  ErrorResponse,
  ParticipantData,
} from '../types';

export class SignalingServer {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private workerManager: WorkerManager;
  private roomManager: RoomManager;
  private audioProcessor: AudioProcessor;
  
  // Track socket -> participant mapping
  private socketToParticipant: Map<string, { roomId: string; participantId: string }> = new Map();

  constructor(
    httpServer: HTTPServer,
    workerManager: WorkerManager,
    roomManager: RoomManager,
    audioProcessor: AudioProcessor
  ) {
    this.workerManager = workerManager;
    this.roomManager = roomManager;
    this.audioProcessor = audioProcessor;

    // Initialize Socket.IO với low-latency settings
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'], // Ưu tiên WebSocket
      pingTimeout: 20000,
      pingInterval: 10000,
      upgradeTimeout: 10000,
      maxHttpBufferSize: 1e6, // 1MB cho low-latency
    });

    this.setupEventHandlers();
    logger.info('✅ SignalingServer initialized');
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info('Client connected', { socketId: socket.id });

      // Send connection confirmation
      socket.emit('connected', { socketId: socket.id });

      // Room management events
      socket.on('create-room', (callback) => this.handleCreateRoom(socket, callback));
      socket.on('join-room', (data, callback) => this.handleJoinRoom(socket, data, callback));
      socket.on('leave-room', (callback) => this.handleLeaveRoom(socket, callback));

      // WebRTC transport events
      socket.on('get-router-rtp-capabilities', (callback) =>
        this.handleGetRouterRtpCapabilities(socket, callback)
      );
      socket.on('create-webrtc-transport', (data, callback) =>
        this.handleCreateWebRtcTransport(socket, data, callback)
      );
      socket.on('connect-webrtc-transport', (data, callback) =>
        this.handleConnectWebRtcTransport(socket, data, callback)
      );

      // Media streaming events
      socket.on('produce', (data, callback) => this.handleProduce(socket, data, callback));
      socket.on('consume', (data, callback) => this.handleConsume(socket, data, callback));
      socket.on('resume-consumer', (data, callback) => this.handleResumeConsumer(socket, data, callback));
      socket.on('pause-consumer', (data, callback) => this.handlePauseConsumer(socket, data, callback));
      socket.on('close-producer', (data, callback) => this.handleCloseProducer(socket, data, callback));

      // Disconnect handling
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  /**
   * Handle create room
   */
  private async handleCreateRoom(
    socket: Socket,
    callback: (response: { roomId?: string; error?: ErrorResponse }) => void
  ): Promise<void> {
    try {
      // Generate unique room ID
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Tạo router cho room
      const router = await this.workerManager.createRouter();

      // Tạo room
      await this.roomManager.createRoom(roomId, router);

      logger.info('Room created', { roomId, socketId: socket.id });

      callback({ roomId });
    } catch (error: any) {
      logger.error('Error creating room:', error);
      callback({
        error: {
          code: 'ERR_CREATE_ROOM',
          message: 'Không thể tạo room',
          details: error.message,
        },
      });
    }
  }

  /**
   * Handle join room
   */
  private async handleJoinRoom(
    socket: Socket,
    data: { roomId: string; name: string },
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const { roomId, name } = data;

      // Validate input
      if (!roomId || !name) {
        return callback({
          success: false,
          error: {
            code: 'ERR_INVALID_INPUT',
            message: 'roomId và name là bắt buộc',
          },
        });
      }

      // Check if room exists
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        return callback({
          success: false,
          error: {
            code: 'ERR_ROOM_NOT_FOUND',
            message: `Room ${roomId} không tồn tại`,
          },
        });
      }

      // Generate participant ID
      const participantId = `participant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Add participant to room
      await this.roomManager.addParticipant(roomId, participantId, socket.id, name);

      // Join Socket.IO room for broadcasting
      socket.join(roomId);

      // Track mapping
      this.socketToParticipant.set(socket.id, { roomId, participantId });

      // Get existing participants
      const participants: ParticipantData[] = [];
      for (const [pid, p] of room.participants.entries()) {
        if (pid !== participantId) {
          participants.push({
            id: p.id,
            name: p.name,
            joinedAt: p.joinedAt,
            producers: Array.from(p.producers.values()).map((producer) => ({
              id: producer.id,
              kind: producer.kind,
            })),
          });
        }
      }

      // Notify existing participants về new participant
      socket.to(roomId).emit('participant-joined', {
        id: participantId,
        name,
        joinedAt: Date.now(),
        producers: [],
      });

      logger.info('Participant joined room', {
        roomId,
        participantId,
        name,
        socketId: socket.id,
      });

      // Send success response
      callback({
        success: true,
        roomId,
        participantId,
        participants,
        rtpCapabilities: room.router.rtpCapabilities,
      });
    } catch (error: any) {
      logger.error('Error joining room:', error);
      callback({
        success: false,
        error: {
          code: 'ERR_JOIN_ROOM',
          message: 'Không thể join room',
          details: error.message,
        },
      });
    }
  }

  /**
   * Handle leave room
   */
  private async handleLeaveRoom(socket: Socket, callback: () => void): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        return callback();
      }

      const { roomId, participantId } = mapping;

      // Remove participant from room
      await this.roomManager.removeParticipant(roomId, participantId);

      // Leave Socket.IO room
      socket.leave(roomId);

      // Remove mapping
      this.socketToParticipant.delete(socket.id);

      // Notify other participants
      socket.to(roomId).emit('participant-left', { participantId });

      logger.info('Participant left room', { roomId, participantId, socketId: socket.id });

      callback();
    } catch (error) {
      logger.error('Error leaving room:', error);
      callback();
    }
  }

  /**
   * Handle get router RTP capabilities
   */
  private async handleGetRouterRtpCapabilities(
    socket: Socket,
    callback: (capabilities: any) => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const room = this.roomManager.getRoom(mapping.roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      callback(room.router.rtpCapabilities);
    } catch (error: any) {
      logger.error('Error getting RTP capabilities:', error);
      socket.emit('error', {
        code: 'ERR_GET_RTP_CAPABILITIES',
        message: error.message,
      });
    }
  }

  /**
   * Handle create WebRTC transport
   */
  private async handleCreateWebRtcTransport(
    socket: Socket,
    data: { producing: boolean; consuming: boolean },
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;
      const direction = data.producing ? 'send' : 'recv';

      // Create transport
      const transport = await this.roomManager.createWebRtcTransport(roomId, participantId, direction);

      logger.info('WebRTC transport created', {
        transportId: transport.id,
        direction,
        participantId,
      });

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (error: any) {
      logger.error('Error creating WebRTC transport:', error);
      callback({
        error: {
          code: 'ERR_CREATE_TRANSPORT',
          message: 'Không thể tạo transport',
          details: error.message,
        },
      });
    }
  }

  /**
   * Handle connect WebRTC transport
   */
  private async handleConnectWebRtcTransport(
    socket: Socket,
    data: { transportId: string; dtlsParameters: any },
    callback: (response: { error?: string }) => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      const participant = room.participants.get(participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      // Find transport
      const transport =
        participant.sendTransport?.id === data.transportId
          ? participant.sendTransport
          : participant.recvTransport?.id === data.transportId
          ? participant.recvTransport
          : null;

      if (!transport) {
        throw new Error('Transport not found');
      }

      // Connect transport
      await transport.connect({ dtlsParameters: data.dtlsParameters });

      logger.info('Transport connected', {
        transportId: data.transportId,
        participantId,
      });

      callback({});
    } catch (error: any) {
      logger.error('Error connecting transport:', error);
      callback({ error: error.message });
    }
  }

  /**
   * Handle produce (audio/video streaming)
   */
  private async handleProduce(
    socket: Socket,
    data: { transportId: string; kind: 'audio' | 'video'; rtpParameters: any },
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;

      // Create producer
      const producer = await this.roomManager.createProducer(
        roomId,
        participantId,
        data.transportId,
        data.kind,
        data.rtpParameters
      );

      // Start audio streaming to STT nếu là audio producer
      if (data.kind === 'audio') {
        await this.audioProcessor.startStreaming(roomId, participantId, producer);
      }

      // Notify other participants về new producer (để họ consume)
      socket.to(roomId).emit('new-producer', {
        producerId: producer.id,
        participantId,
        kind: data.kind,
      });

      logger.info('Producer created', {
        producerId: producer.id,
        kind: data.kind,
        participantId,
      });

      callback({ producerId: producer.id });
    } catch (error: any) {
      logger.error('Error creating producer:', error);
      callback({
        error: {
          code: 'ERR_CREATE_PRODUCER',
          message: 'Không thể tạo producer',
          details: error.message,
        },
      });
    }
  }

  /**
   * Handle consume (consume stream từ producer khác)
   */
  private async handleConsume(
    socket: Socket,
    data: { producerId: string; rtpCapabilities: any },
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;

      // Create consumer
      const consumer = await this.roomManager.createConsumer(
        roomId,
        participantId,
        data.producerId,
        data.rtpCapabilities
      );

      logger.info('Consumer created', {
        consumerId: consumer.id,
        producerId: data.producerId,
        participantId,
      });

      callback({
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error: any) {
      logger.error('Error creating consumer:', error);
      callback({
        error: {
          code: 'ERR_CREATE_CONSUMER',
          message: 'Không thể tạo consumer',
          details: error.message,
        },
      });
    }
  }

  /**
   * Handle resume consumer
   */
  private async handleResumeConsumer(
    socket: Socket,
    data: { consumerId: string },
    callback: () => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      const participant = room.participants.get(participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      const consumer = participant.consumers.get(data.consumerId);
      if (!consumer) {
        throw new Error('Consumer not found');
      }

      await consumer.resume();

      logger.debug('Consumer resumed', { consumerId: data.consumerId, participantId });

      callback();
    } catch (error) {
      logger.error('Error resuming consumer:', error);
      callback();
    }
  }

  /**
   * Handle pause consumer
   */
  private async handlePauseConsumer(
    socket: Socket,
    data: { consumerId: string },
    callback: () => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      const participant = room.participants.get(participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      const consumer = participant.consumers.get(data.consumerId);
      if (!consumer) {
        throw new Error('Consumer not found');
      }

      await consumer.pause();

      logger.debug('Consumer paused', { consumerId: data.consumerId, participantId });

      callback();
    } catch (error) {
      logger.error('Error pausing consumer:', error);
      callback();
    }
  }

  /**
   * Handle close producer
   */
  private async handleCloseProducer(
    socket: Socket,
    data: { producerId: string },
    callback: () => void
  ): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        throw new Error('Participant not in room');
      }

      const { roomId, participantId } = mapping;
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      const participant = room.participants.get(participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      const producer = participant.producers.get(data.producerId);
      if (!producer) {
        throw new Error('Producer not found');
      }

      // Stop audio streaming nếu là audio producer
      if (producer.kind === 'audio') {
        await this.audioProcessor.stopStreaming(participantId);
      }

      producer.close();
      participant.producers.delete(data.producerId);

      // Notify other participants
      socket.to(roomId).emit('producer-closed', { producerId: data.producerId });

      logger.info('Producer closed', { producerId: data.producerId, participantId });

      callback();
    } catch (error) {
      logger.error('Error closing producer:', error);
      callback();
    }
  }

  /**
   * Handle disconnect
   */
  private async handleDisconnect(socket: Socket): Promise<void> {
    logger.info('Client disconnected', { socketId: socket.id });

    const mapping = this.socketToParticipant.get(socket.id);
    if (mapping) {
      await this.handleLeaveRoom(socket, () => {});
    }
  }

  /**
   * Broadcast transcription to room (gọi từ AudioProcessor)
   */
  broadcastTranscription(roomId: string, data: any): void {
    this.io.to(roomId).emit('transcription', data);
  }

  /**
   * Broadcast translation to room
   */
  broadcastTranslation(roomId: string, data: any): void {
    this.io.to(roomId).emit('translation', data);
  }

  /**
   * Get Socket.IO server instance
   */
  getIO(): SocketIOServer {
    return this.io;
  }
}
