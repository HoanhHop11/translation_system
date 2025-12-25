/**
 * LocalVADService - Phát hiện giọng nói của local user để trigger Barge-In
 * 
 * Workflow:
 * 1. Kết nối với local MediaStream (microphone)
 * 2. Sử dụng AnalyserNode để đo volume level
 * 3. Khi detect speech (volume > threshold) → trigger callback
 * 4. Dùng để ngắt TTS khi user bắt đầu nói
 * 
 * Features:
 * - Lightweight VAD (không cần ML model)
 * - Debounce để tránh false positives
 * - Configurable thresholds
 */

class LocalVADService {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.animationFrame = null;
    
    // VAD Configuration - Tuned để tránh false positives từ tiếng ồn nền
    this.config = {
      volumeThreshold: 0.06,      // 🔧 Tăng từ 0.02 → 0.06 để tránh trigger bởi tiếng xe/ồn nền
      minSpeechDuration: 150,     // 🔧 Tăng từ 100ms → 150ms để chắc chắn đang nói
      silenceDebounce: 400,       // 🔧 Tăng từ 300ms → 400ms để tránh ngắt TTS quá sớm
      fftSize: 256,               // FFT size cho AnalyserNode
    };
    
    // State
    this.isListening = false;
    this.isSpeaking = false;
    this.lastSpeechTime = 0;
    this.speechStartTime = 0;
    
    // Callbacks
    this.onSpeechStart = null;    // () => void
    this.onSpeechEnd = null;      // () => void
    this.onVolumeChange = null;   // (volume: number) => void
    
    console.log('🎤 LocalVADService initialized');
  }
  
  /**
   * Bắt đầu listening cho local speech
   * @param {MediaStream} stream - Local microphone stream
   * @param {Object} callbacks - { onSpeechStart, onSpeechEnd, onVolumeChange }
   */
  start(stream, callbacks = {}) {
    if (this.isListening) {
      console.log('⚠️ LocalVADService already listening');
      return;
    }
    
    if (!stream || !stream.getAudioTracks().length) {
      console.error('❌ LocalVADService: No audio track in stream');
      return;
    }
    
    // Set callbacks
    this.onSpeechStart = callbacks.onSpeechStart || null;
    this.onSpeechEnd = callbacks.onSpeechEnd || null;
    this.onVolumeChange = callbacks.onVolumeChange || null;
    
    try {
      // Create AudioContext
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      
      // Create AnalyserNode
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0.5;
      
      // Connect source → analyser
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyser);
      
      // Start monitoring
      this.isListening = true;
      this.monitor();
      
      console.log('✅ LocalVADService started', {
        sampleRate: this.audioContext.sampleRate,
        fftSize: this.analyser.fftSize
      });
      
    } catch (error) {
      console.error('❌ LocalVADService start error:', error);
    }
  }
  
  /**
   * Monitor audio level (animation frame loop)
   */
  monitor() {
    if (!this.isListening || !this.analyser) {
      return;
    }
    
    // Get volume level
    const volume = this.getVolume();
    const now = Date.now();
    
    // Notify volume change
    if (this.onVolumeChange) {
      this.onVolumeChange(volume);
    }
    
    // Check speaking state
    if (volume > this.config.volumeThreshold) {
      // Speaking detected
      this.lastSpeechTime = now;
      
      if (!this.isSpeaking) {
        // First frame of speech - record start time
        if (this.speechStartTime === 0) {
          this.speechStartTime = now;
        }
        
        // Check if speech duration > minimum
        if (now - this.speechStartTime >= this.config.minSpeechDuration) {
          this.isSpeaking = true;
          console.log('🗣️ [LocalVAD] Speech started (volume:', volume.toFixed(3), ')');
          
          if (this.onSpeechStart) {
            this.onSpeechStart();
          }
        }
      }
    } else {
      // Silence or low volume
      if (this.isSpeaking) {
        // Check if silent long enough
        if (now - this.lastSpeechTime >= this.config.silenceDebounce) {
          this.isSpeaking = false;
          this.speechStartTime = 0;
          console.log('🤐 [LocalVAD] Speech ended');
          
          if (this.onSpeechEnd) {
            this.onSpeechEnd();
          }
        }
      } else {
        // Reset speech start time if not yet confirmed speaking
        this.speechStartTime = 0;
      }
    }
    
    // Continue monitoring
    this.animationFrame = requestAnimationFrame(() => this.monitor());
  }
  
  /**
   * Get current volume level (0.0 - 1.0)
   */
  getVolume() {
    if (!this.analyser) return 0;
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    
    // Normalize to 0.0 - 1.0
    return sum / (bufferLength * 255);
  }
  
  /**
   * Update configuration
   */
  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ LocalVADService config updated:', this.config);
  }
  
  /**
   * Stop listening
   */
  stop() {
    if (!this.isListening) return;
    
    this.isListening = false;
    
    // Stop animation frame
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // Disconnect nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.isSpeaking = false;
    this.speechStartTime = 0;
    
    console.log('⏹️ LocalVADService stopped');
  }
  
  /**
   * Check if currently speaking
   */
  getIsSpeaking() {
    return this.isSpeaking;
  }
  
  /**
   * Get stats
   */
  getStats() {
    return {
      isListening: this.isListening,
      isSpeaking: this.isSpeaking,
      currentVolume: this.getVolume(),
      config: this.config
    };
  }
}

// Singleton instance
const localVADService = new LocalVADService();

export default localVADService;
