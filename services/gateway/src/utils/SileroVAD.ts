/**
 * SileroVAD Processor - Voice Activity Detection cho Vietnamese
 *
 * Production integration với avr-vad (RealTimeVAD)
 * - RealTimeVAD.new(options?: Partial<RealTimeVADOptions>): Promise<RealTimeVAD>
 * - RealTimeVAD.processAudio(audio: Float32Array): Promise<void>
 * - Emits callbacks: onSpeechStart / onSpeechEnd / onFrameProcessed / onVADMisfire
 *
 * Ở đây ta:
 * - Feed audio theo từng chunk PCM16 (sau này có thể thêm resample nếu không phải 16kHz)
 * - Gom các đoạn speech thành utterance bằng callback onSpeechEnd
 * - Dùng VAD để giảm số lần gọi STT
 */

import { logger } from '../logger';

export class SileroVADProcessor {
  // Thực thể RealTimeVAD từ avr-vad
  private vad: import('avr-vad').RealTimeVAD | null = null;

  // Buffer và state cho utterance hiện tại (PCM16)
  private speechBuffers: Buffer[] = [];
  private isSpeaking = false;

  // Stats đơn giản cho monitoring
  private totalUtterances = 0;

  // VAD config (tune cho tiếng Việt – có thể chỉnh thêm sau)
  private readonly POSITIVE_THRESHOLD = 0.6;
  private readonly NEGATIVE_THRESHOLD = 0.4;
  private readonly REDEMPTION_FRAMES = 5;
  private readonly MIN_SPEECH_FRAMES = 3;

  async initialize(): Promise<void> {
    try {
      const { RealTimeVAD, getDefaultRealTimeVADOptions } = await import('avr-vad');

      const baseOptions = getDefaultRealTimeVADOptions('v5');

      this.vad = await RealTimeVAD.new({
        ...baseOptions,
        sampleRate: 16000, // gateway sẽ cần đảm bảo audio gửi vào là 16kHz hoặc dùng Resampler ở layer trên
        positiveSpeechThreshold: this.POSITIVE_THRESHOLD,
        negativeSpeechThreshold: this.NEGATIVE_THRESHOLD,
        redemptionFrames: this.REDEMPTION_FRAMES,
        minSpeechFrames: this.MIN_SPEECH_FRAMES,
        submitUserSpeechOnPause: true,

        // Callbacks
        onFrameProcessed: (probs) => {
          // Có thể log chi tiết nếu cần debug
          // logger.debug('VAD frame', probs);
        },
        onVADMisfire: () => {
          logger.debug('⚠️ VAD misfire (segment ngắn / noise)');
        },
        onSpeechStart: () => {
          this.isSpeaking = true;
          this.speechBuffers = [];
          logger.debug('🎤 Speech start detected');
        },
        onSpeechRealStart: () => {
          logger.debug('🎯 Speech real start');
        },
        onSpeechEnd: (audio: Float32Array) => {
          // RealTimeVAD trả về Float32Array @16kHz; ta convert sang Buffer PCM16
          const pcm16 = this.float32ToPcm16(audio);
          this.speechBuffers.push(pcm16);
          this.isSpeaking = false;
          this.totalUtterances += 1;
          logger.debug('📝 Speech end detected', {
            durationMs: Math.round((audio.length / 16000) * 1000),
          });
        },
      });

      this.vad.start();

      logger.info('✅ AVR-VAD RealTimeVAD initialized', {
        positiveThreshold: this.POSITIVE_THRESHOLD,
        negativeThreshold: this.NEGATIVE_THRESHOLD,
        redemptionFrames: this.REDEMPTION_FRAMES,
        minSpeechFrames: this.MIN_SPEECH_FRAMES,
      });
    } catch (error) {
      logger.error('❌ Failed to initialize AVR-VAD:', error);
      this.vad = null;
    }
  }

  /**
   * Xử lý một chunk PCM16 (giả sử sampleRate đã là 16kHz hoặc gateway đã resample trước đó).
   * Trả về 1 utterance nếu VAD vừa kết thúc đoạn speech; nếu chưa có đoạn hoàn chỉnh thì hasUtterance=false.
   */
  async processChunk(audioChunk: Buffer): Promise<{
    hasUtterance: boolean;
    utteranceAudio: Buffer | null;
    isSpeaking: boolean;
  }> {
    if (!this.vad) {
      // Fallback: không có VAD → gửi thẳng sang STT
      return { hasUtterance: true, utteranceAudio: audioChunk, isSpeaking: true };
    }

    try {
      const float32 = this.bufferToFloat32(audioChunk);
      await this.vad.processAudio(float32);

      // Nếu onSpeechEnd đã được gọi trong khi processAudio, speechBuffers sẽ chứa 1 utterance hoàn chỉnh
      if (!this.isSpeaking && this.speechBuffers.length > 0) {
        const utterance = Buffer.concat(this.speechBuffers);
        this.speechBuffers = [];
        return { hasUtterance: true, utteranceAudio: utterance, isSpeaking: false };
      }

      // Đang trong đoạn speech hoặc chưa đủ dài để kết thúc
      return { hasUtterance: false, utteranceAudio: null, isSpeaking: this.isSpeaking };
    } catch (error) {
      logger.error('VAD Error in processChunk:', error);
      // Fallback: nếu VAD lỗi runtime, vẫn cho audio đi tiếp
      return { hasUtterance: true, utteranceAudio: audioChunk, isSpeaking: true };
    }
  }

  private bufferToFloat32(buffer: Buffer): Float32Array {
    const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    return float32Array;
  }

  private float32ToPcm16(data: Float32Array): Buffer {
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      let s = data[i];
      s = Math.max(-1, Math.min(1, s));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return Buffer.from(int16.buffer);
  }

  flush(): Buffer | null {
    if (this.speechBuffers.length > 0) {
      const buf = Buffer.concat(this.speechBuffers);
      this.speechBuffers = [];
      this.isSpeaking = false;
      return buf;
    }
    return null;
  }

  reset(): void {
    this.speechBuffers = [];
    this.isSpeaking = false;
    this.vad?.reset();
  }

  getStats() {
    return {
      isSpeaking: this.isSpeaking,
      bufferedChunks: this.speechBuffers.length,
      totalUtterances: this.totalUtterances,
    };
  }
}
