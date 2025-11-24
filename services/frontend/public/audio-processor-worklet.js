/**
 * AudioWorklet Processor cho Real-time Audio Extraction
 * 
 * Chức năng:
 * - Nhận audio stream từ MediaSoup remote consumer (48kHz stereo/mono Opus)
 * - Downsample 48kHz → 16kHz cho STT processing
 * - Buffer thành 500ms chunks
 * - Convert Float32Array → Int16 PCM
 * - Gửi về main thread để post đến STT service
 * 
 * Performance:
 * - Chạy trên AudioWorklet thread (không block UI)
 * - Target latency: <100ms buffering
 */

class STTAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Configuration
    this.sourceSampleRate = 48000; // MediaSoup default (Opus codec)
    this.targetSampleRate = 16000; // STT requirement
    this.downsampleRatio = this.sourceSampleRate / this.targetSampleRate; // 3:1
    
    // Buffering config (500ms chunks @ 16kHz)
    this.chunkSizeTarget = 8000; // 8000 samples = 500ms @ 16kHz
    this.buffer = [];
    
    // Downsampling state
    this.phase = 0;
    
    // Stats
    this.chunksSent = 0;
    this.totalSamplesProcessed = 0;
    
    console.log('[AudioWorklet] STTAudioProcessor initialized', {
      sourceSampleRate: this.sourceSampleRate,
      targetSampleRate: this.targetSampleRate,
      downsampleRatio: this.downsampleRatio,
      chunkSizeTarget: this.chunkSizeTarget,
      chunkDuration: `${(this.chunkSizeTarget / this.targetSampleRate * 1000).toFixed(0)}ms`
    });
  }
  
  /**
   * Main processing loop - được gọi mỗi 128 samples (render quantum)
   * 
   * @param {Array<Float32Array[]>} inputs - Input audio buffers
   * @param {Array<Float32Array[]>} outputs - Output audio buffers (unused)
   * @param {Object} parameters - Audio parameters
   * @returns {boolean} - true để keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0]; // Input bus 0
    
    if (!input || input.length === 0) {
      // No input yet, keep processor alive
      return true;
    }
    
    // Get first channel (convert stereo to mono if needed)
    const channel = input[0]; // Channel 0 (left/mono)
    
    if (!channel || channel.length === 0) {
      return true;
    }
    
    // Process samples: Downsample từ 48kHz → 16kHz
    for (let i = 0; i < channel.length; i++) {
      this.phase++;
      
      // Linear decimation: lấy 1 sample mỗi 3 samples
      if (this.phase >= this.downsampleRatio) {
        this.buffer.push(channel[i]);
        this.phase -= this.downsampleRatio;
        this.totalSamplesProcessed++;
      }
      
      // Check if we have enough samples for a chunk
      if (this.buffer.length >= this.chunkSizeTarget) {
        this.sendChunk();
      }
    }
    
    return true; // Keep processor alive
  }
  
  /**
   * Gửi audio chunk về main thread
   */
  sendChunk() {
    if (this.buffer.length === 0) return;
    
    // Convert Float32 → Int16 PCM
    const pcmData = this.float32ToInt16(this.buffer);
    
    // Prepare message
    const message = {
      type: 'audio-chunk',
      pcmData: pcmData,
      sampleRate: this.targetSampleRate,
      samples: pcmData.length,
      duration: (pcmData.length / this.targetSampleRate * 1000).toFixed(0), // ms
      timestamp: currentTime,
      chunkIndex: this.chunksSent
    };
    
    // Send to main thread (transfer ownership for zero-copy)
    this.port.postMessage(message, [pcmData.buffer]);
    
    // Stats
    this.chunksSent++;
    
    // Clear buffer
    this.buffer = [];
    
    // Log periodically (every 10 chunks = ~5 seconds)
    if (this.chunksSent % 10 === 0) {
      console.log('[AudioWorklet] Stats', {
        chunksSent: this.chunksSent,
        totalSamplesProcessed: this.totalSamplesProcessed,
        totalDuration: `${(this.totalSamplesProcessed / this.targetSampleRate).toFixed(1)}s`
      });
    }
  }
  
  /**
   * Convert Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767)
   * 
   * @param {Array<number>} float32Buffer - Float32 samples
   * @returns {Int16Array} - Int16 PCM samples
   */
  float32ToInt16(float32Buffer) {
    const int16Array = new Int16Array(float32Buffer.length);
    
    for (let i = 0; i < float32Buffer.length; i++) {
      // Clamp to [-1, 1] range
      const sample = Math.max(-1, Math.min(1, float32Buffer[i]));
      
      // Scale to Int16 range
      int16Array[i] = sample < 0 
        ? sample * 32768   // Negative: -1.0 → -32768
        : sample * 32767;  // Positive: 1.0 → 32767
    }
    
    return int16Array;
  }
}

// Register processor (tên phải match với AudioWorkletNode constructor)
registerProcessor('stt-audio-processor', STTAudioProcessor);

console.log('[AudioWorklet] stt-audio-processor registered');
