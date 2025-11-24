import { useEffect, useState, useRef } from 'react';

/**
 * Custom Hook - Phát hiện audio level từ MediaStream
 * Sử dụng Web Audio API để analyze audio
 * 
 * @param {MediaStream} stream - MediaStream với audio track
 * @param {number} threshold - Ngưỡng decibels để coi là "speaking" (default: -50)
 * @param {number} smoothingTimeConstant - Smoothing factor (0-1, default: 0.8)
 * @returns {boolean} isSpeaking - True nếu đang nói
 */
export const useAudioLevel = (stream, threshold = -50, smoothingTimeConstant = 0.8) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationFrameRef = useRef(null);
  
  useEffect(() => {
    if (!stream) {
      setIsSpeaking(false);
      return;
    }
    
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !audioTrack.enabled) {
      setIsSpeaking(false);
      return;
    }
    
    try {
      // Tạo AudioContext
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      // Tạo AnalyserNode
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = smoothingTimeConstant;
      analyserRef.current = analyser;
      
      // Connect stream to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;
      
      // Buffer cho frequency data
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      /**
       * Analyze audio level
       */
      const detectSpeaking = () => {
        analyser.getByteFrequencyData(dataArray);
        
        // Tính average volume
        const sum = dataArray.reduce((acc, val) => acc + val, 0);
        const average = sum / dataArray.length;
        
        // Convert to decibels (approximate)
        const decibels = 20 * Math.log10(average / 255);
        
        // Check if speaking
        const speaking = decibels > threshold && average > 0;
        setIsSpeaking(speaking);
        
        // Continue monitoring
        animationFrameRef.current = requestAnimationFrame(detectSpeaking);
      };
      
      detectSpeaking();
      
    } catch (error) {
      console.error('Error setting up audio analysis:', error);
      setIsSpeaking(false);
    }
    
    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [stream, threshold, smoothingTimeConstant]);
  
  return isSpeaking;
};

export default useAudioLevel;
