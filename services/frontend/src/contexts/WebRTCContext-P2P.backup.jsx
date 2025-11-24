import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import io from 'socket.io-client';
import ENV from '../config/env';

/**
 * WebRTC Context - Hybrid P2P Architecture
 * 
 * VIDEO: P2P WebRTC connection between browsers
 * AUDIO: Server-side pipeline (STT → Translation → TTS)
 * 
 * Features:
 * - P2P video streaming với TURN fallback
 * - Server-side audio translation
 * - Room management
 * - ICE connection monitoring
 */

const WebRTCContext = createContext(null);

export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider');
  }
  return context;
};

// RTCPeerConnection Configuration - Sử dụng ENV config
const PC_CONFIG = {
  iceServers: ENV.getIceServers(),
  iceCandidatePoolSize: 20,
  iceTransportPolicy: 'all', // 'all' hoặc 'relay' (force TURN)
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

export const WebRTCProvider = ({ children }) => {
  // ==========================================
  // STATE
  // ==========================================
  
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Media streams
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map()); // userId -> MediaStream
  
  // Connection state (Map: peerId -> {connectionState, iceConnectionState})
  const [connectionState, setConnectionState] = useState(new Map());
  const [iceConnectionState, setIceConnectionState] = useState('new'); // Overall ICE state
  
  // Participants (Map: peerId -> {username, sourceLanguage, targetLanguage})
  const [participants, setParticipants] = useState(new Map());
  
  // Translation settings
  const [sourceLanguage, setSourceLanguage] = useState('vi');
  const [targetLanguage, setTargetLanguage] = useState('en');
  
  // Audio translation
  const [translatedAudioQueue, setTranslatedAudioQueue] = useState([]);
  const [transcriptions, setTranscriptions] = useState([]);
  
  // ==========================================
  // REFS
  // ==========================================
  
  const peerConnections = useRef(new Map()); // userId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  
  // ==========================================
  // INITIALIZE SOCKET CONNECTION
  // ==========================================
  
  const initializeSocket = useCallback(() => {
    const GATEWAY_URL = ENV.GATEWAY_URL;
    
    console.log('🔌 Connecting to Gateway SFU:', GATEWAY_URL);
    
    const newSocket = io(GATEWAY_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    
    newSocket.on('connect', () => {
      console.log('✅ Socket connected:', newSocket.id);
      setIsConnected(true);
      setUserId(newSocket.id);
    });
    
    newSocket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error);
    });
    
    // Room events
    newSocket.on('joined', (data) => {
      console.log('✅ Joined room:', data);
      // Convert participants array to Map
      const participantsMap = new Map();
      if (Array.isArray(data.participants)) {
        data.participants.forEach(p => {
          participantsMap.set(p.id || p.userId, {
            username: p.username || p.userId,
            sourceLanguage: p.sourceLanguage || 'vi',
            targetLanguage: p.targetLanguage || 'en'
          });
        });
      }
      setParticipants(participantsMap);
    });
    
    newSocket.on('user-joined', (data) => {
      console.log('👤 User joined:', data.userId);
      // Add to participants
      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.set(data.userId, {
          username: data.username || data.userId,
          sourceLanguage: data.sourceLanguage || 'vi',
          targetLanguage: data.targetLanguage || 'en'
        });
        return newMap;
      });
      // Trigger offer creation to new peer
      createOffer(data.userId);
    });
    
    newSocket.on('user-left', (data) => {
      console.log('👋 User left:', data.userId);
      removePeer(data.userId);
    });
    
    newSocket.on('room-participants', (data) => {
      console.log('👥 Room participants update:', data);
      // Convert participants array to Map
      const participantsMap = new Map();
      if (Array.isArray(data.participants)) {
        data.participants.forEach(p => {
          participantsMap.set(p.id || p.userId, {
            username: p.username || p.userId,
            sourceLanguage: p.sourceLanguage || 'vi',
            targetLanguage: p.targetLanguage || 'en'
          });
        });
      }
      setParticipants(participantsMap);
    });
    
    // WebRTC signaling events
    newSocket.on('offer', async (data) => {
      console.log('📞 Received offer from:', data.from);
      await handleOffer(data);
    });
    
    newSocket.on('answer', async (data) => {
      console.log('📞 Received answer from:', data.from);
      await handleAnswer(data);
    });
    
    newSocket.on('ice-candidate', async (data) => {
      await handleIceCandidate(data);
    });
    
    // Audio translation events
    newSocket.on('translated-audio', (data) => {
      console.log('🎤 Received translated audio from:', data.from);
      handleTranslatedAudio(data);
    });
    
    newSocket.on('transcription', (data) => {
      console.log('📝 Transcription:', data.text);
      setTranscriptions(prev => [...prev, data]);
    });
    
    setSocket(newSocket);
    
    return newSocket;
  }, []);
  
  // ==========================================
  // MEDIA CAPTURE
  // ==========================================
  
  const getLocalStream = useCallback(async (constraints = {}) => {
    try {
      const defaultConstraints = {
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia({
        ...defaultConstraints,
        ...constraints
      });
      
      console.log('✅ Got local stream:', stream.id);
      localStreamRef.current = stream;
      setLocalStream(stream);
      
      // Start audio capture for translation
      startAudioCapture(stream);
      
      return stream;
    } catch (error) {
      console.error('❌ Error getting local stream:', error);
      throw error;
    }
  }, []);
  
  // ==========================================
  // AUDIO CAPTURE FOR TRANSLATION
  // ==========================================
  
  const startAudioCapture = useCallback((stream) => {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        console.warn('⚠️ No audio track found');
        return;
      }
      
      const audioStream = new MediaStream([audioTrack]);
      
      // MediaRecorder để capture audio chunks
      const mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm',
        audioBitsPerSecond: 128000
      });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendAudioForTranslation(audioBlob);
        audioChunksRef.current = [];
      };
      
      // Capture audio mỗi 3 giây
      mediaRecorder.start();
      const captureInterval = setInterval(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          setTimeout(() => {
            if (localStreamRef.current) {
              mediaRecorder.start();
            }
          }, 100);
        }
      }, 3000);
      
      mediaRecorderRef.current = { recorder: mediaRecorder, interval: captureInterval };
      
      console.log('🎤 Audio capture started');
    } catch (error) {
      console.error('❌ Error starting audio capture:', error);
    }
  }, []);
  
  const stopAudioCapture = useCallback(() => {
    if (mediaRecorderRef.current) {
      const { recorder, interval } = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      if (interval) {
        clearInterval(interval);
      }
      mediaRecorderRef.current = null;
      console.log('🎤 Audio capture stopped');
    }
  }, []);
  
  const sendAudioForTranslation = useCallback(async (audioBlob) => {
    if (!socket || !roomId || audioBlob.size < 1000) return; // Skip very small audio
    
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result.split(',')[1];
        
        socket.emit('audio-data', {
          roomId,
          audioData: base64Audio,
          language: sourceLanguage,
          targetLanguage: targetLanguage
        });
      };
      reader.readAsDataURL(audioBlob);
    } catch (error) {
      console.error('❌ Error sending audio:', error);
    }
  }, [socket, roomId, sourceLanguage, targetLanguage]);
  
  // ==========================================
  // HANDLE TRANSLATED AUDIO
  // ==========================================
  
  const handleTranslatedAudio = useCallback((data) => {
    try {
      const { audioData, originalText, translatedText } = data;
      
      // Add to transcriptions
      if (translatedText) {
        setTranscriptions(prev => [...prev, {
          from: data.from,
          text: translatedText,
          original: originalText,
          timestamp: Date.now()
        }]);
      }
      
      // Play audio
      if (audioData) {
        const audio = new Audio(`data:audio/mp3;base64,${audioData}`);
        audio.play().catch(err => console.error('Error playing audio:', err));
      }
    } catch (error) {
      console.error('❌ Error handling translated audio:', error);
    }
  }, []);
  
  // ==========================================
  // P2P CONNECTION MANAGEMENT
  // ==========================================
  
  const createPeerConnection = useCallback((peerId) => {
    try {
      const pc = new RTCPeerConnection(PC_CONFIG);
      
      // Add local VIDEO track only (NO AUDIO for P2P)
      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          pc.addTrack(videoTrack, localStreamRef.current);
          console.log('✅ Added video track to peer connection');
        }
      }
      
      // Handle remote stream
      pc.ontrack = (event) => {
        console.log('📺 Received remote track:', event.track.kind);
        const [remoteStream] = event.streams;
        setRemoteStreams(prev => new Map(prev).set(peerId, remoteStream));
      };
      
      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket?.emit('ice-candidate', {
            roomId,
            targetUserId: peerId,
            candidate: event.candidate
          });
        }
      };
      
      // Monitor connection state
      pc.onconnectionstatechange = () => {
        console.log(`🔗 Connection state [${peerId}]:`, pc.connectionState);
        setConnectionState(prev => {
          const newMap = new Map(prev);
          const current = newMap.get(peerId) || {};
          newMap.set(peerId, { ...current, connectionState: pc.connectionState });
          return newMap;
        });
      };
      
      pc.oniceconnectionstatechange = () => {
        console.log(`❄️ ICE state [${peerId}]:`, pc.iceConnectionState);
        setConnectionState(prev => {
          const newMap = new Map(prev);
          const current = newMap.get(peerId) || {};
          newMap.set(peerId, { ...current, iceConnectionState: pc.iceConnectionState });
          return newMap;
        });
        
        // Update overall ICE state (use worst state from all peers)
        setIceConnectionState(pc.iceConnectionState);
        
        if (pc.iceConnectionState === 'failed') {
          console.warn('⚠️ ICE connection failed, restarting...');
          pc.restartIce();
        }
      };
      
      peerConnections.current.set(peerId, pc);
      return pc;
    } catch (error) {
      console.error('❌ Error creating peer connection:', error);
      throw error;
    }
  }, [socket, roomId]);
  
  const createOffer = useCallback(async (peerId) => {
    try {
      const pc = createPeerConnection(peerId);
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false // No audio in P2P
      });
      
      await pc.setLocalDescription(offer);
      
      socket?.emit('offer', {
        roomId,
        targetUserId: peerId,
        offer
      });
      
      console.log('📤 Sent offer to:', peerId);
    } catch (error) {
      console.error('❌ Error creating offer:', error);
    }
  }, [socket, roomId, createPeerConnection]);
  
  const handleOffer = useCallback(async (data) => {
    try {
      const { from, offer } = data;
      const pc = createPeerConnection(from);
      
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket?.emit('answer', {
        roomId,
        targetUserId: from,
        answer
      });
      
      console.log('📤 Sent answer to:', from);
    } catch (error) {
      console.error('❌ Error handling offer:', error);
    }
  }, [socket, roomId, createPeerConnection]);
  
  const handleAnswer = useCallback(async (data) => {
    try {
      const { from, answer } = data;
      const pc = peerConnections.current.get(from);
      
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('✅ Set remote description for:', from);
      }
    } catch (error) {
      console.error('❌ Error handling answer:', error);
    }
  }, []);
  
  const handleIceCandidate = useCallback(async (data) => {
    try {
      const { from, candidate } = data;
      const pc = peerConnections.current.get(from);
      
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('❌ Error handling ICE candidate:', error);
    }
  }, []);
  
  const removePeer = useCallback((peerId) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
    }
    
    setRemoteStreams(prev => {
      const newMap = new Map(prev);
      newMap.delete(peerId);
      return newMap;
    });
    
    setParticipants(prev => {
      const newMap = new Map(prev);
      newMap.delete(peerId);
      return newMap;
    });
    
    setConnectionState(prev => {
      const newMap = new Map(prev);
      newMap.delete(peerId);
      return newMap;
    });
  }, []);
  
  // ==========================================
  // ROOM OPERATIONS
  // ==========================================
  
  const createRoom = useCallback(async () => {
    return new Promise((resolve, reject) => {
      try {
        // Wait for socket connection if not ready
        if (!socket || !socket.connected) {
          console.log('⏳ Waiting for socket connection...');
          // Wait max 5 seconds for connection
          let attempts = 0;
          const waitInterval = setInterval(() => {
            attempts++;
            if (socket && socket.connected) {
              clearInterval(waitInterval);
              proceedWithCreation();
            } else if (attempts >= 50) {
              clearInterval(waitInterval);
              reject(new Error('Socket connection timeout'));
            }
          }, 100);
        } else {
          proceedWithCreation();
        }
        
        function proceedWithCreation() {
          console.log('🔨 Creating new room...');
          
          // Emit create-room event to Gateway
          socket.emit('create-room', (response) => {
            if (response.error) {
              console.error('❌ Error creating room:', response.error);
              reject(new Error(response.error.message || 'Failed to create room'));
            } else {
              console.log('✅ Room created:', response.roomId);
              resolve(response.roomId);
            }
          });
        }
      } catch (error) {
        console.error('❌ Error in createRoom:', error);
        reject(error);
      }
    });
  }, [socket]);
  
  const joinRoom = useCallback(async (roomIdToJoin, userInfo = {}) => {
    try {
      // Wait for socket connection if not ready
      if (!socket || !socket.connected) {
        console.log('⏳ Waiting for socket connection...');
        // Wait max 5 seconds for connection
        let attempts = 0;
        while ((!socket || !socket.connected) && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        if (!socket || !socket.connected) {
          throw new Error('Socket connection timeout');
        }
      }
      
      console.log('✅ Socket ready, proceeding with join...');
      
      // Get local media first
      await getLocalStream();
      
      // Join room via signaling (FIX: changed join_room -> join-room)
      socket.emit('join-room', {
        roomId: roomIdToJoin,
        name: userInfo.userId || userId,
        userid: userInfo.userId || userId,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage
      }, (response) => {
        if (response && response.error) {
          console.error('❌ Error joining room:', response.error);
          throw new Error(response.error.message || 'Failed to join room');
        } else {
          console.log('✅ Join room response:', response);
        }
      });
      
      setRoomId(roomIdToJoin);
      console.log('✅ Joined room:', roomIdToJoin);
    } catch (error) {
      console.error('❌ Error joining room:', error);
      throw error;
    }
  }, [socket, userId, sourceLanguage, targetLanguage, getLocalStream]);
  
  const leaveRoom = useCallback(() => {
    // Stop audio capture
    stopAudioCapture();
    
    // Close all peer connections
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // Emit leave event
    socket?.emit('leave-room');
    
    // Clear state
    setRoomId(null);
    setLocalStream(null);
    setRemoteStreams(new Map());
    setParticipants(new Map());
    setConnectionState(new Map());
    
    console.log('👋 Left room');
  }, [socket, stopAudioCapture]);
  
  // ==========================================
  // MEDIA CONTROLS
  // ==========================================
  
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }, []);
  
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
    }
    return false;
  }, []);
  
  // ==========================================
  // CLEANUP
  // ==========================================
  
  useEffect(() => {
    const newSocket = initializeSocket();
    
    return () => {
      leaveRoom();
      newSocket?.disconnect();
    };
  }, []);
  
  // ==========================================
  // CONTEXT VALUE
  // ==========================================
  
  const value = {
    // Connection
    socket,
    isConnected,
    userId,
    connectionState,
    iceConnectionState,
    
    // Room
    roomId,
    participants,
    createRoom,
    joinRoom,
    leaveRoom,
    
    // Media
    localStream,
    remoteStreams,
    getLocalStream,
    
    // Controls
    toggleAudio,
    toggleVideo,
    
    // Translation
    sourceLanguage,
    targetLanguage,
    setSourceLanguage,
    setTargetLanguage,
    transcriptions,
    
    // Audio
    translatedAudioQueue
  };
  
  return (
    <WebRTCContext.Provider value={value}>
      {children}
    </WebRTCContext.Provider>
  );
};

export default WebRTCContext;
