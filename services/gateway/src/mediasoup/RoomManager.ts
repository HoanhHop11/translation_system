/**
 * RoomManager - Quản lý Streaming Rooms với Redis pub/sub
 * 
 * Features:
 * - Room state management
 * - Participant tracking
 * - Multi-node coordination với Redis
 * - Producer/Consumer lifecycle
 * - Streaming events broadcasting
 */

import { Router, WebRtcTransport, Producer, Consumer, RtpCapabilities } from 'mediasoup/node/lib/types';
import { Room, Participant } from '../types';
import { logger } from '../logger';
import { config } from '../config';
import { createClient, RedisClientType } from 'redis';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private redisClient?: RedisClientType;
  private redisPub?: RedisClientType;
  private redisSub?: RedisClientType;

  /**
   * Initialize Redis cho multi-node streaming coordination
   */
  async initialize(): Promise<void> {
    try {
      logger.info('🔌 Connecting to Redis for streaming coordination...');

      // Redis client cho room state
      this.redisClient = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
        password: config.redis.password,
      });

      // Redis pub/sub cho streaming events
      this.redisPub = this.redisClient.duplicate();
      this.redisSub = this.redisClient.duplicate();

      await Promise.all([
        this.redisClient.connect(),
        this.redisPub.connect(),
        this.redisSub.connect(),
      ]);

      // Subscribe to streaming events từ other nodes
      await this.redisSub.subscribe('gateway:events', (message) => {
        this.handleRedisEvent(message);
      });

      logger.info('✅ Redis connected for streaming coordination');
    } catch (error) {
      logger.warn('Redis connection failed, running in standalone mode:', error);
      // Graceful degradation: continue without Redis
    }
  }

  /**
   * Handle streaming events từ Redis (multi-node coordination)
   */
  private handleRedisEvent(message: string): void {
    try {
      const event = JSON.parse(message);
      logger.debug('Received Redis streaming event:', event);
      // Handle cross-node events (e.g., room closed on another node)
    } catch (error) {
      logger.error('Error handling Redis event:', error);
    }
  }

  /**
   * Tạo room mới cho video streaming
   */
  async createRoom(roomId: string, router: Router): Promise<Room> {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`);
    }

    const room: Room = {
      id: roomId,
      createdAt: Date.now(),
      participants: new Map(),
      router,
    };

    this.rooms.set(roomId, room);

    // Publish room created event
    await this.publishEvent({
      type: 'room-created',
      roomId,
      timestamp: Date.now(),
    });

    logger.info('Streaming room created', { roomId });
    return room;
  }

  /**
   * Lấy room
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Thêm participant vào streaming room
   */
  async addParticipant(
    roomId: string,
    participantId: string,
    socketId: string,
    name: string
  ): Promise<Participant> {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.participants.has(participantId)) {
      throw new Error(`Participant ${participantId} already in room`);
    }

    const participant: Participant = {
      id: participantId,
      socketId,
      name,
      joinedAt: Date.now(),
      producers: new Map(),
      consumers: new Map(),
      isAudioStreaming: false,
    };

    room.participants.set(participantId, participant);

    // Publish participant joined event cho streaming coordination
    await this.publishEvent({
      type: 'participant-joined',
      roomId,
      participantId,
      name,
      timestamp: Date.now(),
    });

    logger.info('Participant joined streaming room', {
      roomId,
      participantId,
      participantCount: room.participants.size,
    });

    return participant;
  }

  /**
   * Xóa participant khỏi streaming room
   */
  async removeParticipant(roomId: string, participantId: string): Promise<void> {
    const room = this.getRoom(roomId);
    if (!room) {
      return;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return;
    }

    // CRITICAL: Cleanup cascade (theo MediaSoup best practices)
    
    // Close all consumers first
    for (const consumer of participant.consumers.values()) {
      try {
        consumer.close();
      } catch (error) {
        logger.error('Error closing consumer:', { consumerId: consumer.id, error });
      }
    }
    participant.consumers.clear();

    // Close all producers
    for (const producer of participant.producers.values()) {
      try {
        producer.close();
      } catch (error) {
        logger.error('Error closing producer:', { producerId: producer.id, error });
      }
    }
    participant.producers.clear();

    // Close transports
    if (participant.sendTransport) {
      try {
        participant.sendTransport.close();
      } catch (error) {
        logger.error('Error closing send transport:', error);
      }
    }

    if (participant.recvTransport) {
      try {
        participant.recvTransport.close();
      } catch (error) {
        logger.error('Error closing recv transport:', error);
      }
    }

    // Remove participant
    room.participants.delete(participantId);

    // Publish participant left event
    await this.publishEvent({
      type: 'participant-left',
      roomId,
      participantId,
      timestamp: Date.now(),
    });

    logger.info('Participant left streaming room', {
      roomId,
      participantId,
      remainingParticipants: room.participants.size,
    });

    // Close room nếu empty
    if (room.participants.size === 0) {
      await this.closeRoom(roomId);
    }
  }

  /**
   * Tạo WebRTC Transport cho streaming (send hoặc receive)
   */
  async createWebRtcTransport(
    roomId: string,
    participantId: string,
    direction: 'send' | 'recv'
  ): Promise<WebRtcTransport> {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found`);
    }

    try {
      // Tạo transport với streaming-optimized settings
      const transport = await room.router.createWebRtcTransport({
        listenInfos: config.mediasoup.webRtcTransport.listenInfos,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true, // UDP tốt hơn cho streaming
        initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate,
      });

      // CRITICAL: Transport lifecycle events (theo MediaSoup best practices)
      transport.on('routerclose', () => {
        logger.warn('Transport closed due to router closure', {
          transportId: transport.id,
          participantId,
        });
      });

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'failed' || dtlsState === 'closed') {
          logger.error('Transport DTLS state failed/closed', {
            transportId: transport.id,
            participantId,
            dtlsState,
          });
          transport.close();
        }
      });

      // Store transport
      if (direction === 'send') {
        participant.sendTransport = transport;
      } else {
        participant.recvTransport = transport;
      }

      logger.info('WebRTC transport created for streaming', {
        transportId: transport.id,
        direction,
        participantId,
      });

      return transport;
    } catch (error) {
      logger.error('Error creating WebRTC transport:', error);
      throw error;
    }
  }

  /**
   * Tạo Producer cho audio/video streaming
   */
  async createProducer(
    roomId: string,
    participantId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: any
  ): Promise<Producer> {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(participantId);
    if (!participant || !participant.sendTransport) {
      throw new Error('Participant or send transport not found');
    }

    try {
      const producer = await participant.sendTransport.produce({
        kind,
        rtpParameters,
      });

      // CRITICAL: Producer lifecycle events
      producer.on('transportclose', () => {
        logger.warn('Producer closed due to transport closure', {
          producerId: producer.id,
          participantId,
        });
        participant.producers.delete(producer.id);
      });

      // Store producer
      participant.producers.set(producer.id, producer);

      // Track audio streaming cho STT
      if (kind === 'audio') {
        participant.audioProducer = producer;
        participant.isAudioStreaming = true;
      }

      // Publish new producer event cho other participants để consume
      await this.publishEvent({
        type: 'new-producer',
        roomId,
        participantId,
        producerId: producer.id,
        kind,
        timestamp: Date.now(),
      });

      logger.info('Producer created for streaming', {
        producerId: producer.id,
        kind,
        participantId,
      });

      return producer;
    } catch (error) {
      logger.error('Error creating producer:', error);
      throw error;
    }
  }

  /**
   * Tạo Consumer để consume streaming từ Producer
   */
  async createConsumer(
    roomId: string,
    participantId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities
  ): Promise<Consumer> {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(participantId);
    if (!participant || !participant.recvTransport) {
      throw new Error('Participant or recv transport not found');
    }

    // Kiểm tra xem router có thể consume không
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume producer with given RTP capabilities');
    }

    try {
      const consumer = await participant.recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true, // Start paused, resume sau khi client ready
      });

      // CRITICAL: Consumer lifecycle events
      consumer.on('transportclose', () => {
        logger.warn('Consumer closed due to transport closure', {
          consumerId: consumer.id,
          participantId,
        });
        participant.consumers.delete(consumer.id);
      });

      consumer.on('producerclose', () => {
        logger.warn('Consumer closed due to producer closure', {
          consumerId: consumer.id,
          participantId,
        });
        participant.consumers.delete(consumer.id);
      });

      // Store consumer
      participant.consumers.set(consumer.id, consumer);

      logger.info('Consumer created for streaming', {
        consumerId: consumer.id,
        producerId,
        participantId,
      });

      return consumer;
    } catch (error) {
      logger.error('Error creating consumer:', error);
      throw error;
    }
  }

  /**
   * Close streaming room
   */
  async closeRoom(roomId: string): Promise<void> {
    const room = this.getRoom(roomId);
    if (!room) {
      return;
    }

    // Remove all participants
    const participantIds = Array.from(room.participants.keys());
    for (const participantId of participantIds) {
      await this.removeParticipant(roomId, participantId);
    }

    // Close router
    try {
      room.router.close();
    } catch (error) {
      logger.error('Error closing router:', error);
    }

    // Remove room
    this.rooms.delete(roomId);

    // Publish room closed event
    await this.publishEvent({
      type: 'room-closed',
      roomId,
      timestamp: Date.now(),
    });

    logger.info('Streaming room closed', { roomId });
  }

  /**
   * Publish event to Redis cho multi-node coordination
   */
  private async publishEvent(event: any): Promise<void> {
    if (!this.redisPub) {
      return;
    }

    try {
      await this.redisPub.publish('gateway:events', JSON.stringify(event));
    } catch (error) {
      logger.error('Error publishing Redis event:', error);
    }
  }

  /**
   * Lấy room statistics cho monitoring
   */
  getStats(): any {
    const stats: any[] = [];

    for (const room of this.rooms.values()) {
      stats.push({
        roomId: room.id,
        participantCount: room.participants.size,
        createdAt: room.createdAt,
        uptime: Date.now() - room.createdAt,
      });
    }

    return {
      totalRooms: this.rooms.size,
      rooms: stats,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down RoomManager...');

    // Close all rooms
    const roomIds = Array.from(this.rooms.keys());
    for (const roomId of roomIds) {
      await this.closeRoom(roomId);
    }

    // Disconnect Redis
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    if (this.redisPub) {
      await this.redisPub.quit();
    }
    if (this.redisSub) {
      await this.redisSub.quit();
    }

    logger.info('✅ RoomManager shutdown complete');
  }
}
