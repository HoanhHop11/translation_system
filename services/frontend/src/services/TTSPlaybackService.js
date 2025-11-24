/**
 * TTSPlaybackService - Phát audio đã dịch từ TTS service
 * 
 * Workflow:
 * 1. Nhận base64 audio từ TTS service
 * 2. Decode thành AudioBuffer
 * 3. Schedule playback với Web Audio API
 * 4. Mix với existing audio (không override mute state)
 * 5. Queue management cho multiple translations
 * 
 * Features:
 * - Independent volume control
 * - Audio queue (FIFO)
 * - Mix với original stream
 */

class TTSPlaybackService {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.playbackQueue = new Map(); // participantId → queue[]
    this.activeSources = new Map(); // participantId → AudioBufferSourceNode[]
    this.volume = 0.8; // Default volume
    
    console.log('🔊 TTSPlaybackService initialized');
  }
  
  /**
   * Initialize AudioContext (lazy loading)
   */
  initAudioContext() {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      return;
    }
    
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext({ sampleRate: 24000 }); // Match TTS output
    
    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;
    this.gainNode.connect(this.audioContext.destination);
    
    console.log('✅ AudioContext initialized', {
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state
    });
  }
  
  /**
   * Play translated audio cho participant
   * 
   * @param {string} participantId - ID của participant
   * @param {string} base64Audio - Base64-encoded audio (MP3/WAV)
   * @param {Object} options - Playback options
   */
  async playTranslatedAudio(participantId, base64Audio, options = {}) {
    try {
      const { immediate = true, onStart, onEnd } = options;
      
      // Init AudioContext nếu chưa
      this.initAudioContext();
      
      // Resume AudioContext nếu suspended (autoplay policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Decode base64 → ArrayBuffer
      const audioData = this.base64ToArrayBuffer(base64Audio);
      
      // Decode audio → AudioBuffer
      const audioBuffer = await this.audioContext.decodeAudioData(audioData);
      
      console.log(`🎵 Decoded audio for ${participantId}`, {
        duration: audioBuffer.duration.toFixed(2) + 's',
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate
      });
      
      if (immediate) {
        // Play immediately
        await this.playAudioBuffer(participantId, audioBuffer, { onStart, onEnd });
      } else {
        // Add to queue
        this.addToQueue(participantId, audioBuffer, { onStart, onEnd });
      }
      
    } catch (error) {
      console.error(`❌ Error playing translated audio for ${participantId}:`, error);
      throw error;
    }
  }
  
  /**
   * Play AudioBuffer immediately
   */
  async playAudioBuffer(participantId, audioBuffer, options = {}) {
    const { onStart, onEnd } = options;
    
    // Create source node
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    
    // Connect to gain node
    source.connect(this.gainNode);
    
    // Track active source
    if (!this.activeSources.has(participantId)) {
      this.activeSources.set(participantId, []);
    }
    this.activeSources.get(participantId).push(source);
    
    // Handle end
    source.onended = () => {
      // Remove from active sources
      const sources = this.activeSources.get(participantId) || [];
      const index = sources.indexOf(source);
      if (index > -1) {
        sources.splice(index, 1);
      }
      
      console.log(`✅ Finished playing audio for ${participantId}`);
      
      if (onEnd) onEnd();
      
      // Process queue
      this.processQueue(participantId);
    };
    
    // Start playback
    source.start(0);
    
    console.log(`▶️ Playing translated audio for ${participantId}`, {
      duration: audioBuffer.duration.toFixed(2) + 's'
    });
    
    if (onStart) onStart();
  }
  
  /**
   * Add audio to playback queue
   */
  addToQueue(participantId, audioBuffer, options) {
    if (!this.playbackQueue.has(participantId)) {
      this.playbackQueue.set(participantId, []);
    }
    
    this.playbackQueue.get(participantId).push({ audioBuffer, options });
    
    console.log(`📋 Added to queue for ${participantId}`, {
      queueLength: this.playbackQueue.get(participantId).length
    });
    
    // Process queue if not currently playing
    const activeSources = this.activeSources.get(participantId) || [];
    if (activeSources.length === 0) {
      this.processQueue(participantId);
    }
  }
  
  /**
   * Process next item in queue
   */
  async processQueue(participantId) {
    const queue = this.playbackQueue.get(participantId);
    
    if (!queue || queue.length === 0) {
      return;
    }
    
    const { audioBuffer, options } = queue.shift();
    await this.playAudioBuffer(participantId, audioBuffer, options);
  }
  
  /**
   * Stop all playback cho participant
   */
  stopPlayback(participantId) {
    // Stop active sources
    const sources = this.activeSources.get(participantId) || [];
    
    for (const source of sources) {
      try {
        source.stop();
        source.disconnect();
      } catch (error) {
        // Ignore errors (source might be already stopped)
      }
    }
    
    this.activeSources.delete(participantId);
    
    // Clear queue
    this.playbackQueue.delete(participantId);
    
    console.log(`⏹️ Stopped playback for ${participantId}`);
  }
  
  /**
   * Stop all playback (cleanup)
   */
  stopAll() {
    const participantIds = [
      ...this.activeSources.keys(),
      ...this.playbackQueue.keys()
    ];
    
    const uniqueIds = [...new Set(participantIds)];
    
    for (const participantId of uniqueIds) {
      this.stopPlayback(participantId);
    }
    
    console.log('⏹️ Stopped all playback');
  }
  
  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
    
    console.log(`🔊 Volume set to ${(this.volume * 100).toFixed(0)}%`);
  }
  
  /**
   * Get volume
   */
  getVolume() {
    return this.volume;
  }
  
  /**
   * Convert base64 string to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    // Remove data URL prefix if exists
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    
    // Decode base64
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes.buffer;
  }
  
  /**
   * Get playback stats
   */
  getStats() {
    const stats = [];
    
    for (const [participantId, sources] of this.activeSources.entries()) {
      const queue = this.playbackQueue.get(participantId) || [];
      
      stats.push({
        participantId,
        activeSources: sources.length,
        queueLength: queue.length
      });
    }
    
    return {
      audioContextState: this.audioContext?.state,
      volume: this.volume,
      totalActive: this.activeSources.size,
      participants: stats
    };
  }
  
  /**
   * Cleanup (khi unmount)
   */
  async cleanup() {
    console.log('🧹 Cleaning up TTSPlaybackService...');
    
    this.stopAll();
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }
    
    this.audioContext = null;
    this.gainNode = null;
    
    console.log('✅ TTSPlaybackService cleaned up');
  }
}

// Singleton instance
const ttsPlaybackService = new TTSPlaybackService();

export default ttsPlaybackService;
