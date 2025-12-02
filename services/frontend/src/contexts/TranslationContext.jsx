/**
 * TranslationContext - Quản lý real-time translation pipeline
 * 
 * Pipeline Flow:
 * 1. Audio Extraction (AudioWorklet) → PCM chunks
 * 2. STT Service (/api/v1/transcribe-stream) → Text
 * 3. Translation Service (/translate) → Translated text
 * 4. TTS Service (/synthesize) → Audio
 * 5. Playback (Web Audio API)
 * 
 * Features:
 * - Per-participant translation settings
 * - Language pair management
 * - Caching cho repeated phrases
 * - Toast notifications cho status
 * - Performance monitoring
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import audioExtractionService from '../services/AudioExtractionService';
import ttsPlaybackService from '../services/TTSPlaybackService';
import { useToast } from './ToastContext';
import { useWebRTC } from './WebRTCContext'; // ✅ Restore import
import { ENV } from '../config/env';

const TranslationContext = createContext();

// Feature flag: use Gateway ASR captions for remote participants (skip remote STT)
const USE_GATEWAY_ASR = true;

// Convert PCM Int16Array to base64 for streaming STT API
const pcm16ToBase64 = (pcmData) => {
  const uint8Array = new Uint8Array(pcmData.buffer);
  let binary = '';

  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binary);
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslation must be used within TranslationProvider');
  }
  return context;
};

export const TranslationProvider = ({ children }) => {
  // Translation state
  const [enabled, setEnabled] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true); // Enable TTS playback by default
  const [participantSettings, setParticipantSettings] = useState(new Map());
  const [ttsMode, setTtsMode] = useState('generic'); // 'generic' | 'clone'
  const [ttsReferenceId, setTtsReferenceId] = useState(null); // optional for clone mode
  const [ttsVoice, setTtsVoice] = useState('default'); // 'default' | 'male' | 'female'

  // Global language settings
  const [myLanguage, setMyLanguage] = useState('vi'); // User's language
  const [targetLanguage, setTargetLanguage] = useState('en'); // Translation target
  
  // Refs for accessing latest state in callbacks/closures
  const myLanguageRef = useRef(myLanguage);
  const targetLanguageRef = useRef(targetLanguage);
  const ttsEnabledRef = useRef(ttsEnabled);

  useEffect(() => { myLanguageRef.current = myLanguage; }, [myLanguage]);
  useEffect(() => { targetLanguageRef.current = targetLanguage; }, [targetLanguage]);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // Captions state
  const [captions, setCaptions] = useState([]); // Array of { participantId, text, translatedText, timestamp }

  // Performance metrics
  const [metrics, setMetrics] = useState({
    totalTranslations: 0,
    avgLatency: 0,
    errors: 0
  });

  // Cache cho repeated phrases
  const translationCache = useRef(new Map()); // key: `${text}:${srcLang}:${tgtLang}` → translation

  // 🔥 NEW: Sentence buffering for better translation quality
  const transcriptionBuffers = useRef(new Map()); // participantId → { chunks: [], lastUpdate: timestamp, timeoutId: null }

  // 🔥 Utterance-based STT (Offline VI) with simple RMS-VAD segmentation
  const utteranceStates = useRef(new Map()); // participantId → { chunks: Int16Array[], totalSamples, isSpeaking, lastSpeech }
  const USE_VI_UTTERANCE_MODE = true; // Toggle để route VI qua utterance endpoint
  const USE_GATEWAY_ASR = true;
  const VAD_CONFIG = {
    rmsThreshold: 0.01,    // Normalized RMS threshold (~-40 dB)
    silenceMs: 800,        // Silence để kết thúc utterance
    minUtteranceMs: 500,   // Bỏ qua utterance quá ngắn
    maxUtteranceMs: 6000   // Flush bắt buộc nếu quá dài
  };

  // TTS-safe mic guard: auto mute local mic during TTS playback to avoid echo-loop
  const ttsMicGuardRef = useRef({
    depth: 0,
    micWasEnabled: null
  });
  // Deduplicate gateway captions to avoid double processing
  const seenGatewayCaptionIds = useRef(new Set());

  // Detect backend translation API shape (VinAI vs NLLB)
  const translationServiceTypeRef = useRef(null); // 'vinai' | 'nllb' | 'unknown'
  
  // Deduplication by content (fix for duplicate events with different IDs)
  const lastProcessedCaptionRef = useRef(new Map()); // participantId -> { text, timestamp }

  const { showToast } = useToast();
  const { participantId: myParticipantId, localStream } = useWebRTC(); // ✅ Access participant + local audio track for TTS-safe mode

  // Service URLs (use centralized ENV config)
  const STT_SERVICE_URL = ENV.STT_SERVICE_URL;
  const TRANSLATION_SERVICE_URL = ENV.TRANSLATION_SERVICE_URL;
  const TTS_SERVICE_URL = ENV.TTS_SERVICE_URL;

  /**
   * Enable/disable translation
   */
  const toggleTranslation = useCallback((value) => {
    const newEnabled = value !== undefined ? value : !enabled;

    // Avoid redundant re-renders/log spam
    if (newEnabled === enabled) {
      return;
    }

    setEnabled(newEnabled);

    if (newEnabled) {
      showToast('Translation enabled', 'success');
      console.log('🌐 Translation enabled', { myLanguage, targetLanguage });
    } else {
      showToast('Translation disabled', 'info');
      console.log('🌐 Translation disabled');

      // Stop all extractions and playback
      audioExtractionService.stopAll();
      ttsPlaybackService.stopAll();
    }
  }, [enabled, myLanguage, targetLanguage, showToast]);

  /**
   * Toggle TTS playback
   */
  const toggleTTS = useCallback((value) => {
    const newTtsEnabled = value !== undefined ? value : !ttsEnabled;

    // Avoid double toggles from repeated clicks/rerenders
    if (newTtsEnabled === ttsEnabled) {
      return;
    }

    setTtsEnabled(newTtsEnabled);

    if (newTtsEnabled) {
      showToast('TTS playback enabled', 'success');
      console.log('🔊 TTS playback enabled');
    } else {
      showToast('TTS playback disabled - Caption only mode', 'info');
      console.log('🔇 TTS playback disabled');
      // Stop current playback
      ttsPlaybackService.stopAll();
    }
  }, [ttsEnabled, showToast]);

  /**
   * Setup translation cho một participant
   */
  const setupParticipantTranslation = useCallback(async (participantId, audioTrack) => {
    if (!enabled) {
      console.log(`⏸️ Translation disabled, skipping setup for ${participantId}`);
      return;
    }

    // Khi dùng Gateway ASR, bỏ qua setup STT cho tất cả (remote + local) để tránh double STT
    if (USE_GATEWAY_ASR) {
      console.log(`⏭️ Skipping STT setup for ${participantId} (Gateway ASR mode)`);
      return;
    }

    try {
      console.log(`🔧 Setting up translation for ${participantId}`);

      // Setup audio extraction với callback
      await audioExtractionService.setupExtraction(
        participantId,
        audioTrack,
        (audioChunk) => handleAudioChunk(participantId, audioChunk)
      );

      // Initialize participant settings
      setParticipantSettings(prev => {
        const newMap = new Map(prev);
        newMap.set(participantId, {
          sourceLanguage: 'auto', // Auto-detect
          targetLanguage: targetLanguage,
          enabled: true,
          transcriptionBuffer: []
        });
        return newMap;
      });

      console.log(`✅ Translation setup complete for ${participantId}`);

    } catch (error) {
      console.error(`❌ Error setting up translation for ${participantId}:`, error);
      showToast(`Translation setup failed: ${error.message}`, 'error');
    }
  }, [enabled, targetLanguage, showToast]);

  /**
   * Enhanced capitalization normalization với Vietnamese proper noun detection
   */
  const normalizeCapitalization = (text) => {
    if (!text) return text;

    // Giữ nguyên hoa/thường gốc, chỉ đảm bảo chữ cái đầu câu viết hoa nếu đang ở dạng toàn thường
    const trimmed = text.trim();
    if (trimmed.length === 0) return trimmed;

    // Nếu text đang toàn chữ hoa, chuyển về sentence case để tránh hiển thị toàn caps
    const isAllCaps = trimmed === trimmed.toUpperCase();
    if (isAllCaps) {
      const lowered = trimmed.toLowerCase();
      return lowered.charAt(0).toUpperCase() + lowered.slice(1);
    }

    // Nếu không, viết hoa chữ cái đầu câu
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  };

  /**
   * Stop translation cho participant
   */
  const stopParticipantTranslation = useCallback(async (participantId) => {
    console.log(`🛑 Stopping translation for ${participantId}`);

    await audioExtractionService.stopExtraction(participantId);
    ttsPlaybackService.stopPlayback(participantId);

    setParticipantSettings(prev => {
      const newMap = new Map(prev);
      newMap.delete(participantId);
      return newMap;
    });
  }, []);

  /**
   * Handle audio chunk từ AudioWorklet với sentence buffering
   */
  const handleAudioChunk = useCallback(async (participantId, audioChunk) => {
    if (USE_GATEWAY_ASR) {
      // Gateway chịu trách nhiệm STT, bỏ qua client STT
      return;
    }
    // Access current state via refs to avoid closure staleness
    const currentMyLanguage = myLanguageRef.current;
    const currentTargetLanguage = targetLanguageRef.current;
    const currentTtsEnabled = ttsEnabledRef.current;

    const useUtteranceMode = USE_VI_UTTERANCE_MODE && currentMyLanguage === 'vi';
    // Utterance mode (Offline VI) với VAD segmentation
    if (useUtteranceMode) {
      await handleAudioChunkUtterance(participantId, audioChunk);
      return;
    }

    const startTime = Date.now();

    try {
      const { pcmData, sampleRate, duration, chunkIndex } = audioChunk;

      // Step 1: STT - Transcribe audio (streaming endpoint expects base64 PCM)
      const transcription = await transcribeAudio({
        participantId,
        pcmData,
        sampleRate,
        chunkIndex,
        language: currentMyLanguage
      });

      // Skip empty/interim chunks
      if (!transcription || !transcription.text || transcription.text.trim() === '') {
        console.log(`⏭️ Empty transcription for ${participantId}, skipping`);
        return;
      }

      if (transcription.is_final === false) {
        console.log(`⏭️ Interim transcription for ${participantId}, waiting for final`);
        return;
      }

      // 🔥 BUFFERING LOGIC: Accumulate chunks into sentences
      const buffer = transcriptionBuffers.current.get(participantId) || {
        chunks: [],
        lastUpdate: Date.now(),
        timeoutId: null
      };

      // Clear existing timeout
      if (buffer.timeoutId) {
        clearTimeout(buffer.timeoutId);
      }

      // Add chunk to buffer
      buffer.chunks.push(transcription.text.trim());
      buffer.lastUpdate = Date.now();

      // Set flush timeout (3 seconds of silence)
      const flushBuffer = async () => {
        const currentBuffer = transcriptionBuffers.current.get(participantId);
        if (!currentBuffer || currentBuffer.chunks.length === 0) return;

        // Combine all chunks into complete sentence
        const fullSentence = currentBuffer.chunks.join(' ').trim();
        transcriptionBuffers.current.delete(participantId);

        // Skip very short sentences
        if (fullSentence.length < 3) {
          console.log(`⏭️ Sentence too short, skipping: "${fullSentence}"`);
          return;
        }

        console.log(`📝 Complete sentence for ${participantId} (${currentBuffer.chunks.length} chunks):`, fullSentence);

        // Normalize capitalization
        const normalizedText = normalizeCapitalization(fullSentence);

        // Step 2: Translation - Translate complete sentence
        const sourceLanguage = transcription.language || 'auto';
        const translated = await translateText(
          normalizedText,
          sourceLanguage,
          currentTargetLanguage
        );

        console.log(`🌐 Translation for ${participantId}:`, translated);

        // Step 3: TTS - Only play for REMOTE participants (not self)
        if (currentTtsEnabled && participantId !== myParticipantId) {
          const audioBase64 = await synthesizeSpeech(translated, currentTargetLanguage);

          await ttsPlaybackService.playTranslatedAudio(participantId, audioBase64, {
            immediate: true,
            voice: ttsVoice,
            lang: currentTargetLanguage,
            onStart: () => handleTTSAudioStart(),
            onEnd: () => handleTTSAudioEnd()
          });
        } else if (participantId === myParticipantId) {
          console.log(`🔇 Skipping TTS for own audio (self=${myParticipantId})`);
        } else {
          console.log(`🔇 TTS disabled, caption only mode`);
        }

        // Update captions with complete sentence
        const caption = {
          id: `${participantId}-${Date.now()}`,
          participantId,
          text: normalizedText,
          translatedText: translated,
          timestamp: Date.now(),
          language: sourceLanguage
        };

        setCaptions(prev => [...prev.slice(-9), caption]); // Keep last 10

        // Update metrics
        const latency = Date.now() - startTime;
        setMetrics(prev => ({
          totalTranslations: prev.totalTranslations + 1,
          avgLatency: (prev.avgLatency * prev.totalTranslations + latency) / (prev.totalTranslations + 1),
          errors: prev.errors
        }));

        console.log(`✅ Translation pipeline complete for ${participantId}`, {
          latency: `${latency}ms`,
          sentence: normalizedText.substring(0, 50) + '...'
        });
      };

      buffer.timeoutId = setTimeout(flushBuffer, 3000); // 3 second buffer timeout
      transcriptionBuffers.current.set(participantId, buffer);

      console.log(`⏸️ Buffering chunk ${buffer.chunks.length} for ${participantId}: "${transcription.text}"`);

    } catch (error) {
      console.error(`❌ Translation pipeline error for ${participantId}:`, error);

      setMetrics(prev => ({
        ...prev,
        errors: prev.errors + 1
      }));
    }
  }, [myParticipantId, showToast]); // Removed state deps, using refs

  /**
   * Simple RMS-based VAD + utterance segmentation (Offline VI)
   * - Accumulate until speech ends (silenceMs) or maxUtteranceMs reached
   * - Flush as a single utterance to offline VI endpoint
   */
  const handleAudioChunkUtterance = useCallback(async (participantId, audioChunk) => {
    const { pcmData, sampleRate } = audioChunk;

    // Compute normalized RMS (0..1)
    const rms = computeRmsInt16(pcmData);
    const now = Date.now();

    const state = utteranceStates.current.get(participantId) || {
      chunks: [],
      totalSamples: 0,
      isSpeaking: false,
      lastSpeech: 0
    };

    const durationMs = state.totalSamples / sampleRate * 1000;

    if (rms > VAD_CONFIG.rmsThreshold) {
      state.isSpeaking = true;
      state.lastSpeech = now;
      state.chunks.push(pcmData);
      state.totalSamples += pcmData.length;

      if (durationMs >= VAD_CONFIG.maxUtteranceMs) {
        await flushUtterance(participantId, state, sampleRate);
        // flushUtterance sẽ tự reset state trong utteranceStates
        return;
      }
    } else {
      if (state.isSpeaking && (now - state.lastSpeech) >= VAD_CONFIG.silenceMs) {
        await flushUtterance(participantId, state, sampleRate);
        // flushUtterance sẽ tự reset state trong utteranceStates
        return;
      }
    }

    utteranceStates.current.set(participantId, state);
  }, [myParticipantId]); // Refs handled inside flushUtterance

  /**
   * Flush current utterance (if any) and run STT -> Translate -> Caption/TTS
   */
  const flushUtterance = useCallback(async (participantId, state, sampleRate) => {
    const currentTargetLanguage = targetLanguageRef.current;
    const currentTtsEnabled = ttsEnabledRef.current;

    if (!state || state.chunks.length === 0) {
      resetUtteranceState(participantId);
      return;
    }

    const totalMs = state.totalSamples / sampleRate * 1000;
    if (totalMs < VAD_CONFIG.minUtteranceMs) {
      resetUtteranceState(participantId);
      return;
    }

    const startTime = Date.now();
    const merged = mergeInt16Chunks(state.chunks, state.totalSamples);
    resetUtteranceState(participantId);

    try {
      const transcription = await transcribeUtterance({
        participantId,
        pcmData: merged,
        sampleRate
      });

      if (!transcription || !transcription.text || transcription.text.trim() === '') {
        console.log(`⏭️ Empty utterance transcription for ${participantId}, skipping`);
        return;
      }

      const normalizedText = normalizeCapitalization(transcription.text.trim());
      const sourceLanguage = transcription.language || 'vi';
      const translated = await translateText(
        normalizedText,
        sourceLanguage,
        currentTargetLanguage
      );

      if (currentTtsEnabled && participantId !== myParticipantId) {
        const audioBase64 = await synthesizeSpeech(translated, currentTargetLanguage);
        await ttsPlaybackService.playTranslatedAudio(participantId, audioBase64, {
          immediate: true,
          voice: ttsVoice,
          lang: currentTargetLanguage,
          onStart: () => handleTTSAudioStart(),
          onEnd: () => handleTTSAudioEnd()
        });
      }

      const caption = {
        id: `${participantId}-${Date.now()}`,
        participantId,
        text: normalizedText,
        translatedText: translated,
        timestamp: Date.now(),
        language: sourceLanguage
      };
      setCaptions(prev => [...prev.slice(-9), caption]);

      const latency = Date.now() - startTime;
      setMetrics(prev => ({
        totalTranslations: prev.totalTranslations + 1,
        avgLatency: (prev.avgLatency * prev.totalTranslations + latency) / (prev.totalTranslations + 1),
        errors: prev.errors
      }));

      console.log(`✅ Utterance pipeline complete for ${participantId}`, {
        latency: `${latency}ms`,
        sentence: normalizedText.substring(0, 50) + '...'
      });
    } catch (error) {
      console.error(`❌ Utterance pipeline error for ${participantId}:`, error);
      setMetrics(prev => ({ ...prev, errors: prev.errors + 1 }));
    }
  }, [myParticipantId]);

  const resetUtteranceState = (participantId) => {
    utteranceStates.current.set(participantId, {
      chunks: [],
      totalSamples: 0,
      isSpeaking: false,
      lastSpeech: 0
    });
  };

  const computeRmsInt16 = (pcmInt16) => {
    let sumSq = 0;
    for (let i = 0; i < pcmInt16.length; i++) {
      const v = pcmInt16[i] / 32768;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / pcmInt16.length);
  };

  const mergeInt16Chunks = (chunks, totalSamples) => {
    const merged = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  };

  /**
   * TTS-safe helpers: mute local mic while translated audio is playing
   */
  const handleTTSAudioStart = () => {
    const guard = ttsMicGuardRef.current;
    const audioTrack = localStream?.getAudioTracks?.()[0];
    if (!audioTrack) {
      return;
    }

    if (guard.depth === 0) {
      // Save current mic state and mute if it was enabled
      guard.micWasEnabled = audioTrack.enabled;
      if (audioTrack.enabled) {
        audioTrack.enabled = false;
        console.log('🔇 TTS-safe: muting local mic during TTS playback');
      }
    }
    guard.depth += 1;
  };

  const handleTTSAudioEnd = () => {
    const guard = ttsMicGuardRef.current;
    const audioTrack = localStream?.getAudioTracks?.()[0];

    if (guard.depth > 0) {
      guard.depth -= 1;
    }

    if (guard.depth === 0 && guard.micWasEnabled && audioTrack) {
      // Only restore if mic was originally enabled
      audioTrack.enabled = true;
      console.log('🎤 TTS-safe: restoring local mic after TTS playback');
      guard.micWasEnabled = null;
    }
  };

  /**
   * Transcribe audio với STT service
   */
  const transcribeAudio = async ({ participantId, pcmData, sampleRate, chunkIndex, language }) => {
    const audioBase64 = pcm16ToBase64(pcmData);

    const response = await fetch(`${STT_SERVICE_URL}/api/v1/transcribe-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_id: participantId,
        audio_data: audioBase64,
        sample_rate: sampleRate,
        channels: 1,
        format: 'pcm16',
        language: language || 'auto',
        chunk_id: chunkIndex
      })
    });

    if (!response.ok) {
      console.error('❌ STT request failed', response.status, response.statusText);
      throw new Error(`STT failed: ${response.status}`);
    }

    const result = await response.json();
    return result;
  };

  /**
   * Transcribe utterance (Offline VI endpoint)
   */
  const transcribeUtterance = async ({ participantId, pcmData, sampleRate }) => {
    const audioBase64 = pcm16ToBase64(pcmData);

    const response = await fetch(`${STT_SERVICE_URL}/api/v1/transcribe-vi-utterance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_id: participantId,
        audio_data: audioBase64,
        sample_rate: sampleRate,
        channels: 1,
        format: 'pcm16',
        language: 'vi'
      })
    });

    if (!response.ok) {
      console.error('❌ Utterance STT request failed', response.status, response.statusText);
      throw new Error(`Utterance STT failed: ${response.status}`);
    }

    const result = await response.json();
    return result;
  };

  /**
   * Translate text với Translation service
   */
  const detectTranslationServiceType = async () => {
    if (translationServiceTypeRef.current) {
      return translationServiceTypeRef.current;
    }

    // Use configured type if set (skip detection)
    const configuredType = (ENV.TRANSLATION_SERVICE_TYPE || '').toLowerCase();
    if (configuredType && configuredType !== 'auto') {
      console.log(`🔧 Using configured translation service type: ${configuredType}`);
      translationServiceTypeRef.current = configuredType;
      return configuredType;
    }

    try {
      const res = await fetch(`${TRANSLATION_SERVICE_URL}/`);
      if (res.ok) {
        const data = await res.json();
        const serviceName = (data.service || '').toLowerCase();

        if (serviceName.includes('vinai')) {
          translationServiceTypeRef.current = 'vinai';
        } else {
          translationServiceTypeRef.current = 'nllb';
        }
      } else {
        translationServiceTypeRef.current = 'unknown';
      }
    } catch (e) {
      console.warn('⚠️ Could not detect translation service type, defaulting to NLLB-style API', e);
      translationServiceTypeRef.current = 'unknown';
    }

    return translationServiceTypeRef.current;
  };

  const translateText = async (text, srcLang, tgtLang) => {
    // Normalize language codes (handle cases like "vi-VN" or "auto")
    let normalizedSrc = (srcLang || myLanguage || 'vi').split('-')[0];
    let normalizedTgt = (tgtLang || targetLanguage || (normalizedSrc === 'vi' ? 'en' : 'vi')).split('-')[0];

    // Check cache
    const cacheKey = `${text}:${normalizedSrc}:${normalizedTgt}`;
    if (translationCache.current.has(cacheKey)) {
      console.log('✅ Translation cache hit');
      return translationCache.current.get(cacheKey);
    }

    const serviceType = await detectTranslationServiceType();

    let response;

    if (serviceType === 'vinai') {
      const direction =
        normalizedSrc === 'vi' && normalizedTgt === 'en'
          ? 'vi2en'
          : normalizedSrc === 'en' && normalizedTgt === 'vi'
          ? 'en2vi'
          : normalizedSrc === 'vi'
          ? 'vi2en'
          : 'en2vi';

      response = await fetch(`${TRANSLATION_SERVICE_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          direction
        })
      });
    } else {
      // Default: NLLB-style generic translation service
      response = await fetch(`${TRANSLATION_SERVICE_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          src_lang: normalizedSrc,
          tgt_lang: normalizedTgt,
          use_cache: true
        })
      });
    }

    if (!response.ok) {
      throw new Error(`Translation failed: ${response.status}`);
    }

    const result = await response.json();
    const translated =
      result.translated_text || // NLLB service
      result.text ||            // VinAI service
      '';                       // Fallback (should not happen)

    // Cache result
    translationCache.current.set(cacheKey, translated);

    return translated;
  };

  /**
   * Synthesize speech với TTS service
   */
  const synthesizeSpeech = async (text, language) => {
    const normalizedLang = (language || targetLanguage || 'en').split('-')[0];

    const payload = {
      text,
      // Backward-compat fields
      language: normalizedLang, // legacy field
      // New fields for Piper/OpenVoice
      lang: normalizedLang,
      mode: ttsMode || 'generic',
    };

    if (ttsReferenceId) {
      payload.reference_id = ttsReferenceId;
    }

    const response = await fetch(`${TTS_SERVICE_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`TTS failed: ${response.status}`);
    }

    const result = await response.json();
    return result.audio_base64 || result.audio || '';
  };

  /**
   * Clear captions
   */
  const clearCaptions = useCallback(() => {
    setCaptions([]);
  }, []);

  /**
   * Ingest caption từ Gateway (ASR server) và chạy MT/TTS per-viewer
   */
  const ingestGatewayCaption = useCallback(async (caption) => {
    try {
      if (!enabled) return;
      if (!caption || !caption.text || caption.text.trim() === '') return;
      
      // 1. Check duplicate by ID (legacy check)
      if (caption.id && seenGatewayCaptionIds.current.has(caption.id)) {
        return;
      }
      
      // 2. Check duplicate by Content & Time (fix for Gateway sending same text with new IDs)
      const speakerKey = caption.speakerId || caption.participantId || 'unknown';
      const lastCap = lastProcessedCaptionRef.current.get(speakerKey);
      const now = Date.now();
      const capTime = caption.timestamp || now;
      
      if (lastCap) {
        const timeDiff = Math.abs(capTime - lastCap.timestamp);
        // Nếu nội dung giống hệt và thời gian cách nhau < 2s -> coi là duplicate
        if (lastCap.text === caption.text.trim() && timeDiff < 2000) {
          console.log(`♻️ Duplicate caption content detected for ${caption.speakerId}: "${caption.text}" (diff: ${timeDiff}ms)`);
          // Vẫn add ID vào set để chặn các lần sau nếu dùng ID cũ
          if (caption.id) seenGatewayCaptionIds.current.add(caption.id);
          return;
        }
      }

      if (caption.id) {
        seenGatewayCaptionIds.current.add(caption.id);
      }
      
      // Update last processed
      lastProcessedCaptionRef.current.set(speakerKey, {
        text: caption.text.trim(),
        timestamp: capTime
      });

      const normalizedText = normalizeCapitalization(caption.text.trim());
      const sourceLanguage = caption.language || 'auto';

      // Translate nếu bật
      const translated = await translateText(normalizedText, sourceLanguage, targetLanguage);

      // TTS nếu bật và không phải self
      if (ttsEnabled && caption.speakerId && caption.speakerId !== myParticipantId) {
        const audioBase64 = await synthesizeSpeech(translated, targetLanguage);
        await ttsPlaybackService.playTranslatedAudio(caption.speakerId, audioBase64, {
          immediate: true,
          voice: ttsVoice,
          lang: targetLanguage,
          onStart: () => handleTTSAudioStart(),
          onEnd: () => handleTTSAudioEnd()
        });
      }

      const nextCaption = {
        id: caption.id || `${caption.speakerId || 'unknown'}-${caption.timestamp || Date.now()}`,
        participantId: caption.speakerId,
        text: normalizedText,
        translatedText: translated,
        timestamp: caption.timestamp || Date.now(),
        language: sourceLanguage
      };

      setCaptions(prev => [...prev.slice(-9), nextCaption]);
    } catch (err) {
      console.error('❌ ingestGatewayCaption error:', err);
    }
  }, [enabled, targetLanguage, ttsEnabled, myParticipantId]);

  /**
   * Get translation stats
   */
  const getStats = useCallback(() => {
    return {
      enabled,
      participantCount: participantSettings.size,
      captionCount: captions.length,
      cacheSize: translationCache.current.size,
      metrics,
      audioExtraction: audioExtractionService.getStats(),
      ttsPlayback: ttsPlaybackService.getStats()
    };
  }, [enabled, participantSettings, captions, metrics]);

  // Cleanup khi unmount
  useEffect(() => {
    return () => {
      audioExtractionService.stopAll();
      ttsPlaybackService.stopAll();
    };
  }, []);

  const value = {
    // State
    enabled,
    myLanguage,
    targetLanguage,
    captions,
    metrics,
    participantSettings,
    ttsEnabled,
    ttsMode,
    ttsReferenceId,
    ttsVoice,

    // Actions
    toggleTranslation,
    toggleTTS,
    setMyLanguage,
    setTargetLanguage,
    setTtsMode,
    setTtsReferenceId,
    setTtsVoice,
    setupParticipantTranslation,
    stopParticipantTranslation,
    clearCaptions,
    ingestGatewayCaption,
    getStats,

    // Services (expose for advanced usage)
    audioExtractionService,
    ttsPlaybackService
  };

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
};
