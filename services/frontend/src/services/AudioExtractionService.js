/**
 * AudioExtractionService - Extract audio từ MediaSoup remote consumers
 * 
 * Workflow:
 * 1. Nhận MediaStreamTrack từ remote consumer
 * 2. Tạo AudioContext + AudioWorklet processor
 * 3. Downsample 48kHz → 16kHz, buffer 500ms chunks
 * 4. Convert Float32 → Int16 PCM
 * 5. Callback với audio chunks để gửi STT service
 * 
 * Performance:
 * - AudioWorklet chạy riêng thread (không block UI)
 * - Zero-copy data transfer với Transferable Objects
 * - Target latency: <100ms buffering + <50ms processing
 */

class AudioExtractionService {
  constructor() {
    this.extractors = new Map(); // participantId → extractor instance
    this.workletLoaded = false;
    this.audioContexts = new Map(); // participantId → AudioContext
    
    console.log('📡 AudioExtractionService initialized');
  }
  
  /**
   * Setup audio extraction cho một remote participant
   * 
   * @param {string} participantId - ID của participant
   * @param {MediaStreamTrack} audioTrack - Audio track từ consumer
   * @param {Function} onAudioChunk - Callback khi có audio chunk
   * @returns {Promise<Object>} - Extractor instance
   */
  async setupExtraction(participantId, audioTrack, onAudioChunk) {
    try {
      console.log(`🎤 Setting up audio extraction for ${participantId}`);
      
      // Check if already extracting
      if (this.extractors.has(participantId)) {
        console.warn(`⚠️ Already extracting audio for ${participantId}, stopping old extraction`);
        await this.stopExtraction(participantId);
      }
      
      // Validate track
      if (!audioTrack || audioTrack.kind !== 'audio') {
        throw new Error('Invalid audio track');
      }
      
      if (audioTrack.readyState !== 'live') {
        throw new Error(`Audio track not live: ${audioTrack.readyState}`);
      }
      
      // Create MediaStream from track
      const audioStream = new MediaStream([audioTrack]);
      
      // Create AudioContext (48kHz to match MediaSoup)
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext({ 
        sampleRate: 48000,
        latencyHint: 'interactive' // Low latency mode
      });
      
      this.audioContexts.set(participantId, audioContext);
      
      // Resume AudioContext nếu suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('▶️ AudioContext resumed');
      }
      
      // Load AudioWorklet module (reload nếu cần)
      // Note: Mỗi AudioContext cần load riêng worklet module
      try {
        console.log('📥 Loading AudioWorklet processor...');
        await audioContext.audioWorklet.addModule('/audio-processor-worklet.js');
        this.workletLoaded = true;
        console.log('✅ AudioWorklet processor loaded');
      } catch (err) {
        // Worklet có thể đã loaded, ignore duplicate load error
        if (!err.message.includes('already exists')) {
          throw err;
        }
        console.log('ℹ️ AudioWorklet processor already loaded');
      }
      
      // Create AudioWorkletNode
      const processorNode = new AudioWorkletNode(audioContext, 'stt-audio-processor');
      
      // Listen for audio chunks từ worklet
      processorNode.port.onmessage = (event) => {
        const { type, pcmData, sampleRate, samples, duration, timestamp, chunkIndex } = event.data;
        
        if (type === 'audio-chunk') {
          // Callback với audio chunk
          if (onAudioChunk) {
            onAudioChunk({
              participantId,
              pcmData,
              sampleRate,
              samples,
              duration,
              timestamp,
              chunkIndex
            });
          }
        }
      };
      
      // Connect: MediaStream → AudioContext → AudioWorklet
      const source = audioContext.createMediaStreamSource(audioStream);
      source.connect(processorNode);
      
      // Store extractor instance
      const extractor = {
        participantId,
        audioTrack,
        audioStream,
        audioContext,
        source,
        processorNode,
        startedAt: Date.now()
      };
      
      this.extractors.set(participantId, extractor);
      
      console.log(`✅ Audio extraction started for ${participantId}`, {
        sampleRate: audioContext.sampleRate,
        state: audioContext.state
      });
      
      return extractor;
      
    } catch (error) {
      console.error(`❌ Error setting up audio extraction for ${participantId}:`, error);
      throw error;
    }
  }
  
  /**
   * Stop audio extraction cho participant
   * 
   * @param {string} participantId - ID của participant
   */
  async stopExtraction(participantId) {
    try {
      const extractor = this.extractors.get(participantId);
      
      if (!extractor) {
        console.warn(`⚠️ No extraction found for ${participantId}`);
        return;
      }
      
      console.log(`🛑 Stopping audio extraction for ${participantId}`);
      
      // Disconnect nodes
      if (extractor.source) {
        extractor.source.disconnect();
      }
      
      if (extractor.processorNode) {
        extractor.processorNode.port.close();
        extractor.processorNode.disconnect();
      }
      
      // Close AudioContext
      const audioContext = this.audioContexts.get(participantId);
      if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close();
      }
      
      // Remove from maps
      this.extractors.delete(participantId);
      this.audioContexts.delete(participantId);
      
      console.log(`✅ Audio extraction stopped for ${participantId}`);
      
    } catch (error) {
      console.error(`❌ Error stopping audio extraction for ${participantId}:`, error);
    }
  }
  
  /**
   * Stop all extractions (cleanup khi unmount)
   */
  async stopAll() {
    console.log('🛑 Stopping all audio extractions...');
    
    const participantIds = Array.from(this.extractors.keys());
    
    for (const participantId of participantIds) {
      await this.stopExtraction(participantId);
    }
    
    // Reset workletLoaded flag để force reload khi enable lại
    this.workletLoaded = false;
    
    console.log('✅ All audio extractions stopped');
  }
  
  /**
   * Get extraction stats cho monitoring
   */
  getStats() {
    const stats = [];
    
    for (const [participantId, extractor] of this.extractors.entries()) {
      const audioContext = this.audioContexts.get(participantId);
      
      stats.push({
        participantId,
        state: audioContext?.state,
        sampleRate: audioContext?.sampleRate,
        uptime: Date.now() - extractor.startedAt,
        trackState: extractor.audioTrack.readyState
      });
    }
    
    return {
      activeExtractions: this.extractors.size,
      workletLoaded: this.workletLoaded,
      extractions: stats
    };
  }
  
  /**
   * Check if extracting audio cho participant
   */
  isExtracting(participantId) {
    return this.extractors.has(participantId);
  }
}

// Singleton instance
const audioExtractionService = new AudioExtractionService();

export default audioExtractionService;
