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

  // ✅ VAD config - TUNED cho cả tiếng Việt và English
  // Các giá trị này đã được tối ưu dựa trên testing thực tế:
  // - Giảm POSITIVE_THRESHOLD để nhận diện giọng nhỏ/nói xa mic tốt hơn (đặc biệt English)
  // - Giảm NEGATIVE_THRESHOLD để không cắt giọng quá nhanh khi pause nhẹ
  // - Tăng REDEMPTION_FRAMES để tránh cắt mất chữ cuối câu (English có pause dài hơn Vietnamese)
  // - Thêm PRE_SPEECH_PAD_FRAMES để không cắt mất phụ âm/từ đầu câu
  //
  // ⚠️ UPDATE Dec 2025: Giảm threshold để improve detection cho cả Vietnamese + English
  // - 0.4 detect được giọng nói bình thường đến nhỏ
  // - redemptionFrames 12 (~360ms) cho pause dài hơn trong English sentences
  private readonly POSITIVE_THRESHOLD = 0.4;      // GIẢM từ 0.5 → 0.4 để detect giọng nhỏ tốt hơn
  private readonly NEGATIVE_THRESHOLD = 0.25;     // GIẢM từ 0.35 → 0.25 để không cắt giữa câu
  private readonly REDEMPTION_FRAMES = 12;        // TĂNG từ 8 → 12 (~360ms) cho English pause
  private readonly MIN_SPEECH_FRAMES = 2;         // GIẢM từ 3 → 2 để detect utterances ngắn
  private readonly PRE_SPEECH_PAD_FRAMES = 3;     // TĂNG từ 2 → 3 (~90ms) để giữ thêm audio đầu

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
        preSpeechPadFrames: this.PRE_SPEECH_PAD_FRAMES, // ✅ Giữ audio trước speech để không mất đầu câu
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
        preSpeechPadFrames: this.PRE_SPEECH_PAD_FRAMES,
      });
    } catch (error) {
      logger.error('❌ Failed to initialize AVR-VAD:', error);
      this.vad = null;
    }
  }

  // ✅ DEBUG: Counter để log audio stats theo chu kỳ (tránh log spam)
  private audioStatsCounter = 0;
  private maxRmsSeenInPeriod = 0;
  private avgRmsSum = 0;
  private avgRmsCount = 0;
  
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
      
      // ✅ DEBUG: Tính RMS để monitor audio level
      const rms = this.calculateRMS(float32);
      this.maxRmsSeenInPeriod = Math.max(this.maxRmsSeenInPeriod, rms);
      this.avgRmsSum += rms;
      this.avgRmsCount++;
      
      // Log audio stats mỗi 50 chunks (~5 giây @ 100ms/chunk)
      this.audioStatsCounter++;
      if (this.audioStatsCounter >= 50) {
        const avgRms = this.avgRmsCount > 0 ? this.avgRmsSum / this.avgRmsCount : 0;
        logger.debug('📊 Audio stats (last 5s)', {
          maxRms: this.maxRmsSeenInPeriod.toFixed(4),
          avgRms: avgRms.toFixed(4),
          chunkSize: float32.length,
          isSpeaking: this.isSpeaking,
          // RMS > 0.02 thường là có giọng nói, < 0.01 là silence/noise
          likelyHasSpeech: this.maxRmsSeenInPeriod > 0.02 ? 'YES' : 'NO',
        });
        // Reset counters
        this.audioStatsCounter = 0;
        this.maxRmsSeenInPeriod = 0;
        this.avgRmsSum = 0;
        this.avgRmsCount = 0;
      }
      
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
  
  /**
   * Tính RMS (Root Mean Square) của audio signal
   * - RMS > 0.1: Loud speech
   * - RMS 0.02-0.1: Normal speech
   * - RMS < 0.02: Silence or very quiet
   */
  private calculateRMS(float32: Float32Array): number {
    if (float32.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < float32.length; i++) {
      sum += float32[i] * float32[i];
    }
    return Math.sqrt(sum / float32.length);
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
