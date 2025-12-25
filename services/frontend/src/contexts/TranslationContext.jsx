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
import localVADService from '../services/LocalVADService';
import { useToast } from './ToastContext';
import { useWebRTC } from './WebRTCContext'; // ✅ Restore import
import { ENV } from '../config/env';

const TranslationContext = createContext();

// Feature flag: use Gateway ASR captions for remote participants (skip remote STT)
const USE_GATEWAY_ASR = true;

// 🔥 Feature flag: Barge-In - ngắt TTS khi local user bắt đầu nói
const ENABLE_BARGE_IN = true;

// 🔥 Feature flag: Ưu tiên sử dụng translation từ Gateway thay vì gọi API lại
const USE_SERVER_TRANSLATIONS = true;

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
  
  // 🔥 Auto-TTS: Track if user manually toggled TTS (overrides auto logic)
  const ttsManualOverrideRef = useRef(false);
  
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

  // 🔥 NEW: Track remote audio mute state per participant
  const remoteAudioMuteRef = useRef(new Map()); // participantId -> { wasEnabled, audioTrack }
  
  // 🔥 Ref để access remoteStreams mới nhất trong callbacks (sẽ được set sau useWebRTC)
  const remoteStreamsRef = useRef(new Map());

  const { showToast } = useToast();
  // 🔥 Lấy thêm serverTranslations và remoteStreams để control remote audio
  const { 
    participantId: myParticipantId, 
    localStream,
    remoteStreams, // Để access remote audio tracks
    serverTranslations, // Pre-translated text từ Gateway
    participants // Để biết language của remote participants
  } = useWebRTC();
  
  // 🔥 Keep ref updated với remoteStreams mới nhất - LUÔN sync
  remoteStreamsRef.current = remoteStreams;

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
   * Toggle TTS playback (internal implementation)
   * 🔥 Mute/unmute được xử lý bởi useEffect [remoteStreams, ttsEnabled] để đảm bảo sync
   * @param isManual - true nếu user toggle thủ công (override auto logic)
   */
  const toggleTTSInternal = useCallback((value, isManual = false) => {
    const newTtsEnabled = value !== undefined ? value : !ttsEnabled;

    // Avoid double toggles from repeated clicks/rerenders
    if (newTtsEnabled === ttsEnabled) {
      return;
    }

    // 🔥 Mark manual override if user toggled manually
    if (isManual) {
      ttsManualOverrideRef.current = true;
      console.log('🎚️ [Auto-TTS] Manual override set - auto-TTS disabled');
    }

    if (newTtsEnabled) {
      showToast('Live Translation enabled - Remote audio muted', 'success');
      console.log('🔊 TTS playback enabled', isManual ? '(manual)' : '(auto)');
    } else {
      showToast('Live Translation disabled - Original audio restored', 'info');
      console.log('🔇 TTS playback disabled', isManual ? '(manual)' : '(auto)');
      
      // Stop current playback
      ttsPlaybackService.stopAll();
      
      // Clear mute state tracking
      remoteAudioMuteRef.current.clear();
    }

    // 🔥 Set state - useEffect [remoteStreams, ttsEnabled] sẽ handle mute/unmute
    setTtsEnabled(newTtsEnabled);
  }, [ttsEnabled, showToast]);

  /**
   * Toggle TTS playback (public API - marks as manual override)
   */
  const toggleTTS = useCallback((value) => {
    toggleTTSInternal(value, true);
  }, [toggleTTSInternal]);

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
   * TTS-safe helpers: DISABLED - không mute local mic nữa
   * Lý do: Barge-In đã xử lý việc ngắt TTS khi user nói
   * Mute mic gây ra vấn đề: User không thể nói khi TTS đang phát
   */
  const handleTTSAudioStart = () => {
    // 🔥 DISABLED: Không mute mic nữa - Barge-In sẽ xử lý
    // Việc mute mic khiến user không thể nói khi TTS đang phát
    // và Gateway không nhận được audio → không có caption
    console.log('🔊 TTS playback started (mic NOT muted - Barge-In enabled)');
  };

  const handleTTSAudioEnd = () => {
    // 🔥 DISABLED: Không cần restore mic vì không mute
    console.log('🔊 TTS playback ended');
  };

  /**
   * 🔥 NEW: Mute remote audio track khi TTS đang phát
   * Logic kiểm tra ngôn ngữ đã được xử lý ở ingestGatewayCaption
   */
  const muteRemoteAudio = useCallback((speakerId) => {
    // 🔥 Dùng ref để có giá trị mới nhất
    const remoteStream = remoteStreamsRef.current?.get?.(speakerId);
    if (!remoteStream) {
      console.log(`⚠️ No remote stream found for ${speakerId}`);
      return false;
    }

    const audioTrack = remoteStream.getAudioTracks()?.[0];
    if (!audioTrack) {
      console.log(`⚠️ No audio track found for ${speakerId}`);
      return false;
    }

    // Lưu trạng thái và mute
    const muteState = remoteAudioMuteRef.current.get(speakerId) || { depth: 0, wasEnabled: null };
    
    if (muteState.depth === 0) {
      muteState.wasEnabled = audioTrack.enabled;
      if (audioTrack.enabled) {
        audioTrack.enabled = false;
        console.log(`🔇 Muting remote audio for ${speakerId}`);
      }
    }
    muteState.depth += 1;
    remoteAudioMuteRef.current.set(speakerId, muteState);
    
    return true; // Đã mute
  }, []); // Không cần dependency vì dùng ref

  /**
   * 🔥 NEW: Restore remote audio track sau khi TTS phát xong
   */
  const unmuteRemoteAudio = useCallback((speakerId) => {
    const muteState = remoteAudioMuteRef.current.get(speakerId);
    if (!muteState) return;

    if (muteState.depth > 0) {
      muteState.depth -= 1;
    }

    if (muteState.depth === 0 && muteState.wasEnabled !== null) {
      // 🔥 Dùng ref để có giá trị mới nhất
      const remoteStream = remoteStreamsRef.current?.get?.(speakerId);
      const audioTrack = remoteStream?.getAudioTracks()?.[0];
      
      if (audioTrack && muteState.wasEnabled) {
        audioTrack.enabled = true;
        console.log(`🔊 Restoring remote audio for ${speakerId}`);
      }
      
      remoteAudioMuteRef.current.delete(speakerId);
    }
  }, []); // Không cần dependency vì dùng ref

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
   * 🔥 Helper: Check xem Gateway đã gửi translation cho text này chưa
   * Nếu có thì dùng luôn, không cần gọi Translation API
   */
  const getServerTranslation = useCallback((participantId, text, tgtLang) => {
    if (!USE_SERVER_TRANSLATIONS || !serverTranslations) return null;
    
    const key = `${participantId}-${text?.trim()}-${tgtLang}`;
    const cached = serverTranslations.get(key);
    
    if (cached && cached.translatedText) {
      console.log('✅ Using server-side translation (no duplicate API call):', {
        key: key.substring(0, 50) + '...',
        translatedText: cached.translatedText.substring(0, 30) + '...'
      });
      return cached.translatedText;
    }
    
    return null;
  }, [serverTranslations]);

  /**
   * Ingest caption từ Gateway (ASR server) và chạy MT/TTS per-viewer
   * 🔥 OPTIMIZED: Check serverTranslations trước khi gọi Translation API
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

      // 🔥 LOGIC FIX: 
      // - Remote speaker nói ngôn ngữ X (sourceLanguage từ caption)
      // - User muốn nghe bằng ngôn ngữ của mình (myLanguage)
      // - Dịch: sourceLanguage → myLanguage
      // - TTS phát bằng: myLanguage
      const userLanguage = myLanguageRef.current || myLanguage || 'vi';
      
      // Check xem Gateway đã translate chưa (dùng myLanguage làm target)
      let translated = getServerTranslation(speakerKey, caption.text.trim(), userLanguage);
      
      if (!translated) {
        // Fallback: Gọi Translation API - dịch từ source → user's language
        console.log(`⚡ No server translation found, translating ${sourceLanguage} → ${userLanguage}...`);
        translated = await translateText(normalizedText, sourceLanguage, userLanguage);
      }

      // TTS nếu bật và không phải self
      // 🔊 Logic đơn giản: Khi TTS bật → remote audio đã mute → phát TTS bằng ngôn ngữ của user
      if (ttsEnabled && caption.speakerId && caption.speakerId !== myParticipantId) {
        console.log(`🎤 TTS enabled, playing translated audio in ${userLanguage} for ${caption.speakerId}`);
        
        // TTS phát bằng ngôn ngữ của USER (myLanguage), không phải targetLanguage
        const audioBase64 = await synthesizeSpeech(translated, userLanguage);
        await ttsPlaybackService.playTranslatedAudio(caption.speakerId, audioBase64, {
          immediate: true,
          voice: ttsVoice,
          lang: userLanguage,
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
  }, [enabled, myLanguage, ttsEnabled, myParticipantId, getServerTranslation]);

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

  // 🔥 Barge-In: Start LocalVAD khi có localStream và translation enabled
  // Khi local user nói, ngắt TTS đang phát (nếu có)
  useEffect(() => {
    if (!ENABLE_BARGE_IN || !enabled || !ttsEnabled || !localStream) {
      localVADService.stop();
      return;
    }

    // Start LocalVAD với callbacks
    localVADService.start(localStream, {
      onSpeechStart: () => {
        // Barge-In: Ngắt TTS ngay lập tức khi local user nói
        const wasPlaying = ttsPlaybackService.interruptForBargeIn(true);
        
        if (wasPlaying) {
          console.log('🛑 [Barge-In] TTS interrupted - local user is speaking');
          
          // 🔥 Dùng ref để có giá trị mới nhất - Unmute remote audio cho tất cả participants
          const currentRemoteStreams = remoteStreamsRef.current;
          if (currentRemoteStreams) {
            for (const [speakerId] of currentRemoteStreams) {
              unmuteRemoteAudio(speakerId);
            }
          }
        }
      },
      onSpeechEnd: () => {
        console.log('🤐 [Barge-In] Local user stopped speaking');
        // Không cần làm gì - pipeline tiếp tục bình thường
      }
    });

    console.log('🎤 [Barge-In] LocalVAD started for local speech detection');

    return () => {
      localVADService.stop();
      console.log('🎤 [Barge-In] LocalVAD stopped');
    };
  }, [enabled, ttsEnabled, localStream, unmuteRemoteAudio]);

  // 🔥 Auto-TTS: Tự động bật/tắt TTS dựa trên language pair
  // - Cùng ngôn ngữ: tắt TTS (không cần dịch)
  // - Khác ngôn ngữ: bật TTS
  // - Chỉ hoạt động khi user chưa toggle manual
  useEffect(() => {
    // Bỏ qua nếu user đã toggle manual hoặc không có participants
    if (ttsManualOverrideRef.current || !participants || participants.size === 0) {
      return;
    }

    // Kiểm tra ngôn ngữ của remote participants
    let hasRemoteWithDifferentLanguage = false;
    
    for (const [remotePId, pData] of participants) {
      // Skip local participant
      if (remotePId === myParticipantId) continue;
      
      const remoteLanguage = pData.sourceLanguage || pData.targetLanguage;
      
      if (remoteLanguage && remoteLanguage !== myLanguage) {
        hasRemoteWithDifferentLanguage = true;
        break;
      }
    }

    // Auto-toggle TTS based on language pair (không gọi toggleTTS để tránh mark manual override)
    if (hasRemoteWithDifferentLanguage && !ttsEnabled) {
      console.log('🔄 [Auto-TTS] Khác ngôn ngữ detected → Bật TTS');
      toggleTTSInternal(true, false);
    } else if (!hasRemoteWithDifferentLanguage && ttsEnabled) {
      console.log('🔄 [Auto-TTS] Cùng ngôn ngữ detected → Tắt TTS');
      toggleTTSInternal(false, false);
    }
  }, [myLanguage, myParticipantId, participants, ttsEnabled, toggleTTSInternal]);

  // Reset manual override khi rời phòng hoặc participants thay đổi đáng kể
  useEffect(() => {
    if (!participants || participants.size === 0) {
      // Reset manual override khi không còn ai trong room
      ttsManualOverrideRef.current = false;
      console.log('🔄 [Auto-TTS] Reset manual override (empty room)');
    }
  }, [participants]);

  // 🔥 Auto-sync remote audio mute state với TTS enabled state
  // Đảm bảo trạng thái mute LUÔN đúng theo ttsEnabled và remoteStreams hiện tại
  // - TTS enabled (ttsEnabled=true) => remote audio muted (track.enabled=false)
  // - TTS disabled (ttsEnabled=false) => remote audio unmuted (track.enabled=true)
  useEffect(() => {
    if (!remoteStreams || remoteStreams.size === 0) {
      return;
    }

    // desiredEnabled = !ttsEnabled
    // ttsEnabled=true => track should be disabled (muted)
    // ttsEnabled=false => track should be enabled (unmuted)
    const desiredTrackEnabled = !ttsEnabled;

    for (const [participantId, stream] of remoteStreams.entries()) {
      const audioTracks = stream?.getAudioTracks?.() || [];
      for (const track of audioTracks) {
        if (track.enabled !== desiredTrackEnabled) {
          track.enabled = desiredTrackEnabled;
          console.log(
            `🔊 [Auto-Sync-Mute] ${participantId} track.enabled=${track.enabled} (ttsEnabled=${ttsEnabled})`
          );
        }
      }
    }
  }, [remoteStreams, ttsEnabled]);

  // Cleanup khi unmount
  useEffect(() => {
    return () => {
      audioExtractionService.stopAll();
      ttsPlaybackService.stopAll();
      localVADService.stop();
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
    ttsPlaybackService,
    localVADService,
    
    // Barge-In status
    bargeInEnabled: ENABLE_BARGE_IN
  };

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
};
