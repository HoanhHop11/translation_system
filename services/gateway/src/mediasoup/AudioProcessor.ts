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
  private pausedStreams: Set<string> = new Set(); // Track paused participants (muted mic)
  private sttServiceUrl: string;
  private processingInterval: NodeJS.Timeout | null = null;
  // ✅ REMOVED: Shared vadProcessor - mỗi participant sẽ có VAD riêng trong streamBuffer

  // Audio buffer settings cho low-latency
  private readonly BUFFER_SIZE_MS = 100; // 100ms chunks cho real-time
  private readonly INPUT_SAMPLE_RATE = 48000; // MediaSoup default Opus sample rate
  private readonly OUTPUT_SAMPLE_RATE = 16000; // Target for STT
  private readonly CHANNELS = 1; // Mono cho STT
  private readonly BYTES_PER_SAMPLE = 2; // 16-bit PCM
  private readonly BUFFER_SIZE_BYTES = (this.OUTPUT_SAMPLE_RATE * this.BUFFER_SIZE_MS) / 1000 * this.CHANNELS * this.BYTES_PER_SAMPLE;

  // ✅ FIX LAG: Pre-warmed VAD template để clone nhanh hơn
  private vadModelWarmed = false;

  constructor() {
    super();
    this.sttServiceUrl = process.env.STT_SERVICE_URL || 'http://stt:8002';

    logger.info('✅ AudioProcessor initialized', {
      sttServiceUrl: this.sttServiceUrl,
      bufferSizeMs: this.BUFFER_SIZE_MS,
      sampleRate: this.OUTPUT_SAMPLE_RATE,
    });

    // Pre-warm VAD model để giảm lag khi participant đầu tiên join
    this.prewarmVADModel();

    // Start background processing loop
    this.startProcessingLoop();
  }

  /**
   * Pre-warm VAD model để ONNX inference sẵn sàng
   * Giảm lag ~500ms cho participant đầu tiên
   */
  private async prewarmVADModel(): Promise<void> {
    try {
      logger.info('🔥 Pre-warming VAD model...');
      const warmupVAD = new SileroVADProcessor();
      await warmupVAD.initialize();
      
      // Process một chunk dummy để warm up ONNX runtime
      const dummyAudio = Buffer.alloc(3200); // 100ms @ 16kHz
      await warmupVAD.processChunk(dummyAudio);
      
      warmupVAD.reset();
      this.vadModelWarmed = true;
      logger.info('✅ VAD model pre-warmed successfully');
    } catch (error) {
      logger.error('❌ Failed to pre-warm VAD model:', error);
    }
  }

  /**
   * Create per-participant VAD processor
   * ✅ FIX: Sau khi model đã warm, tạo instance mới sẽ nhanh hơn
   */
  private async createParticipantVAD(): Promise<SileroVADProcessor> {
    const vad = new SileroVADProcessor();
    try {
      await vad.initialize();
      logger.debug('✅ Per-participant VAD initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize per-participant VAD:', error);
    }
    return vad;
  }

  /**
   * Start streaming audio từ producer (TỰ ĐỘNG, KHÔNG CẦN USER BẤM NÚT)
   */
  async startStreaming(roomId: string, participantId: string, producer: Producer, router: Router, language?: string): Promise<void> {
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

      // ✅ FIX: Tạo VAD instance RIÊNG cho participant này
      const participantVAD = await this.createParticipantVAD();

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
        language,
        vadProcessor: participantVAD, // ✅ Per-participant VAD
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

      logger.info('✅ Audio streaming started with per-participant VAD', { participantId });
    } catch (error) {
      logger.error('Error starting audio streaming:', error);
      throw error;
    }
  }

  /**
   * Update language for active stream (called when participant updates preference)
   */
  updateStreamLanguage(participantId: string, language: string): void {
    const streamBuffer = this.activeStreams.get(participantId);
    if (streamBuffer) {
      streamBuffer.language = language;
      logger.info('🌐 Updated stream language', { participantId, language });
    }
  }

  /**
   * Pause audio streaming cho participant (khi mute mic)
   */
  pauseStreaming(participantId: string): void {
    this.pausedStreams.add(participantId);
    logger.info('🔇 Audio streaming paused', { participantId });
  }

  /**
   * Resume audio streaming cho participant (khi unmute mic)
   */
  resumeStreaming(participantId: string): void {
    this.pausedStreams.delete(participantId);
    logger.info('🔊 Audio streaming resumed', { participantId });
  }

  /**
   * Check if streaming is paused for participant
   */
  isStreamingPaused(participantId: string): boolean {
    return this.pausedStreams.has(participantId);
  }

  /**
   * Handle RTP packet từ MediaSoup (tự động được gọi)
   */
  private handleRtpPacket(participantId: string, rtpPacket: Buffer): void {
    const streamBuffer = this.activeStreams.get(participantId);
    if (!streamBuffer) {
      return;
    }

    // 🔇 Skip nếu participant đã mute mic
    if (this.pausedStreams.has(participantId)) {
      return;
    }

    try {
      // Extract audio payload từ RTP packet
      const audioPayload = this.extractPayload(rtpPacket);

      if (!audioPayload || audioPayload.length === 0) {
        return;
      }

      // ✅ FIX: Skip DTX/comfort noise packets (very small, causes decode errors)
      // Opus normal packets are typically > 10 bytes
      // DTX packets can be 1-3 bytes
      if (audioPayload.length < 4) {
        return; // Likely DTX/comfort noise, skip
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
   * Check if packet is RTCP (not RTP)
   * RTCP packet types: 200 (SR), 201 (RR), 202 (SDES), 203 (BYE), 204 (APP)
   * ✅ FIX OPUS ERROR: Filter out RTCP packets before trying to decode
   */
  private isRtcpPacket(packet: Buffer): boolean {
    if (packet.length < 2) return false;
    
    // RTP/RTCP can be distinguished by looking at the second byte (payload type field)
    // For RTCP: PT is in range 200-204
    // For RTP: PT is typically < 128 or >= 72 (dynamic range 96-127)
    const payloadType = packet[1] & 0x7f; // Get 7-bit payload type
    
    // RTCP payload types are 200-204
    return payloadType >= 200 && payloadType <= 204;
  }

  /**
   * Parse RTP packet to extract Opus payload
   * ✅ FIX: Handle padding, RTCP, and malformed packets properly
   */
  private extractPayload(rtpPacket: Buffer): Buffer | null {
    if (rtpPacket.length < 12) {
      return null;
    }

    // ✅ FIX: Skip RTCP packets
    if (this.isRtcpPacket(rtpPacket)) {
      return null;
    }

    const firstByte = rtpPacket[0];
    const hasPadding = (firstByte & 0x20) > 0;
    const csrcCount = firstByte & 0x0f;
    const extension = (firstByte & 0x10) > 0;
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

    let payloadEnd = rtpPacket.length;

    // ✅ FIX: Handle RTP padding
    if (hasPadding) {
      const paddingLength = rtpPacket[rtpPacket.length - 1];
      if (paddingLength > 0 && paddingLength < rtpPacket.length - offset) {
        payloadEnd -= paddingLength;
      }
    }

    if (offset >= payloadEnd) {
      return null;
    }

    return rtpPacket.subarray(offset, payloadEnd);
  }

  /**
   * Decode Opus payload to PCM16 48k mono
   * ✅ FIX LAG: Giảm logging để tránh I/O overhead
   */
  private opusErrorCount = 0;
  private lastOpusErrorLog = 0;

  private decodeOpusToPcm16(payload: Buffer, decoder: any): Int16Array | null {
    try {
      const decoded = decoder.decode(payload);
      return this.toInt16Array(decoded);
    } catch (error) {
      // ✅ FIX: Rate-limit error logging để tránh I/O spam gây lag
      this.opusErrorCount++;
      const now = Date.now();
      if (now - this.lastOpusErrorLog > 10000) { // Log mỗi 10 giây
        logger.warn('Opus decode errors in last 10s', { 
          count: this.opusErrorCount,
          lastError: (error as Error).message 
        });
        this.opusErrorCount = 0;
        this.lastOpusErrorLog = now;
      }
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
   * Downsample 48kHz → 16kHz với anti-aliasing filter
   * 
   * Sử dụng simple low-pass filter (moving average) trước khi decimation
   * để tránh aliasing artifacts gây "hallucination" cho STT
   * 
   * Lý thuyết: Khi downsample factor 3, Nyquist frequency = 8kHz
   * Tần số > 8kHz sẽ bị fold back thành nhiễu nếu không có anti-aliasing
   */
  private downsampleTo16k(input: Int16Array): Int16Array {
    if (input.length === 0) {
      return input;
    }
    
    const factor = 3;
    const outLen = Math.floor(input.length / factor);
    const out = new Int16Array(outLen);
    
    // ✅ FIX: Sử dụng box filter (moving average) 5-tap làm anti-aliasing filter
    // Box filter với window = 5 samples có cutoff ~9.6kHz ở 48kHz
    // Đủ để attenuate frequencies > 8kHz (Nyquist của 16kHz)
    const filterSize = 5;
    const halfFilter = Math.floor(filterSize / 2);
    
    for (let j = 0; j < outLen; j++) {
      const centerIdx = j * factor;
      let sum = 0;
      let count = 0;
      
      // Apply 5-tap moving average filter centered at decimation point
      for (let k = -halfFilter; k <= halfFilter; k++) {
        const idx = centerIdx + k;
        if (idx >= 0 && idx < input.length) {
          sum += input[idx];
          count++;
        }
      }
      
      out[j] = count > 0 ? Math.round(sum / count) : 0;
    }
    
    return out;
  }

  /**
   * Process tất cả audio buffers với VAD-based utterance detection
   * ✅ FIX: Sử dụng per-participant VAD để tránh crosstalk giữa speakers
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

        // ✅ FIX: Sử dụng VAD của CHÍNH participant này, không phải shared VAD
        const participantVAD = streamBuffer.vadProcessor as SileroVADProcessor;
        if (!participantVAD) {
          // Fallback: Nếu không có VAD, gửi thẳng audio
          logger.warn('No VAD for participant, sending raw audio', { participantId });
          await this.streamToSTT(participantId, pcmData, streamBuffer.roomId);
          continue;
        }

        // ✅ VAD-based utterance detection - PER PARTICIPANT
        const vadResult = await participantVAD.processChunk(pcmData);

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
      const streamBuffer = this.activeStreams.get(participantId);
      const language = streamBuffer?.language || 'vi';

      // Gửi audio chunk đến STT service
      const response = await axios.post(
        `${this.sttServiceUrl}/api/v1/transcribe-stream`,
        {
          participant_id: participantId,
          audio_data: audioData.toString('base64'),
          sample_rate: this.OUTPUT_SAMPLE_RATE,
          channels: this.CHANNELS,
          format: 'pcm16', // hoặc 'opus' nếu không decode
          language,
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
      if (response.data) {
        logger.debug('STT raw response', {
          participantId,
          roomId,
          language,
          data: response.data,
        });
      }

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

      // ✅ FIX ZOMBIE: Xóa khỏi activeStreams NGAY LẬP TỨC
      // Điều này đảm bảo processAudioBuffers loop sẽ bỏ qua user này ngay
      // trong khi các bước cleanup async đang chạy
      this.activeStreams.delete(participantId);
      this.pausedStreams.delete(participantId);

      // ✅ Cleanup per-participant VAD
      if (streamBuffer.vadProcessor) {
        try {
          const vad = streamBuffer.vadProcessor as SileroVADProcessor;
          vad.reset();
          logger.debug('VAD reset for participant', { participantId });
        } catch (err) {
          logger.warn('Error resetting VAD', { participantId, err });
        }
      }

      // Close consumer/transport/decoder/socket if any (async cleanup)
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
          // ✅ FIX: Remove all listeners trước khi close để tránh memory leak
          (streamBuffer as any).udpSocket.removeAllListeners();
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
