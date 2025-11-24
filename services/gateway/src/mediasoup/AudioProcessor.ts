/**
 * AudioProcessor - Xử lý Audio Streaming cho STT
 * 
 * Features:
 * - Audio tap từ MediaSoup Producer (KHÔNG CẦN USER BẤM NÚT)
 * - Convert RTP audio → PCM buffer
 * - Streaming to STT service với <200ms latency
 * - Buffering optimization cho real-time processing
 * - Production-ready (NO MOCK/DEMO)
 */

import { Producer, Router, PlainTransport, Consumer } from 'mediasoup/node/lib/types';
import { logger } from '../logger';
import { AudioStreamBuffer } from '../types';
import axios from 'axios';
import { EventEmitter } from 'events';
import { SileroVADProcessor } from '../utils/SileroVAD';
import * as dgram from 'dgram';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - opusscript does not ship typings
import OpusScript from 'opusscript';

export class AudioProcessor extends EventEmitter {
  private activeStreams: Map<string, AudioStreamBuffer> = new Map();
  private sttServiceUrl: string;
  private processingInterval: NodeJS.Timeout | null = null;
  private vadProcessor: SileroVADProcessor;

  // Audio buffer settings cho low-latency
  private readonly BUFFER_SIZE_MS = 100; // 100ms chunks cho real-time
  private readonly INPUT_SAMPLE_RATE = 48000; // MediaSoup default Opus sample rate
  private readonly OUTPUT_SAMPLE_RATE = 16000; // Target for STT
  private readonly CHANNELS = 1; // Mono cho STT
  private readonly BYTES_PER_SAMPLE = 2; // 16-bit PCM
  private readonly BUFFER_SIZE_BYTES = (this.OUTPUT_SAMPLE_RATE * this.BUFFER_SIZE_MS) / 1000 * this.CHANNELS * this.BYTES_PER_SAMPLE;

  constructor() {
    super();
    this.sttServiceUrl = process.env.STT_SERVICE_URL || 'http://stt:8002';
    this.vadProcessor = new SileroVADProcessor();

    // Initialize VAD
    this.initializeVAD();

    logger.info('✅ AudioProcessor initialized', {
      sttServiceUrl: this.sttServiceUrl,
      bufferSizeMs: this.BUFFER_SIZE_MS,
      sampleRate: this.OUTPUT_SAMPLE_RATE,
    });

    // Start background processing loop
    this.startProcessingLoop();
  }

  /**
   * Initialize VAD processor
   */
  private async initializeVAD(): Promise<void> {
    try {
      await this.vadProcessor.initialize();
      logger.info('✅ VAD processor initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize VAD, will process all audio:', error);
    }
  }

  /**
   * Start streaming audio từ producer (TỰ ĐỘNG, KHÔNG CẦN USER BẤM NÚT)
   */
  async startStreaming(roomId: string, participantId: string, producer: Producer, router: Router): Promise<void> {
    try {
      if (producer.kind !== 'audio') {
        logger.warn('Producer is not audio, skipping streaming', { producerId: producer.id });
        return;
      }

      logger.info('🎤 Starting audio streaming to STT', {
        roomId,
        participantId,
        producerId: producer.id,
      });

      // Tạo UDP socket local để nhận RTP từ PlainTransport
      const udpSocket = dgram.createSocket('udp4');
      await new Promise<void>((resolve) => udpSocket.bind(0, '127.0.0.1', () => resolve()));
      const udpInfo = udpSocket.address();
      const rtpPort = typeof udpInfo === 'object' ? udpInfo.port : undefined;

      // PlainTransport để forward RTP từ Producer tới UDP socket (localhost)
      const plainTransport: PlainTransport = await router.createPlainTransport({
        listenIp: '127.0.0.1',
        rtcpMux: true,
        comedia: false,
      });

      // Consume producer trên PlainTransport để forward RTP
      const consumer: Consumer = await plainTransport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
      });

      await plainTransport.connect({
        ip: '127.0.0.1',
        port: rtpPort,
      });

      // Resume consumer để bắt đầu gửi RTP
      await consumer.resume();

      // Khởi tạo decoder Opus 48k → PCM16
      const decoder = new OpusScript(this.INPUT_SAMPLE_RATE, this.CHANNELS, OpusScript.Application.AUDIO);

      // Initialize buffer cho participant này
      const streamBuffer: AudioStreamBuffer = {
        roomId,
        participantId,
        producerId: producer.id,
        buffer: [],
        sampleRate: this.OUTPUT_SAMPLE_RATE,
        channels: this.CHANNELS,
        lastProcessedAt: Date.now(),
        transport: plainTransport,
        consumer,
        decoder,
        udpPort: rtpPort,
      };

      // Lưu UDP socket ngoài type chuẩn
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (streamBuffer as any).udpSocket = udpSocket;

      this.activeStreams.set(participantId, streamBuffer);

      // Lắng nghe RTP từ UDP socket
      udpSocket.on('message', (packet: Buffer) => {
        this.handleRtpPacket(participantId, packet);
      });

      udpSocket.on('error', (err) => {
        logger.error('UDP socket error for participant', { participantId, err });
      });

      // Notify STT service về stream mới
      await this.notifySTTStreamStart(roomId, participantId);

      logger.info('✅ Audio streaming started', { participantId });
    } catch (error) {
      logger.error('Error starting audio streaming:', error);
      throw error;
    }
  }

  /**
   * Handle RTP packet từ MediaSoup (tự động được gọi)
   */
  private handleRtpPacket(participantId: string, rtpPacket: Buffer): void {
    const streamBuffer = this.activeStreams.get(participantId);
    if (!streamBuffer) {
      return;
    }

    try {
      // Extract audio payload từ RTP packet
      const audioPayload = this.extractPayload(rtpPacket);

      if (!audioPayload || audioPayload.length === 0) {
        return;
      }

      const pcm16 = this.decodeOpusToPcm16(audioPayload, streamBuffer.decoder);
      if (!pcm16 || pcm16.length === 0) {
        return;
      }

      // Downsample 48k → 16k (STT yêu cầu 16kHz)
      const downsampled = this.downsampleTo16k(pcm16);
      if (downsampled.length === 0) {
        return;
      }

      streamBuffer.buffer.push(Buffer.from(downsampled.buffer));

      // Update timestamp
      streamBuffer.lastProcessedAt = Date.now();
    } catch (error) {
      logger.error('Error handling RTP packet:', { participantId, error });
    }
  }

  /**
   * Background processing loop - Gửi audio chunks đến STT service
   */
  private startProcessingLoop(): void {
    // Process mỗi 100ms cho low-latency
    this.processingInterval = setInterval(() => {
      this.processAudioBuffers();
    }, this.BUFFER_SIZE_MS);
  }

  /**
   * Parse RTP packet to extract Opus payload
   */
  private extractPayload(rtpPacket: Buffer): Buffer | null {
    if (rtpPacket.length < 12) {
      return null;
    }

    const csrcCount = rtpPacket[0] & 0x0f;
    const extension = (rtpPacket[0] & 0x10) > 0;
    let offset = 12 + csrcCount * 4;

    if (extension) {
      if (rtpPacket.length < offset + 4) {
        return null;
      }
      const extensionLength = rtpPacket.readUInt16BE(offset + 2);
      offset += 4 + extensionLength * 4;
    }

    if (offset >= rtpPacket.length) {
      return null;
    }

    return rtpPacket.subarray(offset);
  }

  /**
   * Decode Opus payload to PCM16 48k mono
   */
  private decodeOpusToPcm16(payload: Buffer, decoder: any): Int16Array | null {
    try {
      const decoded = decoder.decode(payload);
      return this.toInt16Array(decoded);
    } catch (error) {
      logger.error('Opus decode error', error);
      return null;
    }
  }

  private toInt16Array(decoded: any): Int16Array {
    if (decoded instanceof Int16Array) {
      return decoded;
    }
    if (decoded instanceof Float32Array) {
      const out = new Int16Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        let sample = Math.max(-1, Math.min(1, decoded[i]));
        out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return out;
    }
    if (Buffer.isBuffer(decoded) || decoded instanceof Uint8Array) {
      return new Int16Array(
        decoded.buffer,
        decoded.byteOffset,
        Math.floor(decoded.byteLength / 2)
      );
    }
    // Fallback empty
    return new Int16Array(0);
  }

  /**
   * Downsample 48k → 16k by simple decimation (factor 3)
   */
  private downsampleTo16k(input: Int16Array): Int16Array {
    if (input.length === 0) {
      return input;
    }
    const factor = 3;
    const outLen = Math.floor(input.length / factor);
    const out = new Int16Array(outLen);
    for (let i = 0, j = 0; j < outLen; i += factor, j++) {
      out[j] = input[i];
    }
    return out;
  }

  /**
   * Process tất cả audio buffers với VAD-based utterance detection
   */
  private async processAudioBuffers(): Promise<void> {
    for (const [participantId, streamBuffer] of this.activeStreams.entries()) {
      try {
        // Check nếu có đủ data để process
        if (streamBuffer.buffer.length === 0) {
          continue;
        }

        // Concatenate buffers
        const audioData = Buffer.concat(streamBuffer.buffer);
        streamBuffer.buffer = [];

        // Skip nếu buffer quá nhỏ (tránh overhead)
        if (audioData.length < 160) { // ~10ms @ 16kHz
          continue;
        }

        // ⚠️ PRODUCTION TODO: Decode Opus → PCM16
        // Tạm thời assume audio data đã là PCM (hoặc STT service handle Opus)
        const pcmData = audioData; // TODO: Implement Opus decoder

        // ✅ VAD-based utterance detection
        const vadResult = await this.vadProcessor.processChunk(pcmData);

        if (vadResult.hasUtterance && vadResult.utteranceAudio) {
          // ✅ Complete utterance detected - gửi đến STT
          logger.debug('🎤 Utterance detected for participant', {
            participantId,
            audioSizeKB: (vadResult.utteranceAudio.length / 1024).toFixed(2),
          });

          await this.streamToSTT(participantId, vadResult.utteranceAudio, streamBuffer.roomId);
        } else if (!vadResult.isSpeaking) {
          // ✅ No speech detected - skip processing (giảm CPU)
          logger.debug('🔇 No speech detected, skipping', { participantId });
        }
        // Else: Speech đang diễn ra, continue buffering trong VAD

      } catch (error) {
        logger.error('Error processing audio buffer:', { participantId, error });
      }
    }
  }

  /**
   * Stream audio chunk đến STT service
   */
  private async streamToSTT(participantId: string, audioData: Buffer, roomId: string): Promise<void> {
    try {
      const startTime = Date.now();

      // Gửi audio chunk đến STT service
      const response = await axios.post(
        `${this.sttServiceUrl}/api/v1/transcribe-stream`,
        {
          participant_id: participantId,
          audio_data: audioData.toString('base64'),
          sample_rate: this.OUTPUT_SAMPLE_RATE,
          channels: this.CHANNELS,
          format: 'pcm16', // hoặc 'opus' nếu không decode
        },
        {
          timeout: 5000, // 5s timeout cho low-latency
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const latency = Date.now() - startTime;

      // Handle transcription result
      if (response.data && response.data.text) {
        const transcription = {
          roomId,
          participantId,
          text: response.data.text,
          language: response.data.language || 'en',
          confidence: response.data.confidence || 0,
          timestamp: Date.now(),
          isFinal: response.data.is_final || false,
        };

        // Emit event để SignalingServer broadcast
        this.emit('transcription', transcription);

        // Log cho monitoring
        if (transcription.isFinal) {
          logger.info('📝 Transcription received', {
            participantId,
            text: transcription.text,
            latency: `${latency}ms`,
            confidence: transcription.confidence,
          });
        }
      }
    } catch (error: any) {
      // Log error nhưng KHÔNG throw để stream tiếp tục
      if (error.code === 'ECONNREFUSED') {
        logger.error('STT service unavailable', {
          participantId,
          sttServiceUrl: this.sttServiceUrl,
        });
      } else {
        logger.error('Error streaming to STT:', {
          participantId,
          error: error.message,
        });
      }
      // Emit caption error for UI fallback
      this.emit('caption-error', {
        participantId,
        roomId,
        error: error?.message || 'stt_error',
      });
    }
  }

  /**
   * Notify STT service về stream mới (để initialize model)
   */
  private async notifySTTStreamStart(roomId: string, participantId: string): Promise<void> {
    try {
      await axios.post(
        `${this.sttServiceUrl}/api/v1/stream-start`,
        {
          room_id: roomId,
          participant_id: participantId,
          sample_rate: this.OUTPUT_SAMPLE_RATE,
          channels: this.CHANNELS,
        },
        { timeout: 15000 }  // Increase timeout to 15s for cold start
      );

      logger.debug('STT service notified of stream start', { participantId });
    } catch (error: any) {
      logger.warn('Could not notify STT service:', error.message);
      // Don't throw - graceful degradation
    }
  }

  /**
   * Stop streaming audio từ participant
   */
  async stopStreaming(participantId: string): Promise<void> {
    try {
      const streamBuffer = this.activeStreams.get(participantId);
      if (!streamBuffer) {
        return;
      }

      logger.info('🛑 Stopping audio streaming', { participantId });

      // Close consumer/transport/decoder/socket if any
      if (streamBuffer.consumer) {
        try {
          await streamBuffer.consumer.close();
        } catch (err) {
          logger.warn('Error closing consumer', { participantId, err });
        }
      }

      if (streamBuffer.transport) {
        try {
          await streamBuffer.transport.close();
        } catch (err) {
          logger.warn('Error closing transport', { participantId, err });
        }
      }

      if ((streamBuffer as any).udpSocket && typeof (streamBuffer as any).udpSocket.close === 'function') {
        try {
          (streamBuffer as any).udpSocket.close();
        } catch (err) {
          logger.warn('Error closing UDP socket', { participantId, err });
        }
      }

      if (streamBuffer.decoder && typeof streamBuffer.decoder.destroy === 'function') {
        try {
          streamBuffer.decoder.destroy();
        } catch (err) {
          logger.warn('Error destroying decoder', { participantId, err });
        }
      }

      // Remove stream buffer
      this.activeStreams.delete(participantId);

      // Notify STT service
      await this.notifySTTStreamEnd(participantId);

      logger.info('✅ Audio streaming stopped', { participantId });
    } catch (error) {
      logger.error('Error stopping audio streaming:', error);
    }
  }

  /**
   * Notify STT service về stream end
   */
  private async notifySTTStreamEnd(participantId: string): Promise<void> {
    try {
      await axios.post(
        `${this.sttServiceUrl}/api/v1/stream-end`,
        { participant_id: participantId },
        { timeout: 5000 }
      );

      logger.debug('STT service notified of stream end', { participantId });
    } catch (error: any) {
      logger.warn('Could not notify STT service of stream end:', error.message);
    }
  }

  /**
   * Get streaming statistics cho monitoring
   */
  getStats(): any {
    const stats: any[] = [];

    for (const [participantId, streamBuffer] of this.activeStreams.entries()) {
      stats.push({
        participantId,
        producerId: streamBuffer.producerId,
        bufferSize: streamBuffer.buffer.length,
        lastProcessedAt: streamBuffer.lastProcessedAt,
        timeSinceLastProcess: Date.now() - streamBuffer.lastProcessedAt,
      });
    }

    return {
      activeStreams: this.activeStreams.size,
      streams: stats,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down AudioProcessor...');

    // Stop processing loop
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Stop all active streams
    const participantIds = Array.from(this.activeStreams.keys());
    for (const participantId of participantIds) {
      await this.stopStreaming(participantId);
    }

    logger.info('✅ AudioProcessor shutdown complete');
  }
}
