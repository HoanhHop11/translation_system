/**
 * RemoteAudioMonitorService - Monitor remote streams for speech activity
 * 
 * Purpose:
 * Detect when remote users are speaking to implement Echo Suppression.
 * If remote users are loud, we assume any audio on local mic is likely Echo.
 */

class RemoteAudioMonitorService {
    constructor() {
        this.audioContext = null;
        this.analysers = new Map(); // participantId -> AnalyserNode
        this.sources = new Map(); // participantId -> MediaStreamAudioSourceNode
        this.isMonitoring = false;
        this.checkInterval = null;

        // Config
        this.config = {
            threshold: 0.05, // Volume threshold to consider "speaking"
            interval: 100,   // Check every 100ms
            holdTime: 400    // Keep "speaking" state for 400ms after silence (reverb/latency compensation)
        };

        this.speakingState = {
            isRemoteSpeaking: false,
            lastSpeechTime: 0
        };

        this.onStateChange = null; // Callback (isSpeaking: boolean) => void
    }

    /**
     * Start monitoring
     */
    start(onStateChange) {
        if (this.isMonitoring) return;

        this.onStateChange = onStateChange;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            this.isMonitoring = true;

            this.checkInterval = setInterval(() => this.checkVolume(), this.config.interval);
            console.log('👂 RemoteAudioMonitorService started');
        } catch (e) {
            console.error('❌ Failed to start RemoteAudioMonitorService:', e);
        }
    }

    /**
     * Add a remote stream to monitor
     */
    trackStream(participantId, stream) {
        if (!this.audioContext || !stream.getAudioTracks().length) return;

        try {
            // Avoid duplicate setup
            if (this.analysers.has(participantId)) return;

            const source = this.audioContext.createMediaStreamSource(stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.5;

            source.connect(analyser); // We don't connect to destination to avoid playing audio twice (it's already played by <audio> tags or mediasoup)

            this.sources.set(participantId, source);
            this.analysers.set(participantId, analyser);

            console.log(`👂 Monitoring remote stream for ${participantId}`);
        } catch (e) {
            console.error(`❌ Error tracking stream for ${participantId}:`, e);
        }
    }

    /**
     * Remove a stream
     */
    untrackStream(participantId) {
        const source = this.sources.get(participantId);
        const analyser = this.analysers.get(participantId);

        if (source) {
            source.disconnect();
            this.sources.delete(participantId);
        }
        this.analysers.delete(participantId);
    }

    /**
     * Check volume of all tracked streams
     */
    checkVolume() {
        let maxVolume = 0;

        for (const [id, analyser] of this.analysers) {
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const volume = sum / (bufferLength * 255);
            if (volume > maxVolume) maxVolume = volume;
        }

        const now = Date.now();
        const isLoud = maxVolume > this.config.threshold;

        if (isLoud) {
            this.speakingState.lastSpeechTime = now;
        }

        // Determine effective speaking state (with hold time)
        // We consider it "speaking" if currently loud OR within hold time
        const effectivelySpeaking = isLoud || (now - this.speakingState.lastSpeechTime < this.config.holdTime);

        // Only notify on change
        if (effectivelySpeaking !== this.speakingState.isRemoteSpeaking) {
            this.speakingState.isRemoteSpeaking = effectivelySpeaking;
            if (this.onStateChange) {
                this.onStateChange(effectivelySpeaking);
            }
            // Log for debug (but avoid spam)
            if (effectivelySpeaking) {
                console.log('🔇 Remote is speaking (Echo suppression active)');
            } else {
                console.log('🔊 Remote checking ended');
            }
        }
    }

    stop() {
        this.isMonitoring = false;
        if (this.checkInterval) clearInterval(this.checkInterval);

        this.analysers.clear();
        this.sources.forEach(s => s.disconnect());
        this.sources.clear();

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        this.onStateChange = null;
    }
}

export default new RemoteAudioMonitorService();
