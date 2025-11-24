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
import { Buffer } from 'buffer';
import axios from 'axios';
import { config } from '../config';
import { WorkerManager } from '../mediasoup/WorkerManager';
import { RoomManager } from '../mediasoup/RoomManager';
import { AudioProcessor } from '../mediasoup/AudioProcessor';
import { logger } from '../logger';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  ErrorResponse,
  ParticipantData,
  TranscriptionData,
  CaptionStatus,
  GatewayCaption,
} from '../types';

export class SignalingServer {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private workerManager: WorkerManager;
  private roomManager: RoomManager;
  private audioProcessor: AudioProcessor;
  private captionSeq: Map<string, Map<string, number>> = new Map();
  
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

    // Listen for transcription events
    this.audioProcessor.on('transcription', (data) => this.handleGatewayCaption(data));
    this.audioProcessor.on('caption-error', (data) => this.handleGatewayCaptionError(data));

    // Initialize Socket.IO với low-latency settings
    const corsOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : '*';
    
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigins,
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
      socket.on('create-room', (callback) => {
        logger.info('Received create-room event', { socketId: socket.id, hasCallback: typeof callback === 'function' });
        this.handleCreateRoom(socket, callback);
      });
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

      // Chat events
      socket.on('chat-message', (data) => this.handleChatMessage(socket, data));

      // Screen share events
      socket.on('screen-share-started', (data) => this.handleScreenShareStarted(socket, data));
      socket.on('screen-share-stopped', (data) => this.handleScreenShareStopped(socket, data));

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
    data: { 
      roomId: string; 
      name: string; 
      userid?: string;
      token?: string;
      sourceLanguage?: string; 
      targetLanguage?: string;
    },
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const { roomId, name, userid, token, sourceLanguage, targetLanguage } = data;

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

      // TODO: Verify external JWT token nếu cần
      // if (token) {
      //   const isValid = await verifyExternalToken(token);
      //   if (!isValid) {
      //     return callback({
      //       success: false,
      //       error: { code: 'ERR_UNAUTHORIZED', message: 'Invalid token' }
      //     });
      //   }
      // }

      // Decode room ID nếu là Base64 (cho external integration)
      let actualRoomId = roomId;
      try {
        // Thử decode Base64 (nếu room ID đã được encode từ external system)
        const decoded = Buffer.from(roomId, 'base64').toString('utf-8');
        // Check nếu decode thành công và có format hợp lệ
        if (decoded && decoded.length > 0 && decoded.includes('_')) {
          actualRoomId = decoded;
          logger.info('Room ID đã được decode từ Base64', { 
            encoded: roomId, 
            decoded: actualRoomId 
          });
        }
      } catch (e) {
        // Nếu không phải Base64, giữ nguyên roomId
        actualRoomId = roomId;
      }
      
      // Check if room exists, nếu không tồn tại thì tự động tạo (cho external integration)
      let room = this.roomManager.getRoom(actualRoomId);
      if (!room) {
        logger.info('Room không tồn tại, tự động tạo mới', { roomId: actualRoomId });
        
        // Tạo router cho room mới
        const router = await this.workerManager.createRouter();
        await this.roomManager.createRoom(actualRoomId, router);
        room = this.roomManager.getRoom(actualRoomId);
        
        if (!room) {
          return callback({
            success: false,
            error: {
              code: 'ERR_CREATE_ROOM',
              message: 'Không thể tạo room tự động',
            },
          });
        }
      }

      // Generate participant ID
      const participantId = `participant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Add participant to room (với userid từ external system)
      await this.roomManager.addParticipant(actualRoomId, participantId, socket.id, name, sourceLanguage, targetLanguage);
      
      // Lưu userid vào participant metadata (nếu có)
      if (userid && room) {
        const participant = room.participants.get(participantId);
        if (participant) {
          (participant as any).userid = userid; // External user ID
        }
      }

      // Join Socket.IO room for broadcasting
      socket.join(actualRoomId);

      // Track mapping
      this.socketToParticipant.set(socket.id, { roomId: actualRoomId, participantId });

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
      socket.to(actualRoomId).emit('participant-joined', {
        id: participantId,
        name,
        joinedAt: Date.now(),
        producers: [],
      });

      logger.info('Participant joined room', {
        roomId: actualRoomId,
        originalRoomId: roomId,
        participantId,
        name,
        userid,
        socketId: socket.id,
      });

      // Send success response
      callback({
        success: true,
        roomId: actualRoomId,
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
  private async handleLeaveRoom(socket: Socket, callback?: () => void): Promise<void> {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        if (callback && typeof callback === 'function') callback();
        return;
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

      if (callback && typeof callback === 'function') callback();
    } catch (error) {
      logger.error('Error leaving room:', error);
      if (callback && typeof callback === 'function') callback();
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

      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('Room not found for producer');
      }

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
        await this.audioProcessor.startStreaming(roomId, participantId, producer, room.router);
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
   * Handle chat message
   */
  private handleChatMessage(
    socket: Socket,
    data: { sender: string; text: string; timestamp?: number }
  ): void {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        logger.warn('Chat message from participant not in room', { socketId: socket.id });
        return;
      }

      const { roomId } = mapping;

      // Broadcast to all participants in room (including sender)
      this.io.to(roomId).emit('chat-message', {
        sender: data.sender,
        text: data.text,
        timestamp: data.timestamp || Date.now(),
        roomId,
      });

      logger.debug('Chat message broadcast', {
        roomId,
        sender: data.sender,
        socketId: socket.id,
      });
    } catch (error) {
      logger.error('Error handling chat message:', error);
    }
  }

  /**
   * Handle screen share started
   */
  private handleScreenShareStarted(socket: Socket, data: { roomId: string }): void {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        return;
      }

      const { roomId, participantId } = mapping;

      // Notify other participants
      socket.to(roomId).emit('screen-share-started', {
        participantId,
        roomId: data.roomId,
      });

      logger.info('Screen share started', { roomId, participantId });
    } catch (error) {
      logger.error('Error handling screen share started:', error);
    }
  }

  /**
   * Handle screen share stopped
   */
  private handleScreenShareStopped(socket: Socket, data: { roomId: string }): void {
    try {
      const mapping = this.socketToParticipant.get(socket.id);
      if (!mapping) {
        return;
      }

      const { roomId, participantId } = mapping;

      // Notify other participants
      socket.to(roomId).emit('screen-share-stopped', {
        participantId,
        roomId: data.roomId,
      });

      logger.info('Screen share stopped', { roomId, participantId });
    } catch (error) {
      logger.error('Error handling screen share stopped:', error);
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
   * Handle transcription event from AudioProcessor -> emit gateway-caption (and legacy transcription)
   */
  async handleGatewayCaption(data: TranscriptionData): Promise<void> {
    try {
      const { roomId, participantId, text, language, isFinal } = data;
      if (!roomId) {
        // Fallback: try mapping by participantId
        const mapping = Array.from(this.socketToParticipant.values()).find((m) => m.participantId === participantId);
        if (mapping) {
          data.roomId = mapping.roomId;
        }
      }
      const effectiveRoomId = data.roomId;
      if (!effectiveRoomId) {
        logger.warn('No roomId for transcription, skipping caption emit', { participantId });
        return;
      }

      // Sequence per (room, participant)
      const seq = this.nextCaptionSeq(effectiveRoomId, participantId);

      const caption: GatewayCaption = {
        roomId: effectiveRoomId,
        speakerId: participantId,
        seq,
        text: text || '',
        language,
        isFinal: !!isFinal,
        timestamp: data.timestamp || Date.now(),
      };
      
      // Emit new caption event
      this.broadcastGatewayCaption(effectiveRoomId, caption);

      // Emit legacy transcription for backward compatibility
      this.broadcastTranscription(effectiveRoomId, {
        participantId,
        text: text || '',
        language,
        isFinal: !!isFinal,
        timestamp: caption.timestamp,
        confidence: data.confidence ?? 0,
        roomId: effectiveRoomId,
      });

      // Only translate final results to save resources
      if (isFinal && text.trim().length > 0) {
        const room = this.roomManager.getRoom(effectiveRoomId);
        if (!room) return;

        const speaker = room.participants.get(participantId);
        const sourceLang = language || speaker?.sourceLanguage || 'vi'; // Default to Vietnamese if unknown

        // Group participants by target language to batch translation requests
        const targetLanguages = new Set<string>();
        
        for (const [pid, p] of room.participants.entries()) {
          if (pid === participantId) continue; // Skip speaker
          
          // If participant has a target language and it's different from source
          if (p.targetLanguage && p.targetLanguage !== sourceLang) {
            targetLanguages.add(p.targetLanguage);
          }
        }

        // Call translation service for each target language
        for (const targetLang of targetLanguages) {
          try {
            const response = await axios.post(`${config.translation.url}/translate`, {
              text,
              source_lang: sourceLang,
              target_lang: targetLang
            });

            const translatedText = response.data.translated_text;

            // Broadcast translation to participants who need it
            // We can broadcast to the whole room with targetLang info, 
            // and clients filter what they show.
            this.broadcastTranslation(effectiveRoomId, {
              participantId, // Original speaker
              originalText: text,
              translatedText,
              sourceLanguage: sourceLang,
              targetLanguage: targetLang,
              isFinal: true,
              timestamp: Date.now()
            });
            
          } catch (err) {
            logger.error(`Translation error (${sourceLang} -> ${targetLang}):`, err);
          }
        }
      }
    } catch (error) {
      logger.error('Error handling gateway caption:', error);
    }
  }

  /**
   * Handle caption errors from AudioProcessor (emit status)
   */
  handleGatewayCaptionError(data: { participantId: string; roomId?: string; error?: string }): void {
    const { participantId, error } = data;
    let roomId = data.roomId;
    if (!roomId) {
      const mapping = Array.from(this.socketToParticipant.values()).find((m) => m.participantId === participantId);
      roomId = mapping?.roomId;
    }
    if (!roomId) {
      logger.warn('Caption error without roomId', { participantId, error });
      return;
    }

    const status: CaptionStatus = {
      roomId,
      status: 'asr_unavailable',
      error,
      timestamp: Date.now(),
    };
    this.broadcastCaptionStatus(roomId, status);
  }

  private nextCaptionSeq(roomId: string, participantId: string): number {
    if (!this.captionSeq.has(roomId)) {
      this.captionSeq.set(roomId, new Map());
    }
    const roomMap = this.captionSeq.get(roomId)!;
    const current = roomMap.get(participantId) ?? 0;
    const next = current + 1;
    roomMap.set(participantId, next);
    return next;
  }

  private broadcastGatewayCaption(roomId: string, caption: GatewayCaption): void {
    this.io.to(roomId).emit('gateway-caption', caption);
  }

  private broadcastCaptionStatus(roomId: string, status: CaptionStatus): void {
    this.io.to(roomId).emit('caption-status', status);
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
